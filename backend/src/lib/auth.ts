import { NextResponse } from "next/server";
import { config } from "./config";
import { buildRequestCanonical, hmacHex, safeEqual, sha256Hex, signResponse } from "./hmac";
import { getDb, COLLECTIONS } from "./firestore";

const REQUIRED_HEADERS = [
  "authorization",
  "x-easyvip-key-id",
  "x-easyvip-timestamp",
  "x-easyvip-nonce",
  "x-easyvip-signature",
] as const;

export interface AuthContext {
  keyId: string;
  secret: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
  path: string;
}

export type AuthResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; response: NextResponse };

function unauthorized(message: string): NextResponse {
  // Mensagem genérica de propósito — nunca dizer *qual* parte da
  // verificação falhou (token, assinatura, timestamp), pra não dar
  // pista de força-bruta pra quem está tentando adivinhar.
  return NextResponse.json({ error: "unauthorized", message: "Falha de autenticação" }, { status: 401 });
}

/**
 * Valida Bearer token + assinatura HMAC + timestamp + nonce (anti-replay)
 * de uma requisição vinda do EasyVip, conforme o contrato documentado em
 * docs/integrations/webstore-fulfillment.md.
 *
 * IMPORTANTE: o corpo precisa ser lido como texto bruto ANTES de qualquer
 * JSON.parse, porque a assinatura é sobre os bytes exatos enviados —
 * reserializar o JSON pode mudar espaçamento/ordem de chaves e quebrar a
 * verificação (ou pior, mascarar uma adulteração real).
 */
export async function authenticateEasyVipRequest(
  request: Request,
  method: string
): Promise<AuthResult> {
  for (const header of REQUIRED_HEADERS) {
    if (!request.headers.get(header)) {
      return { ok: false, response: unauthorized(`Header ausente: ${header}`) };
    }
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch) {
    return { ok: false, response: unauthorized("Formato de Authorization inválido") };
  }
  const providedToken = bearerMatch[1] ?? "";
  const expectedToken = config.easyvip.bearerToken();
  if (!safeEqual(providedToken, expectedToken)) {
    return { ok: false, response: unauthorized("Token inválido") };
  }

  const keyId = request.headers.get("x-easyvip-key-id") ?? "";
  const timestamp = request.headers.get("x-easyvip-timestamp") ?? "";
  const nonce = request.headers.get("x-easyvip-nonce") ?? "";
  const providedSignature = request.headers.get("x-easyvip-signature") ?? "";

  const hmacKeys = config.easyvip.hmacKeys();
  const secret = hmacKeys[keyId];
  if (!secret) {
    return { ok: false, response: unauthorized("Chave desconhecida") };
  }

  // Timestamp dentro da tolerância (evita reprocessar requests antigas)
  const tsNumber = Number(timestamp);
  if (!Number.isFinite(tsNumber)) {
    return { ok: false, response: unauthorized("Timestamp inválido") };
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tolerance = config.easyvip.timestampToleranceSeconds();
  if (Math.abs(nowSeconds - tsNumber) > tolerance) {
    return { ok: false, response: unauthorized("Timestamp fora da tolerância") };
  }

  // Corpo bruto (texto exato recebido)
  const rawBody = await request.text();

  const url = new URL(request.url);
  const canonical = buildRequestCanonical(method, url.pathname, timestamp, nonce, sha256Hex(rawBody));
  const expectedSignature = hmacHex(secret, canonical);

  if (!safeEqual(providedSignature, expectedSignature)) {
    return { ok: false, response: unauthorized("Assinatura inválida") };
  }

  // Anti-replay: nonce só pode ser usado uma vez, por keyId, dentro da
  // janela de tolerância. Usamos create() (não get()+set()) porque é
  // atômico — get()+set() tem uma janela de corrida onde duas requisições
  // com o MESMO nonce, chegando em paralelo, poderiam ambas passar pelo
  // "não existe" antes de qualquer uma escrever. create() falha na hora
  // se o documento já existir, fechando essa brecha.
  const db = getDb();
  const nonceDocId = `${keyId}:${nonce}`;
  const nonceRef = db.collection(COLLECTIONS.nonces).doc(nonceDocId);
  try {
    await nonceRef.create({
      keyId,
      createdAt: Date.now(),
      // TTL manual: um job/regra do Firestore pode limpar documentos
      // antigos usando este campo (ver README, seção de manutenção).
      expiresAt: Date.now() + tolerance * 2 * 1000,
    });
  } catch {
    // create() lança erro se o documento já existe (ALREADY_EXISTS)
    return { ok: false, response: unauthorized("Nonce já utilizado") };
  }

  return {
    ok: true,
    ctx: { keyId, secret, timestamp, nonce, rawBody, path: url.pathname },
  };
}

/**
 * Monta uma resposta JSON já assinada (X-EasyVip-Response-Timestamp /
 * X-EasyVip-Response-Signature), reaproveitando o nonce da requisição
 * pra amarrar a resposta ao pedido que a originou.
 */
export function signedJson(
  ctx: Pick<AuthContext, "secret" | "nonce">,
  body: unknown,
  status: number
): NextResponse {
  const serialized = JSON.stringify(body);
  const responseTimestamp = String(Math.floor(Date.now() / 1000));
  const signature = signResponse({
    secret: ctx.secret,
    timestamp: responseTimestamp,
    nonce: ctx.nonce,
    statusCode: status,
    rawBody: serialized,
  });

  return new NextResponse(serialized, {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-EasyVip-Response-Timestamp": responseTimestamp,
      "X-EasyVip-Response-Signature": signature,
    },
  });
}

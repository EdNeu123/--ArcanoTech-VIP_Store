import { createHash, createHmac, timingSafeEqual } from "crypto";

/**
 * Implementa exatamente o "Contrato HTTP" descrito em
 * docs/integrations/webstore-fulfillment.md do EasyVip:
 *
 * Canonical do request:
 *   METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + NONCE + "\n" + SHA256(BODY_BRUTO)
 *
 * Canonical da resposta:
 *   TIMESTAMP + "\n" + NONCE + "\n" + STATUS_CODE + "\n" + SHA256(BODY_BRUTO)
 *
 * O corpo é assinado como bytes brutos — nunca reserializar o JSON antes
 * de validar, ou a assinatura pode não bater por causa da formatação.
 */

export function sha256Hex(rawBody: Buffer | string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function hmacHex(secret: string, canonical: string): string {
  return createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
}

export function buildRequestCanonical(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  bodyHashHex: string
): string {
  return [method.toUpperCase(), path, timestamp, nonce, bodyHashHex].join("\n");
}

export function buildResponseCanonical(
  timestamp: string,
  nonce: string,
  statusCode: number,
  bodyHashHex: string
): string {
  return [timestamp, nonce, String(statusCode), bodyHashHex].join("\n");
}

/**
 * Comparação em tempo constante. Strings de tamanhos diferentes nunca
 * batem, mas isso é feito sem vazar *quanto* elas diferem (o early-return
 * por tamanho é seguro, pois o tamanho do HMAC hex já é público/fixo).
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface SignRequestParams {
  secret: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBody: Buffer | string;
}

export function signRequest(params: SignRequestParams): string {
  const bodyHash = sha256Hex(params.rawBody);
  const canonical = buildRequestCanonical(
    params.method,
    params.path,
    params.timestamp,
    params.nonce,
    bodyHash
  );
  return hmacHex(params.secret, canonical);
}

export interface SignResponseParams {
  secret: string;
  timestamp: string;
  nonce: string;
  statusCode: number;
  rawBody: Buffer | string;
}

export function signResponse(params: SignResponseParams): string {
  const bodyHash = sha256Hex(params.rawBody);
  const canonical = buildResponseCanonical(
    params.timestamp,
    params.nonce,
    params.statusCode,
    bodyHash
  );
  return hmacHex(params.secret, canonical);
}

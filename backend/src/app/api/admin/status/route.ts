import { NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { safeEqual } from "@/lib/hmac";

/**
 * Status para o painel admin. NUNCA retorna o valor de nenhum segredo —
 * apenas se cada peça está configurada e um "fingerprint" curto (últimos
 * 4 caracteres) para você conferir visualmente que é a chave certa, sem
 * expor a chave inteira.
 *
 * Protegido por ADMIN_STATUS_TOKEN: o painel manda esse token no header
 * Authorization. Esse token é separado do login do Firebase Auth e serve
 * só pra essa leitura de status.
 */
export function OPTIONS(request: Request) {
  return corsPreflight(request);
}

function last4(value: string | undefined): string | null {
  if (!value || value.length < 4) return null;
  return value.slice(-4);
}

export async function GET(request: Request) {
  const expected = process.env.ADMIN_STATUS_TOKEN;
  if (!expected) {
    return withCors(
      request,
      NextResponse.json({ error: "admin_status_token_not_configured" }, { status: 503 })
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match || !safeEqual(match[1] ?? "", expected)) {
    return withCors(request, NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  }

  let hmacKeyIds: string[] = [];
  try {
    hmacKeyIds = Object.keys(JSON.parse(process.env.EASYVIP_HMAC_KEYS ?? "{}"));
  } catch {
    hmacKeyIds = [];
  }

  return withCors(
    request,
    NextResponse.json({
      mercadoPago: {
        configured: Boolean(process.env.MP_ACCESS_TOKEN),
        tokenLast4: last4(process.env.MP_ACCESS_TOKEN),
        webhookSignatureEnabled: Boolean(process.env.MP_WEBHOOK_SECRET),
      },
      fulfillment: {
        serverId: process.env.EASYVIP_SERVER_ID ?? null,
        bearerConfigured: Boolean(process.env.EASYVIP_BEARER_TOKEN),
        hmacKeyIds,
      },
      firebase: {
        configured: Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY),
        projectId: process.env.FIREBASE_PROJECT_ID ?? null,
      },
    })
  );
}

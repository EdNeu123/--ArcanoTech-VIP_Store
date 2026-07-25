import { NextResponse } from "next/server";

/**
 * Lista de origens autorizadas a chamar as rotas públicas (checkout) a
 * partir do navegador. Configurável por env var CORS_ALLOWED_ORIGINS
 * (lista separada por vírgula). Se não configurada, cai num default
 * seguro com os domínios padrão do Firebase Hosting do projeto.
 *
 * NUNCA use "*" aqui: o checkout cria cobranças reais, então só o(s)
 * site(s) oficiais devem poder chamá-lo do browser.
 */
function allowedOrigins(): string[] {
  const fromEnv = process.env.CORS_ALLOWED_ORIGINS;
  if (fromEnv) {
    return fromEnv
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
  }
  return [
    "https://arcanotech-vipstore.web.app",
    "https://arcanotech-vipstore.firebaseapp.com",
  ];
}

/**
 * Resolve o header Access-Control-Allow-Origin para uma requisição:
 * devolve a própria origem se ela estiver na allowlist, senão null
 * (o navegador então bloqueia — que é o comportamento desejado).
 */
export function resolveCorsOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  return allowedOrigins().includes(origin) ? origin : null;
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = resolveCorsOrigin(request);
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Resposta pronta para o preflight OPTIONS. */
export function corsPreflight(request: Request): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

/** Envelopa um NextResponse já criado adicionando os headers de CORS. */
export function withCors(request: Request, response: NextResponse): NextResponse {
  const headers = corsHeaders(request);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

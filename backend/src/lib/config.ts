/**
 * Configuração central do backend, lida de variáveis de ambiente.
 * Nada de segredo tem valor default — se faltar, o serviço recusa subir
 * a rota em vez de silenciosamente rodar sem proteção.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  mercadoPago: {
    // Access token de produção/teste da sua conta Mercado Pago
    accessToken: () => required("MP_ACCESS_TOKEN"),
    // Segredo configurado no painel do Mercado Pago para validar a
    // assinatura do webhook (Webhooks > Configurar assinatura secreta)
    webhookSecret: () => process.env.MP_WEBHOOK_SECRET || null,
  },

  server: {
    // ID do servidor Minecraft que este backend atende (precisa bater com
    // "server_id" no webstore.toml do EasyVip)
    defaultServerId: () => required("EASYVIP_SERVER_ID"),
  },

  easyvip: {
    // Bearer token que o EasyVip manda no header Authorization
    bearerToken: () => required("EASYVIP_BEARER_TOKEN"),
    // Mapa keyId -> segredo HMAC, em JSON: {"easyvip-arcanotech-v1":"..."}
    // Suporta rotação: pode ter mais de uma chave válida ao mesmo tempo.
    hmacKeys: (): Record<string, string> => {
      const raw = required("EASYVIP_HMAC_KEYS");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("EASYVIP_HMAC_KEYS precisa ser um JSON válido");
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("EASYVIP_HMAC_KEYS precisa ser um objeto {keyId: secret}");
      }
      return parsed as Record<string, string>;
    },
    timestampToleranceSeconds: () =>
      Number(optional("EASYVIP_TIMESTAMP_TOLERANCE_SECONDS", "60")),
    leaseDurationSeconds: () =>
      Number(optional("EASYVIP_LEASE_DURATION_SECONDS", "120")),
    claimDefaultLimit: () => Number(optional("EASYVIP_CLAIM_DEFAULT_LIMIT", "20")),
    claimMaxLimit: () => Number(optional("EASYVIP_CLAIM_MAX_LIMIT", "100")),
  },

  firebase: {
    projectId: () => required("FIREBASE_PROJECT_ID"),
    clientEmail: () => required("FIREBASE_CLIENT_EMAIL"),
    // A chave privada costuma vir com \n escapado quando colada como env var
    privateKey: () => required("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
  },
};

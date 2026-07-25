import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { createHmac, timingSafeEqual } from "crypto";
import { config } from "./config";
import type { Product } from "./products";

function client(): MercadoPagoConfig {
  return new MercadoPagoConfig({ accessToken: config.mercadoPago.accessToken() });
}

export interface CreatePreferenceParams {
  product: Product;
  orderId: string;
  nick: string;
  minecraftUuid: string | null;
  notificationUrl: string;
  successUrl: string;
  failureUrl: string;
}

export async function createPreference(params: CreatePreferenceParams) {
  const preferenceApi = new Preference(client());

  // externalReference carrega só o orderId. Tudo o mais (sku, nick, uuid)
  // fica gravado no Firestore no momento da criação do pedido — nunca
  // confiamos em dado de preço/produto vindo de volta do Mercado Pago.
  const preference = await preferenceApi.create({
    body: {
      items: [
        {
          id: params.product.sku,
          title: params.product.title,
          quantity: 1,
          unit_price: params.product.priceBRL,
          currency_id: "BRL",
        },
      ],
      external_reference: params.orderId,
      notification_url: params.notificationUrl,
      back_urls: {
        success: params.successUrl,
        failure: params.failureUrl,
        pending: params.failureUrl,
      },
      auto_return: "approved",
    },
  });

  return preference;
}

export async function fetchPayment(paymentId: string) {
  const paymentApi = new Payment(client());
  return paymentApi.get({ id: paymentId });
}

/**
 * Verifica a assinatura do webhook do Mercado Pago (header x-signature),
 * conforme documentado em:
 * https://www.mercadopago.com.br/developers/pt/docs/checkout-api/webhooks
 *
 * Isso é uma camada EXTRA de segurança. A verificação definitiva continua
 * sendo sempre reconsultar o pagamento pela API (fetchPayment) — nunca
 * confie só no corpo do POST nem só nesta assinatura.
 *
 * Se MP_WEBHOOK_SECRET não estiver configurado, a verificação é pulada
 * (retorna true) e o backend depende só do reconsulta via API.
 */
export function verifyMercadoPagoSignature(
  xSignatureHeader: string | null,
  xRequestIdHeader: string | null,
  dataId: string
): boolean {
  const secret = config.mercadoPago.webhookSecret();
  if (!secret) return true; // sem segredo configurado: pula essa camada

  if (!xSignatureHeader || !xRequestIdHeader) return false;

  const parts = Object.fromEntries(
    xSignatureHeader.split(",").map((kv) => {
      const [k, v] = kv.split("=").map((s) => s.trim());
      return [k, v];
    })
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestIdHeader};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");

  const bufExpected = Buffer.from(expected, "utf8");
  const bufProvided = Buffer.from(v1, "utf8");
  if (bufExpected.length !== bufProvided.length) return false;
  return timingSafeEqual(bufExpected, bufProvided);
}

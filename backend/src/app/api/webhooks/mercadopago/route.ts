import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getDb, COLLECTIONS } from "@/lib/firestore";
import { getProduct } from "@/lib/products";
import { fetchPayment, verifyMercadoPagoSignature } from "@/lib/mercadopago";
import type { FulfillmentDoc, OrderDoc } from "@/lib/types";

/**
 * O Mercado Pago manda notificações tanto por querystring quanto por
 * corpo JSON, dependendo do tipo de integração. Lemos os dois pra não
 * depender de um formato específico.
 */
function extractPaymentId(url: URL, body: any): string | null {
  const fromQuery = url.searchParams.get("data.id") ?? url.searchParams.get("id");
  if (fromQuery) return fromQuery;
  if (body?.data?.id) return String(body.data.id);
  return null;
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const rawBody = await request.text();

  let body: any = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    // Corpo vazio/```não-JSON é normal em alguns pings do MP — segue
    // tentando extrair o id pela querystring.
  }

  const paymentId = extractPaymentId(url, body);
  if (!paymentId) {
    // Não é uma notificação de pagamento (pode ser outro tipo de evento) —
    // responde 200 pra o MP não ficar reentregando algo que não vamos usar.
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  const signatureOk = verifyMercadoPagoSignature(
    request.headers.get("x-signature"),
    request.headers.get("x-request-id"),
    paymentId
  );
  if (!signatureOk) {
    // Assinatura inválida: não vale a pena nem consultar a API por esse id.
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const db = getDb();

  // Nunca confiar no corpo do webhook pra decidir status — sempre
  // reconsultar a API do Mercado Pago com o access token do servidor.
  const payment = await fetchPayment(paymentId);

  if (payment.status !== "approved") {
    // Não é erro — só ainda não foi aprovado (pendente, rejeitado etc).
    // IMPORTANTE: não marcamos payment_id como "processado" aqui. O MP
    // manda uma notificação nova quando o status mudar (ex: pending ->
    // approved), e essa notificação futura precisa continuar podendo
    // ser processada.
    return NextResponse.json({ ok: true, status: payment.status }, { status: 200 });
  }

  // Idempotência: um pagamento "approved" só pode gerar UM fulfillment,
  // mesmo que o MP reentregue a notificação várias vezes (o que é
  // esperado, inclusive em paralelo).
  //
  // create() é atômico — falha na hora se o documento já existir. Isso
  // fecha a janela de corrida que existiria com get()+set(), onde duas
  // entregas simultâneas do mesmo webhook poderiam ambas passar pela
  // checagem antes de qualquer uma marcar como processado.
  const processedRef = db.collection(COLLECTIONS.processedPayments).doc(paymentId);
  try {
    await processedRef.create({ paymentId, claimedAt: Date.now(), orderId: null });
  } catch {
    return NextResponse.json({ ok: true, alreadyProcessed: true }, { status: 200 });
  }

  const orderId = payment.external_reference;
  if (!orderId) {
    return NextResponse.json({ error: "missing_external_reference" }, { status: 400 });
  }

  const orderRef = db.collection(COLLECTIONS.orders).doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    return NextResponse.json({ error: "unknown_order" }, { status: 404 });
  }
  const order = orderSnap.data() as OrderDoc;

  const product = getProduct(order.sku);
  if (!product) {
    return NextResponse.json({ error: "unknown_sku" }, { status: 400 });
  }

  if (!order.minecraftUuid) {
    // Defesa em profundidade: o checkout já garante isso hoje, mas se
    // algum dia existir outro jeito de criar uma order, falha alto e
    // visível em vez de criar um fulfillment que o EasyVip não vai
    // conseguir aplicar.
    return NextResponse.json({ error: "missing_minecraft_uuid" }, { status: 422 });
  }

  const fulfillmentId = uuidv4();
  const fulfillment: FulfillmentDoc = {
    fulfillmentId,
    orderId: order.orderId,
    serverId: order.serverId,
    minecraftUuid: order.minecraftUuid,
    minecraftUsername: order.nick,
    status: "pending",
    items: [{ lineItemId: uuidv4(), productSku: product.sku, quantity: 1 }],
    claimToken: null,
    leaseExpiresAt: null,
    createdAt: Date.now(),
    completedAt: null,
    lastError: null,
  };

  const batch = db.batch();
  batch.set(db.collection(COLLECTIONS.fulfillments).doc(fulfillmentId), fulfillment);
  batch.update(orderRef, { status: "paid", paymentId, paidAt: Date.now() });
  batch.set(processedRef, { paymentId, orderId, processedAt: Date.now() });
  await batch.commit();

  return NextResponse.json({ ok: true, fulfillmentId }, { status: 200 });
}

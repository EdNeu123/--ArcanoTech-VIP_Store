import { NextResponse } from "next/server";
import { getDb, COLLECTIONS } from "@/lib/firestore";
import { corsPreflight, withCors } from "@/lib/cors";
import type { OrderDoc, FulfillmentDoc } from "@/lib/types";

/**
 * Status público de um pedido, consultado pela tela de confirmação do
 * site (polling curto após o retorno do Mercado Pago).
 *
 * Retorna apenas o necessário pra UI — nada sensível. O orderId é um UUID
 * aleatório (não sequencial), então não dá pra enumerar pedidos de outras
 * pessoas de forma prática; ainda assim, só expomos campos inócuos.
 */
export function OPTIONS(request: Request) {
  return corsPreflight(request);
}

export async function GET(request: Request, { params }: { params: { orderId: string } }) {
  const db = getDb();
  const orderSnap = await db.collection(COLLECTIONS.orders).doc(params.orderId).get();

  if (!orderSnap.exists) {
    return withCors(request, NextResponse.json({ error: "not_found" }, { status: 404 }));
  }

  const order = orderSnap.data() as OrderDoc;

  // Descobre o estado de entrega (o VIP já foi aplicado no jogo?).
  let delivery: "pending" | "delivered" | "failed" = "pending";
  const fulfSnap = await db
    .collection(COLLECTIONS.fulfillments)
    .where("orderId", "==", order.orderId)
    .limit(1)
    .get();

  if (!fulfSnap.empty) {
    const fulfillment = fulfSnap.docs[0]!.data() as FulfillmentDoc;
    if (fulfillment.status === "completed") delivery = "delivered";
    else if (fulfillment.status === "failed") delivery = "failed";
  }

  return withCors(
    request,
    NextResponse.json({
      orderId: order.orderId,
      sku: order.sku,
      nick: order.nick,
      // "created" (aguardando pagamento) | "paid" | "fulfilled" | "failed"
      paymentStatus: order.status,
      // "pending" | "delivered" | "failed" — se o VIP já entrou no jogo
      deliveryStatus: delivery,
    })
  );
}

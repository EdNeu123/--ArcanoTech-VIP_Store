import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getDb, COLLECTIONS } from "@/lib/firestore";
import { getProduct } from "@/lib/products";
import { createPreference } from "@/lib/mercadopago";
import { resolveMinecraftUuid } from "@/lib/mojang";
import { config } from "@/lib/config";
import type { OrderDoc } from "@/lib/types";

const NICK_REGEX = /^[A-Za-z0-9_]{3,16}$/; // regras de nick do Minecraft Java

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { sku, nick } = (body ?? {}) as { sku?: unknown; nick?: unknown };

  if (typeof sku !== "string" || typeof nick !== "string") {
    return NextResponse.json({ error: "campos obrigatórios: sku, nick" }, { status: 400 });
  }

  if (!NICK_REGEX.test(nick)) {
    return NextResponse.json({ error: "nick inválido" }, { status: 400 });
  }

  const product = getProduct(sku);
  if (!product) {
    return NextResponse.json({ error: "sku desconhecido" }, { status: 400 });
  }

  // Resolve o UUID ANTES de criar a cobrança — se o nick não existir,
  // falha aqui, não depois que o cliente já pagou.
  let minecraftUuid: string | null;
  try {
    minecraftUuid = await resolveMinecraftUuid(nick);
  } catch {
    return NextResponse.json({ error: "mojang_api_unavailable" }, { status: 503 });
  }
  if (!minecraftUuid) {
    return NextResponse.json({ error: "nick não encontrado" }, { status: 404 });
  }

  const db = getDb();

  // Proteção simples contra spam/bot: se já existe um pedido "created" (não
  // pago ainda) pro mesmo nick+sku nos últimos 2 minutos, não cria outro —
  // isso evita gerar dezenas de preferências no Mercado Pago por clique
  // duplicado ou automação abusando do endpoint público.
  const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
  const recentSnap = await db
    .collection(COLLECTIONS.orders)
    .where("nick", "==", nick)
    .where("sku", "==", product.sku)
    .where("status", "==", "created")
    .where("createdAt", ">", twoMinutesAgo)
    .limit(1)
    .get();

  if (!recentSnap.empty) {
    return NextResponse.json(
      { error: "pedido_recente_pendente", message: "Já existe um pedido recente aguardando pagamento pra esse nick/plano." },
      { status: 429 }
    );
  }

  const origin = new URL(request.url).origin;
  const orderId = uuidv4();

  const order: OrderDoc = {
    orderId,
    sku: product.sku,
    nick,
    minecraftUuid,
    serverId: config.server.defaultServerId(),
    priceBRL: product.priceBRL,
    status: "created",
    paymentId: null,
    createdAt: Date.now(),
    paidAt: null,
  };

  await db.collection(COLLECTIONS.orders).doc(orderId).set(order);

  const preference = await createPreference({
    product,
    orderId,
    nick,
    minecraftUuid: order.minecraftUuid,
    notificationUrl: `${origin}/api/webhooks/mercadopago`,
    successUrl: `${origin}/sucesso?order=${orderId}`,
    failureUrl: `${origin}/erro?order=${orderId}`,
  });

  return NextResponse.json({
    orderId,
    checkoutUrl: preference.init_point,
  });
}


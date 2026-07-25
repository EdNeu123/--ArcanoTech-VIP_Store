import { NextResponse } from "next/server";
import { authenticateEasyVipRequest, signedJson } from "@/lib/auth";
import { claimPendingFulfillments } from "@/lib/fulfillments";
import { config } from "@/lib/config";

export async function POST(request: Request) {
  const auth = await authenticateEasyVipRequest(request, "POST");
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  let body: any;
  try {
    body = ctx.rawBody ? JSON.parse(ctx.rawBody) : {};
  } catch {
    return signedJson(ctx, { error: "invalid_json" }, 400);
  }

  const serverId = body?.server_id;
  if (typeof serverId !== "string" || !serverId) {
    return signedJson(ctx, { error: "server_id é obrigatório" }, 400);
  }

  const requestedLimit = Number(body?.limit ?? config.easyvip.claimDefaultLimit());
  const limit = Math.min(
    Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : config.easyvip.claimDefaultLimit()),
    config.easyvip.claimMaxLimit()
  );

  const claimed = await claimPendingFulfillments(serverId, limit, config.easyvip.leaseDurationSeconds());

  return signedJson(
    ctx,
    {
      server_id: serverId,
      fulfillments: claimed.map((f) => ({
        fulfillment_id: f.fulfillmentId,
        order_id: f.orderId,
        minecraft_uuid: f.minecraftUuid,
        minecraft_username: f.minecraftUsername,
        origin_server_id: f.serverId,
        claim_token: f.claimToken,
        lease_expires_at: new Date(f.leaseExpiresAt ?? Date.now()).toISOString(),
        items: f.items.map((item) => ({
          line_item_id: item.lineItemId,
          product_sku: item.productSku,
          quantity: item.quantity,
        })),
      })),
    },
    200
  );
}

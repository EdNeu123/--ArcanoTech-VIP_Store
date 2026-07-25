import { authenticateEasyVipRequest, signedJson } from "@/lib/auth";
import { completeFulfillment } from "@/lib/fulfillments";

export async function POST(request: Request, { params }: { params: { fulfillmentId: string } }) {
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
  const claimToken = body?.claim_token;
  if (typeof serverId !== "string" || typeof claimToken !== "string" || !serverId || !claimToken) {
    return signedJson(ctx, { error: "server_id e claim_token são obrigatórios" }, 400);
  }

  const result = await completeFulfillment(params.fulfillmentId, serverId, claimToken);

  if (!result.ok) {
    if (result.reason === "not_found") {
      return signedJson(ctx, { error: "not_found" }, 404);
    }
    // lease_expired: o EasyVip sabe que precisa dar novo claim e
    // reaproveitar a key gerada localmente pro mesmo line_item_id.
    return signedJson(ctx, { error: "lease_expired" }, 409);
  }

  // Usamos 200 em vez de 204: o contrato aceita os dois como sucesso, e
  // 204 tecnicamente não pode ter corpo (o que quebraria a assinatura da
  // resposta, que sempre assina sobre o corpo enviado).
  return signedJson(ctx, { ok: true, already_completed: result.alreadyCompleted }, 200);
}

import { authenticateEasyVipRequest, signedJson } from "@/lib/auth";
import { failFulfillment } from "@/lib/fulfillments";

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
  const errorCode = body?.error_code;
  const errorMessage = body?.error_message;

  if (
    typeof serverId !== "string" ||
    typeof claimToken !== "string" ||
    typeof errorCode !== "string" ||
    typeof errorMessage !== "string" ||
    !serverId ||
    !claimToken ||
    !errorCode
  ) {
    return signedJson(
      ctx,
      { error: "server_id, claim_token e error_code são obrigatórios" },
      400
    );
  }

  const result = await failFulfillment(
    params.fulfillmentId,
    serverId,
    claimToken,
    errorCode,
    errorMessage
  );

  if (!result.ok) {
    if (result.reason === "not_found") {
      return signedJson(ctx, { error: "not_found" }, 404);
    }
    return signedJson(ctx, { error: "lease_expired" }, 409);
  }

  return signedJson(ctx, { ok: true }, 200);
}

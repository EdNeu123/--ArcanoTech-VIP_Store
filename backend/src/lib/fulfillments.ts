import { v4 as uuidv4 } from "uuid";
import { getDb, COLLECTIONS } from "./firestore";
import type { FulfillmentDoc, FulfillmentStatus } from "./types";

/**
 * Recoloca no pool "pending" qualquer fulfillment que estava "claimed"
 * mas cujo lease já expirou sem confirmação (complete/fail). Isso evita
 * que um item fique travado pra sempre se o servidor cair no meio do
 * processamento.
 */
export async function reclaimExpiredLeases(serverId: string): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const snap = await db
    .collection(COLLECTIONS.fulfillments)
    .where("serverId", "==", serverId)
    .where("status", "==", "claimed")
    .where("leaseExpiresAt", "<", now)
    .get();

  const batch = db.batch();
  snap.forEach((doc) => {
    batch.update(doc.ref, { status: "pending" satisfies FulfillmentStatus, claimToken: null, leaseExpiresAt: null });
  });
  if (!snap.empty) {
    await batch.commit();
  }
}

export async function claimPendingFulfillments(
  serverId: string,
  limit: number,
  leaseDurationSeconds: number
): Promise<FulfillmentDoc[]> {
  const db = getDb();
  await reclaimExpiredLeases(serverId);

  const snap = await db
    .collection(COLLECTIONS.fulfillments)
    .where("serverId", "==", serverId)
    .where("status", "==", "pending")
    .limit(limit)
    .get();

  if (snap.empty) return [];

  const now = Date.now();
  const leaseExpiresAt = now + leaseDurationSeconds * 1000;
  const claimed: FulfillmentDoc[] = [];

  // Transação por documento (simples e suficiente pro volume esperado de
  // uma loja de VIP; evita duas claims simultâneas pegarem o mesmo item).
  for (const doc of snap.docs) {
    const claimToken = uuidv4();
    const result = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      const data = fresh.data() as FulfillmentDoc | undefined;
      if (!data || data.status !== "pending") return null;
      tx.update(doc.ref, { status: "claimed", claimToken, leaseExpiresAt });
      return { ...data, status: "claimed" as const, claimToken, leaseExpiresAt };
    });
    if (result) claimed.push(result);
  }

  return claimed;
}

export async function getFulfillment(fulfillmentId: string): Promise<FulfillmentDoc | null> {
  const db = getDb();
  const doc = await db.collection(COLLECTIONS.fulfillments).doc(fulfillmentId).get();
  if (!doc.exists) return null;
  return doc.data() as FulfillmentDoc;
}

export async function completeFulfillment(
  fulfillmentId: string,
  serverId: string,
  claimToken: string
): Promise<{ ok: true; alreadyCompleted: boolean } | { ok: false; reason: "not_found" | "server_mismatch" | "lease_expired" }> {
  const db = getDb();
  const ref = db.collection(COLLECTIONS.fulfillments).doc(fulfillmentId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "not_found" as const };
    const data = snap.data() as FulfillmentDoc;

    if (data.serverId !== serverId) {
      // Não vaza detalhe: do ponto de vista de fora, servidor errado
      // também aparenta "not_found".
      return { ok: false, reason: "not_found" as const };
    }

    if (data.status === "completed") {
      // Idempotência: já foi concluído antes (talvez a resposta anterior
      // tenha se perdido na rede) — trata como sucesso, sem reprocessar.
      return { ok: true, alreadyCompleted: true };
    }

    if (data.status !== "claimed" || data.claimToken !== claimToken) {
      return { ok: false, reason: "lease_expired" as const };
    }

    tx.update(ref, {
      status: "completed" satisfies FulfillmentStatus,
      completedAt: Date.now(),
      claimToken: null,
      leaseExpiresAt: null,
    });

    return { ok: true, alreadyCompleted: false };
  });
}

const TERMINAL_ERROR_CODES = new Set(["unknown_sku", "unsupported_quantity", "server_mismatch"]);

export async function failFulfillment(
  fulfillmentId: string,
  serverId: string,
  claimToken: string,
  errorCode: string,
  errorMessage: string
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "lease_expired" }> {
  const db = getDb();
  const ref = db.collection(COLLECTIONS.fulfillments).doc(fulfillmentId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "not_found" as const };
    const data = snap.data() as FulfillmentDoc;

    if (data.serverId !== serverId) return { ok: false, reason: "not_found" as const };
    if (data.status !== "claimed" || data.claimToken !== claimToken) {
      return { ok: false, reason: "lease_expired" as const };
    }

    const terminal = TERMINAL_ERROR_CODES.has(errorCode);
    tx.update(ref, {
      status: (terminal ? "failed" : "pending") satisfies FulfillmentStatus,
      claimToken: null,
      leaseExpiresAt: null,
      // Nunca gravamos stack trace aqui — só o código e a mensagem curta
      // que o próprio EasyVip mandou (ele já filtra isso do lado dele).
      lastError: { code: errorCode, message: errorMessage.slice(0, 300) },
    });

    return { ok: true };
  });
}

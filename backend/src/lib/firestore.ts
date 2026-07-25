import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { config } from "./config";

let firestoreInstance: Firestore | null = null;

/**
 * Inicializa o Firebase Admin uma única vez (evita reconectar a cada
 * invocação de função serverless dentro do mesmo processo "quente").
 */
export function getDb(): Firestore {
  if (firestoreInstance) return firestoreInstance;

  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: config.firebase.projectId(),
        clientEmail: config.firebase.clientEmail(),
        privateKey: config.firebase.privateKey(),
      }),
    });
  }

  firestoreInstance = getFirestore();
  return firestoreInstance;
}

export const COLLECTIONS = {
  orders: "easyvip_orders",
  fulfillments: "easyvip_fulfillments",
  nonces: "easyvip_nonces",
  processedPayments: "easyvip_processed_payments",
} as const;

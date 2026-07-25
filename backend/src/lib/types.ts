export type OrderStatus = "created" | "paid" | "fulfilled" | "failed";

export interface OrderDoc {
  orderId: string;
  sku: string;
  nick: string;
  minecraftUuid: string | null;
  serverId: string;
  priceBRL: number;
  status: OrderStatus;
  paymentId: string | null;
  createdAt: number;
  paidAt: number | null;
}

export type FulfillmentStatus = "pending" | "claimed" | "completed" | "failed";

export interface FulfillmentItemDoc {
  lineItemId: string;
  productSku: string;
  quantity: 1;
}

export interface FulfillmentDoc {
  fulfillmentId: string;
  orderId: string;
  serverId: string;
  minecraftUuid: string;
  minecraftUsername: string;
  status: FulfillmentStatus;
  items: FulfillmentItemDoc[];
  claimToken: string | null;
  leaseExpiresAt: number | null;
  createdAt: number;
  completedAt: number | null;
  lastError: { code: string; message: string } | null;
}

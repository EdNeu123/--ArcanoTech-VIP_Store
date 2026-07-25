/**
 * Catálogo de produtos vendidos no site.
 *
 * IMPORTANTE: cada `sku` aqui precisa ter um `[products.<sku>]`
 * correspondente no `config/easyvip/webstore.toml` do servidor, com o
 * mesmo `tier_id` e `duration`. Esse backend só diz "o SKU X foi comprado
 * pelo jogador Y" — quem decide o que o SKU X significa em termos de
 * rank/dias é sempre o EasyVip (por design do próprio mod).
 *
 * Ao criar um plano novo: adicione aqui E no webstore.toml. Só isso.
 */

export interface Product {
  sku: string;
  title: string;
  priceBRL: number;
  tierId: string;
  durationDays: number;
}

export const PRODUCTS: Record<string, Product> = {
  vip_iniciado_30d: {
    sku: "vip_iniciado_30d",
    title: "VIP Iniciado — 30 dias",
    priceBRL: 9.9,
    tierId: "iniciado",
    durationDays: 30,
  },
  vip_arcanista_30d: {
    sku: "vip_arcanista_30d",
    title: "VIP Arcanista — 30 dias",
    priceBRL: 19.9,
    tierId: "arcanista",
    durationDays: 30,
  },
  vip_arquimago_30d: {
    sku: "vip_arquimago_30d",
    title: "VIP Arquimago — 30 dias",
    priceBRL: 34.9,
    tierId: "arquimago",
    durationDays: 30,
  },
};

export function getProduct(sku: string): Product | null {
  return PRODUCTS[sku] ?? null;
}

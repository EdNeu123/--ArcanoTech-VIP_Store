# Arcano Tech — Backend de Pagamentos (EasyVip Fulfillment)

Backend em Next.js (deploy na Vercel) que recebe pagamentos do Mercado Pago
e entrega VIPs no servidor Minecraft através do módulo nativo de
**fulfillment por polling** do [EasyVip](https://github.com/) — sem RCON,
sem porta nenhuma aberta no servidor de jogo.

```
Jogador compra no site
        │
        ▼
POST /api/checkout  →  resolve nick→UUID (Mojang) → cria cobrança no Mercado Pago
        │
        ▼
Mercado Pago aprova o pagamento
        │
        ▼
Mercado Pago chama POST /api/webhooks/mercadopago
        │
        ▼
Este backend reconsulta a API do MP (nunca confia só no webhook) e
grava um "fulfillment" pendente no Firestore
        │
        ▼
O EasyVip, rodando no servidor Minecraft, pergunta periodicamente:
POST /api/v1/minecraft/fulfillments/claim
        │
        ▼
Este backend responde com o que tem pendente pro server_id dele
        │
        ▼
EasyVip aplica o VIP localmente e confirma:
POST /api/v1/minecraft/fulfillments/:id/complete
```

O servidor Minecraft é sempre quem **inicia** a conversa com este backend
— nunca o contrário. Isso significa que você nunca precisa abrir porta
nenhuma no servidor de jogo pra internet.

## Requisitos

- Node.js 20+
- Conta no Mercado Pago (Access Token de produção ou teste)
- Projeto Firebase com Firestore habilitado
- EasyVip instalado no servidor, com `[fulfillment]` habilitado no
  `config/easyvip/webstore.toml` (veja a seção **Configurando o EasyVip**)

## Instalação

```bash
npm install
cp .env.example .env.local
# preencha o .env.local (veja cada variável comentada no arquivo)
npm run dev
```

Rodar os testes automatizados (cobrem a parte de assinatura HMAC):

```bash
npm test
```

Build de produção:

```bash
npm run build
```

## Deploy na Vercel

```bash
npm install -g vercel
vercel
```

Configure as mesmas variáveis do `.env.example` em **Project Settings >
Environment Variables** na Vercel. Depois do primeiro deploy, cadastre a
URL pública como `notification_url` do Mercado Pago (isso já é feito
automaticamente pelo `/api/checkout` a cada cobrança criada, não precisa
configurar nada manualmente no painel do Mercado Pago).

## Configurando o Firestore

Este backend usa 4 coleções, criadas automaticamente no primeiro uso:

| Coleção | Para quê |
|---|---|
| `easyvip_orders` | Um documento por tentativa de compra (criado no checkout) |
| `easyvip_fulfillments` | Um documento por item a ser entregue no jogo |
| `easyvip_processed_payments` | Idempotência — evita processar o mesmo pagamento duas vezes |
| `easyvip_nonces` | Anti-replay das requisições assinadas do EasyVip |

Suba os índices compostos necessários (arquivo já incluso):

```bash
npm install -g firebase-tools
firebase deploy --only firestore:indexes
```

Se você não usar o Firebase CLI, o próprio console do Firestore mostra um
link pra criar o índice automaticamente na primeira vez que uma query
precisar dele (aparece no log de erro).

**Regras do Firestore:** essas 4 coleções só devem ser acessadas pelo
Admin SDK (que ignora as regras de segurança). Configure suas
`firestore.rules` para negar qualquer leitura/escrita vinda do client SDK
nelas — nunca exponha essas coleções pro app do site/Firebase Auth.

## Configurando o EasyVip (lado do servidor)

Em `config/easyvip/webstore.toml`:

```toml
[fulfillment]
enabled = true
server_id = "arcanotech"                      # igual ao EASYVIP_SERVER_ID
key_id = "easyvip-arcanotech-v1"               # igual à chave em EASYVIP_HMAC_KEYS
key_prefix = "ATM-"
secret_env = "EASYVIP_FULFILLMENT_SECRET"      # variável de ambiente NO SERVIDOR com o mesmo valor do segredo em EASYVIP_HMAC_KEYS
token_env = "EASYVIP_FULFILLMENT_TOKEN"        # variável de ambiente NO SERVIDOR com o mesmo valor de EASYVIP_BEARER_TOKEN
poll_interval_seconds = 15
claim_limit = 20
request_timeout_seconds = 10
timestamp_tolerance_seconds = 60

[fulfillment.keys.easyvip-arcanotech-v1]
secret_env = "EASYVIP_FULFILLMENT_SECRET"

[products.vip_iniciado_30d]
type = "vip"
tier_id = "iniciado"
duration = "30d"
max_uses = 1
bind_to_player = true

[products.vip_arcanista_30d]
type = "vip"
tier_id = "arcanista"
duration = "30d"
max_uses = 1
bind_to_player = true

[products.vip_arquimago_30d]
type = "vip"
tier_id = "arquimago"
duration = "30d"
max_uses = 1
bind_to_player = true
```

O bloco `[products.*]` precisa ter o **mesmo SKU** cadastrado em
`src/lib/products.ts` deste backend. Criar um plano novo = cadastrar nos
dois lugares, uma vez só.

## Endpoints

### `POST /api/checkout` — público

```json
// Request
{ "sku": "vip_arcanista_30d", "nick": "DUDU_dev" }

// Response
{ "orderId": "uuid", "checkoutUrl": "https://www.mercadopago.com.br/checkout/..." }
```

Erros possíveis: `sku desconhecido` (400), `nick não encontrado` (404),
`pedido_recente_pendente` (429 — proteção anti-spam, 2 min de cooldown por
nick+plano).

### `POST /api/webhooks/mercadopago` — chamado pelo Mercado Pago

Configurado automaticamente pelo `/api/checkout` via `notification_url`.
Não precisa chamar manualmente.

### `POST /api/v1/minecraft/fulfillments/claim` — chamado pelo EasyVip

### `POST /api/v1/minecraft/fulfillments/:id/complete` — chamado pelo EasyVip

### `POST /api/v1/minecraft/fulfillments/:id/fail` — chamado pelo EasyVip

Esses 3 seguem exatamente o contrato descrito em
`docs/integrations/webstore-fulfillment.md` do EasyVip (headers assinados,
canonical request/response, etc). Não deveriam precisar ser chamados por
nada além do próprio mod.

## Segurança

O que já está implementado:

- **Preço nunca vem do cliente** — só existe no catálogo local
  (`src/lib/products.ts`), o Mercado Pago só recebe o valor já resolvido.
- **Pagamento sempre reconfirmado pela API do Mercado Pago** — o corpo do
  webhook nunca é usado sozinho pra decidir se libera o VIP.
- **Assinatura do webhook do Mercado Pago** validada via `x-signature`
  (camada extra, opcional via `MP_WEBHOOK_SECRET`).
- **HMAC + Bearer token** em todas as chamadas do EasyVip, com
  comparação em tempo constante (`timingSafeEqual`) pra evitar timing
  attack nas comparações de segredo.
- **Anti-replay** com nonce de uso único (gravado atomicamente via
  `create()`, sem janela de corrida).
- **Idempotência** de pagamento (um `payment_id` aprovado só gera um
  fulfillment, mesmo com reentregas paralelas do webhook) e de conclusão
  (`/complete` chamado duas vezes não duplica nada).
- **Lease com expiração automática** — se o EasyVip cair no meio do
  processo, o item volta pro pool em vez de ficar travado pra sempre.
- **Erros nunca vazam stack trace** pro EasyVip, só código + mensagem
  curta.
- **Rate limit básico** no checkout (cooldown de 2 min por nick+plano).

Limitações conhecidas / o que considerar depois:

- Não há rate limiting robusto por IP no `/api/checkout` (considere
  Vercel Firewall ou um serviço tipo Upstash Redis se o tráfego crescer).
- O anti-replay depende de limpeza periódica da coleção `easyvip_nonces`
  (os documentos guardam `expiresAt`, mas o Firestore não expira sozinho
  — configure uma [regra de TTL do Firestore](https://firebase.google.com/docs/firestore/ttl)
  nesse campo, ou rode uma limpeza manual de tempos em tempos).
- Respostas de erro de autenticação (401) não são assinadas — nesse ponto
  do fluxo ainda não sabemos qual segredo usar com segurança, então isso
  é esperado, não um bug.

## Estrutura

```
src/
├── app/api/
│   ├── checkout/route.ts                                  # cria cobrança
│   ├── webhooks/mercadopago/route.ts                       # recebe pagamento aprovado
│   └── v1/minecraft/fulfillments/
│       ├── claim/route.ts
│       └── [fulfillmentId]/{complete,fail}/route.ts
└── lib/
    ├── config.ts        # leitura de env vars (falha alto se faltar segredo)
    ├── auth.ts           # Bearer + HMAC + anti-replay
    ├── hmac.ts            # canonical request/response + assinatura
    ├── firestore.ts       # Firebase Admin
    ├── fulfillments.ts    # regras de negócio (claim/complete/fail)
    ├── mercadopago.ts     # checkout + verificação de webhook
    ├── mojang.ts          # resolve nick → UUID
    ├── products.ts        # catálogo de VIPs (preço + tier + duração)
    └── types.ts
```

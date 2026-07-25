# Integração Frontend (Claude Design) ↔ Backend (Vercel)

Este guia mostra o que trocar no projeto do Claude Design para o site
parar de ser um mockup e passar a falar com o backend real.

Base da API (backend na Vercel):
```
https://arcano-tech-vip-store.vercel.app
```

---

## 1. Botão de comprar → cria cobrança real

Hoje, no `renderVals()`, o clique de compra só troca de tela:

```js
buy:()=>{ ...; this.setState({ plan:p.id }); this.go('checkout'); }
```

E o botão "Pagar" no checkout é fake:

```js
pay:()=>this.go('confirm'),
```

**Troque o `pay:` por isto** (chama o backend, cria a preferência no
Mercado Pago e manda o jogador pro checkout oficial):

```js
pay: async () => {
  const nick = this.state.nick.trim();
  const plan = this.state.plan; // 'iniciado' | 'arcanista' | 'arquimago'
  const sku = { iniciado:'vip_iniciado_30d', arcanista:'vip_arcanista_30d', arquimago:'vip_arquimago_30d' }[plan];

  if (!nick) { this.go('shop'); return; }

  this.setState({ paying:true });
  try {
    const res = await fetch('https://arcano-tech-vip-store.vercel.app/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, nick }),
    });
    const data = await res.json();

    if (!res.ok) {
      // data.error: 'nick não encontrado' | 'pedido_recente_pendente' | ...
      this.setState({ paying:false, payError: data.message || data.error || 'Erro ao iniciar pagamento' });
      return;
    }

    // Redireciona pro checkout oficial do Mercado Pago
    window.location.href = data.checkoutUrl;
  } catch (e) {
    this.setState({ paying:false, payError:'Falha de conexão. Tente novamente.' });
  }
},
```

> O formulário de cartão desenhado na tela de checkout é decorativo: quem
> coleta os dados de cartão/Pix é o **Mercado Pago**, na página pra onde
> `checkoutUrl` leva. Isso é o correto — seus dados de cartão nunca passam
> pelo seu site. Pode manter o visual como "preview" ou simplificar pra só
> o resumo + botão "Pagar com Mercado Pago".

---

## 2. Tela de confirmação → confirma de verdade

O Mercado Pago devolve o jogador pra:
```
https://arcanotech-vipstore.web.app/?status=sucesso&order=<ORDER_ID>
```

No início do componente, leia esses parâmetros e confirme o pedido pelo
backend (em vez de só assumir que deu certo):

```js
// dentro do construtor/init do componente
const params = new URLSearchParams(window.location.search);
const orderId = params.get('order');
if (orderId) {
  this.setState({ page:'confirm', confirmOrderId:orderId, confirmLoading:true });
  this.checkOrder(orderId);
}
```

```js
checkOrder: async function(orderId){
  try {
    const res = await fetch(`https://arcano-tech-vip-store.vercel.app/api/orders/${orderId}/status`);
    const data = await res.json();
    // data.paymentStatus: 'created' | 'paid' | 'fulfilled'
    // data.deliveryStatus: 'pending' | 'delivered' | 'failed'
    this.setState({
      confirmLoading:false,
      confirmPaid: data.paymentStatus !== 'created',
      confirmDelivered: data.deliveryStatus === 'delivered',
      confirmNick: data.nick,
    });
    // Se ainda não entregou, tenta de novo em alguns segundos (polling do EasyVip leva ~15s)
    if (data.paymentStatus !== 'created' && data.deliveryStatus === 'pending') {
      setTimeout(()=>this.checkOrder(orderId), 5000);
    }
  } catch(e) {
    this.setState({ confirmLoading:false });
  }
},
```

Na tela de confirmação, use `confirmDelivered` pra mostrar "VIP já ativo no
jogo ✓" vs "Pagamento aprovado, entregando em instantes…".

---

## 3. Login do admin → Firebase Auth de verdade

Hoje o login aceita qualquer coisa:

```js
submitLogin:(e)=>{ e.preventDefault(); if(S.adminUser.trim() && S.adminPass.trim()){ ... loggedIn:true ... } }
```

**Isso precisa sair.** Configure o Firebase Auth no projeto (SDK web) e
troque por autenticação real. Passos:

1. No Firebase Console → Authentication → Sign-in method → habilite
   **Email/senha**.
2. Ainda no console, crie **manualmente** a sua conta de admin (aba Users →
   Add user). Não deixe cadastro público aberto.
3. No Claude Design, adicione o SDK do Firebase Auth e troque o
   `submitLogin` por:

```js
submitLogin: async (e) => {
  e.preventDefault();
  try {
    const { getAuth, signInWithEmailAndPassword } = window.firebaseAuth; // ver init abaixo
    await signInWithEmailAndPassword(getAuth(), this.state.adminUser, this.state.adminPass);
    this.setState({ loggedIn:true, loginError:false, page:'dashboard' });
    window.scrollTo(0,0);
  } catch (err) {
    this.setState({ loginError:true });
  }
},
```

Init do Firebase (uma vez, no `<head>` ou topo do script):

```html
<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
  import { getAuth, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
  const app = initializeApp({
    apiKey: "SUA_API_KEY_WEB",           // do Firebase Console → Config do projeto → Apps Web
    authDomain: "arcanotech-vipstore.firebaseapp.com",
    projectId: "arcanotech-vipstore",
  });
  window.firebaseAuth = { getAuth, signInWithEmailAndPassword, onAuthStateChanged };
</script>
```

> A `apiKey` do Firebase **web** não é um segredo — ela é pública por
> design e pode aparecer no front. Quem protege o acesso são as regras de
> Auth + Firestore, não a apiKey.

---

## 4. Tela de Configurações do admin → status real, sem segredos

Os `const MP_TOKEN = '...'`, `const FULF_SECRET = '...'` chumbados no
script **precisam ser removidos**. Eles não devem existir no front.

Substitua por uma chamada ao endpoint de status (que nunca devolve o valor
do segredo, só se está configurado + os últimos 4 caracteres):

```js
loadAdminStatus: async function(){
  const res = await fetch('https://arcano-tech-vip-store.vercel.app/api/admin/status', {
    headers: { 'Authorization': 'Bearer ' + ADMIN_STATUS_TOKEN }, // ver nota abaixo
  });
  const s = await res.json();
  // s.mercadoPago.configured (bool) + s.mercadoPago.tokenLast4 ('...1234')
  // s.mercadoPago.webhookSignatureEnabled (bool)
  // s.fulfillment.serverId, s.fulfillment.hmacKeyIds[]
  this.setState({ adminStatus: s });
},
```

Na tela, em vez de mostrar o token, mostre:
`Mercado Pago: conectado ✓ (••••{{tokenLast4}})`.

> **Nota sobre o `ADMIN_STATUS_TOKEN`:** por simplicidade este endpoint usa
> um token fixo. Como o painel roda no navegador, esse token acabaria
> visível no front. Duas opções:
> - **Aceitável pra começar:** trate o painel como "somente leitura de
>   status" e gere um token só pra isso (ele não dá acesso a nada além de
>   ver se está configurado). Ainda assim, prefira não deixá-lo no HTML
>   público — injete via variável no build.
> - **Ideal (recomendado a seguir):** trocar esse token por verificação do
>   **ID token do Firebase Auth** do admin logado. Aí o backend valida que
>   quem chama é a sua conta, sem token fixo nenhum no front. Posso
>   implementar isso quando você quiser.

---

## Resumo do que configurar na Vercel (Environment Variables)

Além das que você já tem, adicione:

| Variável | Valor |
|---|---|
| `FRONTEND_URL` | `https://arcanotech-vipstore.web.app` |
| `CORS_ALLOWED_ORIGINS` | `https://arcanotech-vipstore.web.app,https://arcanotech-vipstore.firebaseapp.com` |
| `ADMIN_STATUS_TOKEN` | uma string aleatória longa (só se for usar o painel de status) |

Depois de adicionar, **redeploy** na Vercel pra aplicar.

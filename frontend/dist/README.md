# Arcano Tech — Loja VIP (frontend)

Site estático pronto para **Firebase Hosting**. O build é um único `public/index.html`
autocontido (HTML + CSS + JS + imagens embutidas), gerado a partir do design-fonte.

## Estrutura (padrão MVC)

O código-fonte segue MVC dentro do componente da aplicação:

- **Model** — dados e estado: catálogo de planos/SKUs, FAQs, regras, termos,
  vendas/fulfillments, VIPs ativos e o objeto `state` (nick, plano, método de
  pagamento, filtros, sessão do admin). É a "fonte da verdade" da tela.
- **View** — o template declarativo: todas as telas (Home, Regras, Termos,
  Planos, Checkout, Confirmação, Login, Dashboard, Relatórios, Fulfillments,
  VIPs, Configurações) montadas com estilos inline e componentes de repetição.
- **Controller** — os handlers: navegação entre telas (`go*`), binding de
  formulários (nick, login), toggles de máscara de token/secret, filtros de
  relatório/fulfillment/VIP e o fluxo de compra.

> Observação: a navegação é client-side (troca de estado), por isso o
> `rewrites` do Firebase aponta tudo para `/index.html`.

## Publicar

```bash
npm install -g firebase-tools     # se ainda não tiver
firebase login
firebase use --add                # selecione/defina o projeto (ver .firebaserc)
firebase deploy --only hosting
```

O conteúdo servido fica em `public/`. Basta subir a pasta — nenhum build extra.

## Pendências para produção

- **Vídeo do hero**: o hero referencia `hero.mp4` (placeholder). Enquanto não
  existir, o poster (imagem) cobre a área normalmente. Para ativar, coloque um
  `hero.mp4` em `public/` e mantenha a tag `<video>`.
- **Backend real**: os dados do admin (receita, fulfillments, VIPs) e o
  checkout são mockados no protótipo. Ligue-os aos endpoints do seu Rails/
  EasyVip e ao Mercado Pago na implementação.
- **Imagens**: os renders foram otimizados (JPEG). Substitua por versões finais
  mantendo os nomes em `public/` se quiser trocar.

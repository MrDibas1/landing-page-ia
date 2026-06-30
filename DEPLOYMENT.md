# Deploy de produção

## EasyPanel

- Repositório: `MrDibas1/landing-page-ia`
- Comando: `npm start`
- Porta: valor de `PORT` (recomendado: `3000`)
- Domínio: `ai.estudiofocus.online`
- Health check: `/health`
- Volume persistente: montar `/data/runtime`

Cadastre as variáveis de `.env.example` no EasyPanel. Não envie o arquivo `.env` ao GitHub. Em produção, use:

```env
NODE_ENV=production
SUCCESS_URL=https://ai.estudiofocus.online/success.html
FAILURE_URL=https://ai.estudiofocus.online/
PENDING_URL=https://ai.estudiofocus.online/
WEBHOOK_URL=https://ai.estudiofocus.online/webhook
GTM_SERVER_URL=https://sst.estudiofocus.online
RUNTIME_DATA_DIR=/data/runtime
GTM_SERVER_PREVIEW_HEADER=
UTMIFY_IS_TEST=false
```

Os demais valores (`MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET` e `UTMIFY_TOKEN`) devem ser cadastrados como segredos no EasyPanel.

## Mercado Pago

Na aplicação usada pelo Checkout Pro:

1. Abra **Webhooks > Configurar notificações**.
2. Selecione o modo de produção.
3. Cadastre `https://ai.estudiofocus.online/webhook`.
4. Habilite o evento **Pagamentos**.
5. Salve e copie a assinatura secreta para `MP_WEBHOOK_SECRET`.

O backend também adiciona `source_news=webhooks` à URL enviada nas preferências para evitar o IPN legado.

## Validação depois do deploy

1. Confirme `GET https://ai.estudiofocus.online/health` com status `200`.
2. Verifique no JSON que as três configurações retornam `true`.
3. Faça uma compra real de baixo valor.
4. Confirme webhook `200`, UTMify, Meta Browser/Server, deduplicação, GA4 e Clarity.

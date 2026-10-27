# Configurar Mercado Pago

A API cria novas cobranças na **Orders API (`/v1/orders`)**, mantendo Checkout Transparente. Tentativas anteriores conservam `providerApi=payments` e continuam sendo consultadas em `/v1/payments`. A conta recebedora é a do organizador; não há `application_fee` nem split destinado ao dono da LigaHub. A cobrança externa combinada com o organizador permanece fora do sistema. [Migração oficial de Payments para Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/migrate-payments-to-orders).

O gateway traduz Orders para os estados já utilizados pela LigaHub. Uma vaga só pode ser confirmada quando a order e sua única transação estão `processed/accredited`, com referência, recebedor, moeda, valor base, valor creditado, meio e parcelas validados. Reembolso parcial é sinalizado como `in_mediation`, preservando a vaga que já estava confirmada; não é tratado como estorno total. Estados desconhecidos e resultados ambíguos não aprovam inscrições.

A requisição original fica criptografada enquanto uma criação tem resultado incerto. Uma repetição conserva a chave e o corpo original, incluindo o prazo do Pix. O conteúdo criptografado é removido quando a order é identificada ou a requisição é explicitamente recusada; tokens e CPF não são expostos no histórico. A reconciliação busca a order pela referência e pelo intervalo de criação obrigatório da Orders API.

## Interrupção antes do envio

Novas tentativas começam com `submissionStarted=false`. Imediatamente antes de chamar o provedor, a API marca o início do envio sob o bloqueio do evento e verifica novamente a tentativa e a disponibilidade da inscrição. Se a reserva expirar antes desse marco, a reconciliação encerra somente a tentativa comprovadamente nunca enviada, como `cancelled/not_submitted_before_expiration`, remove a requisição criptografada e registra o motivo na auditoria. O participante pode renovar a reserva se ainda houver vaga e prazo.

`submissionStarted=true` indica que pode ter ocorrido envio, mesmo quando houve timeout. A ausência em uma busca não autoriza descartar essa tentativa nem criar outra cobrança. Registros anteriores à migration ficam com valor nulo, também tratado como resultado incerto. A migration adiciona uma coluna opcional e não reconstrói o histórico por suposição. Não misture instâncias antigas, que desconhecem essa marcação, com instâncias que executam a recuperação; em uma reversão, mantenha a reconciliação desativada até todas as instâncias usarem a mesma versão e os casos incertos serem revisados.

## Configuração local

### Conta fixa de teste (sem OAuth)

Para testar antes de liberar OAuth, configure `MERCADO_PAGO_TEST_MODE=true`, `MERCADO_PAGO_TEST_ACCESS_TOKEN` e `MERCADO_PAGO_TEST_PUBLIC_KEY` com o par de credenciais de teste da mesma aplicação. Não use o prefixo do token como prova de ambiente: a API consulta a conta e exige a identificação `test_user` e país Brasil.

Defina `MERCADO_PAGO_TEST_OWNER_EMAIL` com o e-mail de um administrador ou organizador ativo da LigaHub. Se houver exatamente um organizador ativo, o comando pode selecioná-lo sem essa variável. Execute as migrations e `npm.cmd run payments:connect-test`. O comando verifica a conta no Mercado Pago e armazena o token criptografado; não cria pagamentos. Repetir com a mesma conta atualiza suas credenciais sem criar um novo vínculo. Não substitui uma conta OAuth existente.

Essa alternativa não exige Client Secret nem URL de callback OAuth. Para pagamentos com notificações, ainda configure `MERCADO_PAGO_NOTIFICATION_URL` e `MERCADO_PAGO_WEBHOOK_SECRET`. `npm.cmd run payments:check` reconhece automaticamente esse modo. A conta fica marcada como teste no banco e seu token é bloqueado quando `MERCADO_PAGO_TEST_MODE` não é `true`.

Não versione o `.env` nem compartilhe os tokens. Para produção, remova as variáveis de conta fixa, configure OAuth e conecte a conta real do organizador. Alterar apenas a variável de ambiente não transforma uma conta de teste em conta real.

### Conta conectada por OAuth

1. Crie uma aplicação de Checkout Transparente no painel Mercado Pago Developers. Cadastre a URL HTTPS exata do callback e habilite PKCE.
2. Configure notificações do tópico `order` e mantenha `payment` para as tentativas legadas. Use a URL HTTPS do webhook e obtenha seu segredo completo de assinatura.
3. Preencha as variáveis abaixo **no `.env` local**, sem enviar credenciais no chat.

```dotenv
MERCADO_PAGO_CLIENT_ID=identificador-da-aplicacao
MERCADO_PAGO_CLIENT_SECRET=segredo-da-aplicacao
MERCADO_PAGO_TEST_MODE=true
MERCADO_PAGO_REDIRECT_URI=https://SEU_HOST/payments/accounts/callback
MERCADO_PAGO_NOTIFICATION_URL=https://SEU_HOST/payments/webhook
MERCADO_PAGO_WEBHOOK_SECRET=segredo-da-assinatura
PAYMENT_RECONCILIATION_ENABLED=true
```

`npm.cmd run env:init` prepara `CREDENTIALS_ENCRYPTION_KEY`. Preserve essa chave: trocá-la sem migrar as credenciais impede ler contas já conectadas. Não coloque o Access Token do vendedor nessas variáveis. A aplicação obtém e criptografa o token após autorização do organizador.

Para testar uma API local, utilize um endereço HTTPS acessível pelo provedor que encaminhe ao servidor local. Cadastre o webhook no painel e em `MERCADO_PAGO_NOTIFICATION_URL`; para OAuth, configure também o callback. `localhost` sozinho não recebe notificações externas. A Orders API não aceita `notification_url` no corpo da cobrança: configure as notificações no painel. Um túnel temporário só funciona enquanto seu processo estiver ativo; se seu endereço mudar, atualize o painel e o `.env` e reinicie a API.

## Conectar o organizador

Antes de conectar a conta, execute `npm.cmd run payments:check`. O comando verifica o preenchimento das variáveis, o formato das URLs e da chave de criptografia sem imprimir segredos nem chamar o Mercado Pago. Pendências produzem código de saída 1. Um resultado OK não comprova validade das credenciais nem acessibilidade do túnel.

A autorização do MCP no Cursor ou Codex pertence à ferramenta de desenvolvimento. Ela não conecta automaticamente o organizador à LigaHub e não preenche o `.env` da API.

Para testes locais, inicie a API na porta 3000 e encaminhe um túnel HTTPS para essa porta. Use o host fornecido pelo túnel nas URLs de callback e webhook e cadastre essas mesmas URLs na aplicação Mercado Pago. Se o host mudar, atualize o painel e o `.env`, reinicie a API e gere uma nova autorização.

1. Faça login na API como organizador.
2. Chame `POST /payments/accounts/authorize` com `{}` e JWT. Como administrador, envie `{ "ownerId": "UUID_DO_ORGANIZADOR" }`.
3. Abra `authorizationUrl` e autorize a conta que receberá os pagamentos.
4. O callback consome o estado uma única vez e armazena credenciais criptografadas. Consulte `GET /payments/accounts` para verificar `connected`.

O fluxo OAuth usa `authorization_code`, PKCE e renovação por `refresh_token`. Para sandbox, a implementação envia `test_token: "true"`. Veja [OAuth e credenciais de sandbox](https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation).

Reconectar outra conta desativa a anterior para novas cobranças. Tentativas antigas conservam o vínculo original para consulta e reconciliação. Não apague contas antigas do banco.

## Roteiro de sandbox

- Prepare comprador e vendedor de teste no painel, seguindo as instruções de testes exibidas para sua aplicação. Autorize a conta recebedora no ambiente de teste, em uma sessão separada da conta proprietária da aplicação.
- Publique um evento futuro, faça a inscrição e consulte a configuração de checkout.
- Gere token de cartão pelo SDK do Mercado Pago com dados de teste, ou inicie um Pix usando o roteiro do provedor.
- Verifique no painel e na API o recebedor, referência, valor e situação do pagamento.
- Teste repetição da mesma chave de idempotência, aprovação, rejeição, expiração e reembolso.
- Confirme chegada de webhook válido e recuperação pela reconciliação se a notificação não chegar.

Os testes automatizados usam um gateway simulado e verificam regras e persistência; não homologam a aplicação no Mercado Pago. A tokenização deve ocorrer pelo SDK do provedor, fora da LigaHub API, e as parcelas apresentadas devem ser as disponíveis para a conta e o cartão.

### Validação local em 12/10/2026

- Pix de R$ 10: criado pela rota da LigaHub, QR Code retornado, aprovação simulada no Mercado Pago e vaga confirmada pela reconciliação. Repetir chave e corpo retornou a mesma tentativa.
- Mastercard de teste, R$ 50 em três parcelas: tokenização no provedor, pagamento enviado pela LigaHub e inscrição confirmada. Os dados brutos do cartão não passaram pelo backend da LigaHub.
- R$ 10 em três parcelas foi recusado com `invalid_transaction_amount`. Não deduza um mínimo universal desse resultado: utilize valores e opções aceitos pelo Mercado Pago.
- Webhook HTTPS de tipo `order`, assinado localmente e encaminhado pelo túnel: HTTP 201, consulta da order no provedor e confirmação sem duplicar a fila de e-mails. Assinatura inválida: rejeitada.
- Uma confirmação por inscrição foi entregue ao **Mailpit local**, e os tokens de consulta retornaram `confirmed`. Isso não comprova entrega por Resend a uma caixa externa.
- **Pendente:** observar uma notificação enviada automaticamente pelo Mercado Pago. O diagnóstico do MCP da aplicação não apresentou notificações. A reconciliação funcionou independentemente desse envio.

Em 26/10/2026, o envio externo por Resend, a confirmação pela outbox e a recuperação de acesso foram validados separadamente com dados locais de homologação, sem cobrança. Consulte [as evidências e os limites do teste de e-mails](HOMOLOGACAO_EMAILS.md). Essa validação não comprova o fluxo completo desde uma atualização espontânea de pagamento até o e-mail.

Nenhuma cobrança real foi efetuada. Para o cenário de cartão aprovado, utilize o comprador `test@testuser.com`, titular `APRO`, CPF de teste `12345678909`, Mastercard `5480 8328 0103 3311`, CVV `123`, validade `11/30`, conforme o [roteiro oficial de cartões](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/cards). Para Pix, siga o [roteiro oficial de Pix](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix). Não tente pagar um QR de sandbox em um aplicativo bancário real.

## Pix, parcelamento e taxas

O provedor exige vencimento Pix entre 30 minutos e 30 dias, informado em `expiration_time` como duração ISO 8601. A API estende a reserva ao iniciar Pix para respeitar o mínimo, com margem de transmissão. Não oferece Pix quando não resta tempo suficiente antes do evento. [Documentação Pix da Orders API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/pix).

A API envia o preço base e a quantidade de parcelas, sem inventar juros. O futuro checkout deve consultar e apresentar as opções reais do Mercado Pago. **Juros de parcelamento e tarifa de processamento são conceitos diferentes**: a configuração de parcelas não garante que todas as tarifas da venda sejam repassadas ao participante. Confira as condições da conta recebedora no sandbox e antes de publicar valores. [Regras gerais de tarifas](https://www.mercadopago.com.br/developers/pt/docs/getting-started).

O saldo líquido e os prazos de disponibilização não são calculados pela LigaHub. Reembolsos são decididos e executados pelo organizador no provedor; notificações e reconciliação atualizam o histórico.

## Webhook

Não simule uma aprovação enviando apenas `{ "status": "approved" }`. A API valida a assinatura e consulta o provedor antes de alterar a inscrição. Orders usa `type: "order"`, `data.id` com o ID da order e o mesmo ID na query `data.id`. A composição da assinatura preserva o ID original, conforme o SDK Node.js oficial atual, e mantém compatibilidade com assinaturas anteriores calculadas com o ID em minúsculas. Os dois formatos exigem HMAC-SHA256 válido com a chave configurada, identificador da requisição e timestamp dentro da tolerância. Notificações de uma API não são aplicadas a tentativas da outra. Confira [Notificações de Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications) e a [implementação oficial do SDK](https://github.com/mercadopago/sdk-nodejs/blob/master/src/utils/webhook/index.ts).

### Diagnóstico e simulação em 20/10/2026

A primeira falha de configuração tinha uma chave local divergente da aplicação. Depois da atualização do segredo e reinício da API, a simulação ainda recebeu HTTP 401. O diagnóstico seguro identificou `signature_mismatch`, com todos os campos presentes e timestamp dentro da tolerância. A implementação anterior convertia o ID alfanumérico para minúsculas; o SDK atual preserva seu valor original.

Após ajustar essa compatibilidade, o proprietário executou novamente a simulação no painel do Mercado Pago e confirmou sucesso. Testes públicos assinados localmente também retornaram HTTP 201 com ID original e normalizado, HTTP 401 com assinatura inválida e mantiveram uma única tarefa de confirmação na outbox.

Rejeições agora registram categoria e presença dos campos, sem gravar segredo, assinatura, corpo ou valores recebidos. As categorias distinguem campos inválidos, formato da assinatura, timestamp inválido, timestamp vencido e HMAC divergente. As respostas públicas continuam sem esses detalhes internos.

O sucesso da simulação comprova o recebimento desse teste enviado pelo painel. Não comprova, sozinho, entrega automática de uma atualização espontânea de pagamento; o diagnóstico do plugin continuou sem notificações registradas nesta aplicação. Não foram feitas cobranças reais.

## Produção

Somente após os testes, configure `MERCADO_PAGO_TEST_MODE=false`, use HTTPS definitivo e conecte novamente a conta real. Essa mudança permite cobranças reais; nenhuma transação real foi executada nesta entrega. Os valores recebidos devem ser verificados na conta autorizada do organizador.

# Configurar Mercado Pago

A API utiliza Payments API (`/v1/payments`) com Checkout Transparente. A conta recebedora é conectada por OAuth; não há `application_fee` nem split destinado ao dono da LigaHub. A cobrança externa combinada com o organizador permanece fora do sistema.

## Configuração local

1. Crie uma aplicação de Checkout Transparente no painel Mercado Pago Developers. Cadastre a URL HTTPS exata do callback e habilite PKCE.
2. Configure notificações do tópico `payment` para a URL HTTPS do webhook e obtenha seu segredo de assinatura.
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

Para testar uma API local, utilize um endereço HTTPS acessível pelo provedor que encaminhe ao servidor local. Cadastre o mesmo endereço no painel e nas duas variáveis de URL. O endereço local `localhost` sozinho não recebe notificações externas. O túnel ou hospedagem não foram configurados nesta entrega.

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

Não chame isso de pagamento validado até completar esse roteiro. Os testes automatizados do projeto usam um gateway simulado e verificam regras e persistência; não homologam sua aplicação no Mercado Pago. O futuro frontend ainda precisa implementar tokenização e escolha das parcelas disponíveis.

## Pix, parcelamento e taxas

O provedor exige vencimento Pix entre 30 minutos e 30 dias. A API estende a reserva ao iniciar Pix para respeitar o mínimo, com margem de transmissão. Não oferece Pix quando não resta tempo suficiente antes do evento. [Documentação Pix da Payments API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix?scope=prod).

A API envia o preço base e a quantidade de parcelas, sem inventar juros. O futuro checkout deve consultar e apresentar as opções reais do Mercado Pago. **Juros de parcelamento e tarifa de processamento são conceitos diferentes**: a configuração de parcelas não garante que todas as tarifas da venda sejam repassadas ao participante. Confira as condições da conta recebedora no sandbox e antes de publicar valores. [Regras gerais de tarifas](https://www.mercadopago.com.br/developers/pt/docs/getting-started).

O saldo líquido e os prazos de disponibilização não são calculados pela LigaHub. Reembolsos são decididos e executados pelo organizador no provedor; notificações e reconciliação atualizam o histórico.

## Webhook

Não simule uma aprovação enviando apenas `{ "status": "approved" }`. A API valida a assinatura e consulta o provedor antes de alterar a inscrição. Confira o formato de assinatura em [Webhooks oficiais](https://www.mercadopago.com.br/developers/en/docs/links-and-debts/additional-content/your-integrations/notifications/webhooks).

## Produção

Somente após os testes, configure `MERCADO_PAGO_TEST_MODE=false`, use HTTPS definitivo e conecte novamente a conta real. Essa mudança permite cobranças reais; nenhuma transação real foi executada nesta entrega. Os valores recebidos devem ser verificados na conta autorizada do organizador.

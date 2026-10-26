# Homologação de pagamentos — 26/10/2026

## Resultado parcial

- Os PRs #20, #21 e #22 foram integrados à main, conferida em `bab2353`.
- Foi iniciado um túnel HTTPS temporário para um proxy local que aceita somente POST em `/payments/webhook` e GET em `/health`. A verificação externa de saúde retornou HTTP 200.
- A conta recebedora foi consultada em `/users/me` e identificada por `test_user`, país MLB e ID `3747699904`. O vínculo local tinha `isTest=true`; a credencial criptografada da conta correspondia à credencial de teste local. O teste exigiu `MERCADO_PAGO_TEST_MODE=true`.
- Uma inscrição foi criada pela rota pública da LigaHub e recebeu pagamento de R$ 50 em sandbox com cartão Mastercard de teste do provedor. Nenhuma cobrança real foi realizada.
- A order `ORDTST01M5WXSBB1Z11GQ76R3H1P01ZS` retornou `processed/accredited`; a tentativa local ficou `approved`, e a inscrição foi confirmada.
- A confirmação foi gerada pela aplicação na resposta de criação da order. A outbox foi processada somente para essa inscrição; o Resend informou `delivered` para o e-mail identificado explicitamente como sandbox.
- Não foi recebido callback automático pelo proxy durante a observação. Não foi gerada uma assinatura local para apresentar como notificação do provedor.

## Identificadores e credenciais conferidos

A aplicação principal acessível pelo conector é `4694337772388028`. O campo `integration_data.application_id` da order de teste, porém, identifica a aplicação `2620982604520894`.

O callback sandbox foi atualizado na LigaHub. A tentativa de configurar diretamente o outro identificador foi recusada pelo conector com `OAuth ownership validation failed`.

Uma verificação posterior comparou, por SHA-256, o Access Token e a Public Key locais com as credenciais de teste retornadas pelo conector para a LigaHub. Ambas coincidiram. Portanto, a diferença de identificador na order não demonstra uso de credenciais incorretas, e a hipótese anterior de que seria necessário localizar outra aplicação no painel foi retirada. A ausência de callbacks automáticos continua sem causa comprovada.

## Próxima ação necessária

1. Abrir a aplicação LigaHub `4694337772388028`, acessar Configuração de Webhooks e selecionar Teste. O callback sandbox e os tópicos `order` e `payment` já foram configurados pelo conector.
2. Executar a simulação pelo painel, com evento Order e o identificador `ORDTST01M5WXSBB1Z11GQ76R3H1P01ZS`. O endereço temporário depende do processo local e não deve ser reutilizado como endereço de produção.
3. Conferir o resultado do envio no painel e no receptor local. A simulação comprova o recebimento desse teste, mas não substitui uma notificação automática decorrente de pagamento.
4. Inspecionar o monitoramento de Webhooks no ambiente Teste. Se não houver notificações automáticas, investigar com o suporte do provedor, como orientado na documentação oficial, sem trocar credenciais por suposição.
5. Validar também o estado pendente seguido de aprovação, a recuperação por reconciliação, recusa, expiração e reembolso de teste.

Referência: [configuração, simulação e monitoramento de notificações de orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications).

## Limites adicionais

A tokenização desta execução foi realizada diretamente na API do Mercado Pago, fora do backend da LigaHub. A avaliação dessa order pelo conector retornou pontuação 33, abaixo do mínimo 73, incluindo ausência de evidência de SDK frontend e Device ID nesse teste. O frontend do projeto possui integração com o SDK; esta execução não passou pela interface e não homologa esse caminho. Não foi aplicada uma alteração de código para mascarar os critérios da avaliação.

O envio da outbox foi controlado, sem ativar o processamento de outras inscrições. A operação contínua em produção, os links públicos HTTPS e a homologação visual permanecem fora desta evidência parcial.

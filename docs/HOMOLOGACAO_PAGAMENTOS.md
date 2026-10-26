# Homologação de pagamentos — 26/10/2026

## Resultado parcial

- Os PRs #20, #21 e #22 foram integrados à main, conferida em `bab2353`.
- Foi iniciado um túnel HTTPS temporário para um proxy local que aceita somente POST em `/payments/webhook` e GET em `/health`. A verificação externa de saúde retornou HTTP 200.
- A conta recebedora foi consultada em `/users/me` e identificada por `test_user`, país MLB e ID `3747699904`. O vínculo local tinha `isTest=true`; a credencial criptografada da conta correspondia à credencial de teste local. O teste exigiu `MERCADO_PAGO_TEST_MODE=true`.
- Uma inscrição foi criada pela rota pública da LigaHub e recebeu pagamento de R$ 50 em sandbox com cartão Mastercard de teste do provedor. Nenhuma cobrança real foi realizada.
- A order `ORDTST01M5WXSBB1Z11GQ76R3H1P01ZS` retornou `processed/accredited`; a tentativa local ficou `approved`, e a inscrição foi confirmada.
- A confirmação foi gerada pela aplicação na resposta de criação da order. A outbox foi processada somente para essa inscrição; o Resend informou `delivered` para o e-mail identificado explicitamente como sandbox.
- Não foi recebido callback automático pelo proxy durante a observação. Não foi gerada uma assinatura local para apresentar como notificação do provedor.

## Recusa, expiração de reserva e reconciliação

Em uma segunda execução, em 26/10/2026 às 18h35, horário de Brasília, foram conferidos:

| Cenário | Execução e resultado |
| --- | --- |
| Cartão recusado | O cartão fictício com titular `OTHE` gerou a order `ORDTST01M5X25R6ND5GJRV27EJQQSH03`, normalizada como `rejected/rejected_by_issuer`. A inscrição permaneceu reservada, sem confirmação e sem tarefa de e-mail. |
| Resposta inicialmente incerta | A primeira requisição do cenário de recusa retornou HTTP 503. A repetição com a mesma chave e o mesmo corpo recuperou a recusa com HTTP 201. Foi encontrada somente uma tentativa local para a inscrição. O HTTP 503 inicial não foi considerado uma recusa confirmada. |
| Reserva expirada | A data de expiração foi retrocedida apenas na inscrição fictícia. A consulta retornou `expired`, novo pagamento foi bloqueado com HTTP 409, nenhuma tentativa foi criada e a vaga voltou a ficar disponível. Isso não representa uma expiração observada no provedor. |
| Pix pendente | A criação pela API da LigaHub gerou a order `ORDTST01M5X2714385S8VRDTCA7S5VBV`, inicialmente `pending`, com os dados de aprovação sandbox do roteiro do provedor. |
| Reconciliação | Após aprovação automática do Pix no provedor, a rotina real `PaymentsService.reconcile()` consultou o Mercado Pago e atualizou a tentativa de `pending` para `approved`, confirmando a inscrição e gerando uma tarefa na outbox. A seleção de tentativas foi restrita ao ID de homologação por um adaptador de teste; outros registros não participaram da execução. |
| Repetição da reconciliação | Nova execução da rotina conservou uma única tarefa de confirmação. O estado remoto foi obtido no provedor real de sandbox, sem mock do gateway. |

A rotina de reconciliação foi chamada diretamente, sem ativar o timer global. A aplicação utilizada nesses testes manteve o envio periódico desativado; não houve envio externo adicional para esses cenários. Os resultados resumidos ficaram em `.test-temp/cenarios-pagamentos-resultado.json`, fora do versionamento; os tokens e dados necessários a repetição idempotente ficaram criptografados em arquivo local.

Também houve uma prova isolada do receptor HTTPS, com assinatura gerada localmente, que retornou HTTP 201 e `received: true`. Essa prova foi identificada como local e não foi tratada como simulação enviada pelo painel ou webhook automático do Mercado Pago.

## Identificadores e credenciais conferidos

A aplicação principal acessível pelo conector é `4694337772388028`. O campo `integration_data.application_id` da order de teste, porém, identifica a aplicação `2620982604520894`.

O callback sandbox foi atualizado na LigaHub. A tentativa de configurar diretamente o outro identificador foi recusada pelo conector com `OAuth ownership validation failed`.

Uma verificação posterior comparou, por SHA-256, o Access Token e a Public Key locais com as credenciais de teste retornadas pelo conector para a LigaHub. Ambas coincidiram. Portanto, a diferença de identificador na order não demonstra uso de credenciais incorretas, e a hipótese anterior de que seria necessário localizar outra aplicação no painel foi retirada. A ausência de callbacks automáticos continua sem causa comprovada.

## Etapa adiada e pendências

A simulação pelo painel e a observação do webhook automático foram adiadas por solicitação do usuário após o botão de envio não produzir uma requisição registrada no receptor. Permanecem sem homologação. Para retomar essa etapa:

1. Abrir a aplicação LigaHub `4694337772388028`, acessar Configuração de Webhooks e selecionar Teste. O callback sandbox e os tópicos `order` e `payment` já foram configurados pelo conector.
2. Executar a simulação pelo painel, com evento Order e o identificador `ORDTST01M5WXSBB1Z11GQ76R3H1P01ZS`. O endereço temporário depende do processo local e não deve ser reutilizado como endereço de produção.
3. Conferir o resultado do envio no painel e no receptor local. A simulação comprova o recebimento desse teste, mas não substitui uma notificação automática decorrente de pagamento.
4. Inspecionar o monitoramento de Webhooks no ambiente Teste. Se não houver notificações automáticas, investigar com o suporte do provedor, como orientado na documentação oficial, sem trocar credenciais por suposição.
5. Validar a expiração da cobrança no provedor. O reembolso de teste foi concluído conforme a seção abaixo; a recusa, a expiração da reserva local e a recuperação de Pix por reconciliação estão descritas acima.

Referência: [configuração, simulação e monitoramento de notificações de orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications).

## Limites adicionais

### Reembolso integral em sandbox

Em 26/10/2026, às 18h41 de Brasília, a order de cartão `ORDTST01M5WXSBB1Z11GQ76R3H1P01ZS` recebeu reembolso integral pelo endpoint `POST /v1/orders/{order_id}/refund`, com chave de idempotência estável e sem valor parcial no corpo. O provedor retornou HTTP 201 e `refunded/refunded`.

Antes da operação foram revalidados o modo de teste, a identificação `test_user` do recebedor, o vínculo local `isTest`, a correspondência da credencial criptografada e a referência externa da order à tentativa local. Somente a order sandbox previamente registrada foi utilizada.

A rotina real de reconciliação, restrita à tentativa `12f912bb-7192-4b81-b99f-5e7071ac1562`, consultou o provedor e atualizou o pagamento para `refunded` e a inscrição para `canceled`. Uma segunda execução manteve a quantidade de registros `payment.updated` na auditoria. O teste não dependeu de webhook e não implementou uma funcionalidade de reembolso automático na LigaHub.

Referência: [reembolsar uma order](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/refund-order/post).

#### Regressão automatizada do fluxo

Dois testes adicionais em `test/payments.integration.e2e-spec.ts` usam PostgreSQL e provedor simulado, sem chamadas financeiras externas. Eles verificam a consulta do participante com pagamento reembolsado e inscrição cancelada, o bloqueio de nova cobrança, a reutilização da vaga por outro participante e o descarte de confirmação ainda não enviada após cancelamento. Também conferem que repetir o reembolso ou receber nova aprovação para a tentativa já reembolsada não reabre a inscrição nem duplica a auditoria.

Quando existe outra tentativa aprovada, o segundo teste preserva a confirmação e impede a ocupação da mesma vaga por outro participante. Esses testes complementam a evidência real de sandbox; não representam novos reembolsos no provedor.

### Expiração no provedor permanece pendente

A documentação do Pix estabelece vencimento entre 30 minutos e 30 dias após a emissão. Também informa que o estado cancelado ou expirado pode ocorrer 30 dias após o vencimento de um pagamento não realizado. Portanto, o vencimento do QR Code e a mudança terminal de estado não devem ser tratados como o mesmo instante. Não foi realizada alteração artificial do estado remoto nem cancelamento manual para apresentar como expiração.

Referência: [integração Pix e prazo de vencimento](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/pix).

### Avaliação e operação contínua

A tokenização desta execução foi realizada diretamente na API do Mercado Pago, fora do backend da LigaHub. A avaliação dessa order pelo conector retornou pontuação 33, abaixo do mínimo 73, incluindo ausência de evidência de SDK frontend e Device ID nesse teste. O frontend do projeto possui integração com o SDK; esta execução não passou pela interface e não homologa esse caminho. Não foi aplicada uma alteração de código para mascarar os critérios da avaliação.

O envio da outbox foi controlado, sem ativar o processamento de outras inscrições. A operação contínua em produção, os links públicos HTTPS e a homologação visual permanecem fora desta evidência parcial.

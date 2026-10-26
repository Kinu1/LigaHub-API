# Homologação de pagamentos — 26/10/2026

## Resultado parcial

- Os PRs #20, #21 e #22 foram integrados à main, conferida em `bab2353`.
- Foi iniciado um túnel HTTPS temporário para um proxy local que aceita somente POST em `/payments/webhook` e GET em `/health`. A verificação externa de saúde retornou HTTP 200.
- A conta recebedora foi consultada em `/users/me` e identificada por `test_user`, país MLB e ID `3747699904`. O vínculo local tinha `isTest=true`; a credencial criptografada da conta correspondia à credencial de teste local. O teste exigiu `MERCADO_PAGO_TEST_MODE=true`.
- Uma inscrição foi criada pela rota pública da LigaHub e recebeu pagamento de R$ 50 em sandbox com cartão Mastercard de teste do provedor. Nenhuma cobrança real foi realizada.
- A order `ORDTST01M5WXSBB1Z11GQ76R3H1P01ZS` retornou `processed/accredited`; a tentativa local ficou `approved`, e a inscrição foi confirmada.
- A confirmação foi gerada pela aplicação na resposta de criação da order. A outbox foi processada somente para essa inscrição; o Resend informou `delivered` para o e-mail identificado explicitamente como sandbox.
- Não foi recebido callback automático pelo proxy durante a observação. Não foi gerada uma assinatura local para apresentar como notificação do provedor.

## Divergência encontrada

A aplicação principal acessível pelo conector é `4694337772388028`. O campo `integration_data.application_id` da order de teste, porém, identifica a aplicação `2620982604520894`.

O callback sandbox foi atualizado na aplicação principal, mas o conector recusou sua atualização na aplicação efetiva de teste com `OAuth ownership validation failed`: o proprietário OAuth conectado não é o proprietário dessa aplicação.

Essa diferença de aplicação é uma causa provável da ausência de notificações e deve ser resolvida antes de concluir a homologação. A configuração da aplicação principal não comprova que o webhook da aplicação efetiva de teste esteja configurado.

## Próxima ação necessária

1. Acessar a aplicação `2620982604520894` no painel da conta de teste que a possui, ou disponibilizar uma conexão OAuth do proprietário correto.
2. Configurar nessa aplicação o callback HTTPS de sandbox, com tópicos `order` e `payment`. O endereço temporário depende do processo local e deve ser obtido da sessão ativa, não reutilizado como endereço de produção.
3. Conferir o segredo de assinatura dessa aplicação e atualizá-lo somente no `.env` local, em `MERCADO_PAGO_WEBHOOK_SECRET`, se for diferente. Não compartilhar o segredo em mensagens ou commits. Reiniciar a API para carregar a configuração.
4. Criar uma nova order sandbox e observar o POST autenticado enviado automaticamente pelo provedor, sua resposta HTTP e o estado local. A confirmação síncrona já demonstrada não substitui essa evidência.
5. Validar também o estado pendente seguido de aprovação, a recuperação por reconciliação, recusa, expiração e reembolso de teste.

## Limites adicionais

A tokenização desta execução foi realizada diretamente na API do Mercado Pago, fora do backend da LigaHub. A avaliação dessa order pelo conector retornou pontuação 33, abaixo do mínimo 73, incluindo ausência de evidência de SDK frontend e Device ID nesse teste. O frontend do projeto possui integração com o SDK; esta execução não passou pela interface e não homologa esse caminho. Não foi aplicada uma alteração de código para mascarar os critérios da avaliação.

O envio da outbox foi controlado, sem ativar o processamento de outras inscrições. A operação contínua em produção, os links públicos HTTPS e a homologação visual permanecem fora desta evidência parcial.

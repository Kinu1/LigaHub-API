# Pix na conta da plataforma e repasse integral

## Operação escolhida: repasse manual

Configurar `MERCADO_PAGO_PAYOUT_MODE=manual` e `MERCADO_PAGO_PAYOUTS_ENABLED=false`. Este é o modo padrão. Não exige habilitar Payouts nem registrar chave Ed25519, porque a aplicação não envia dinheiro. O Mercado Pago continua confirmando as cobranças pelo webhook e pela reconciliação.

1. No Financeiro, cadastrar a chave Pix do organizador e aprová-la como administrador após conferir o beneficiário. O cadastro fica disponível mesmo antes de configurar a conta centralizada.
2. Configurar `MERCADO_PAGO_PIX_PLATFORM_ACCOUNT_ID` com o UUID interno da conta Mercado Pago da plataforma já conectada por OAuth, depois de cadastrar e aprovar o destino. Antes disso, as cobranças continuam usando a configuração anterior. Apenas novas cobranças centralizadas entram no controle de repasses.
3. Quando a inscrição estiver confirmada e o pagamento aprovado/acreditado, localizar o repasse pelo evento e participante e clicar em **Reservar e visualizar repasse**. A aplicação consulta o pagamento novamente, valida a inscrição e a chave, e reserva a operação para aquele administrador. Não envia uma transferência.
4. No aplicativo do Mercado Pago, transferir o valor integral à chave exibida e conferir o beneficiário antes de confirmar. As tarifas são assumidas pela plataforma.
5. No LigaHub, informar o **ID da transação no comprovante**, data/hora e marcar que o valor integral já foi transferido. Clicar em **Registrar repasse realizado**. É registrado o identificador do comprovante, não um upload de imagem/PDF. O histórico passa a mostrar **Repasse manual registrado**. O organizador pode consultar esse registro, mas não marcar repasses como pagos.

A reserva não expira automaticamente: se a página for fechada, o mesmo administrador usa **Retomar registro do repasse**, confere seu extrato e conclui o registro sem enviar outro Pix. Outro administrador não pode tomar a reserva nem registrar o comprovante. Não apagar a reserva para tentar novamente; uma operação já feita precisa ser reconciliada pelo extrato. Comprovantes têm identificador único, valor integral obrigatório e ficam criptografados, com auditoria. Repetir o mesmo registro não duplica o lançamento.

**Repasse manual registrado** significa que o administrador informou a transferência. Não é confirmação automática do banco. Pagamentos já enviados automaticamente ou com resultado incerto não podem ser convertidos em repasse manual. Estornos após o envio devem ser tratados operacionalmente; o registro de uma transferência efetivamente realizada permanece possível mesmo que a inscrição seja cancelada depois da reserva.

## Integração automática opcional, desativada

Fluxo: cliente → conta Mercado Pago da plataforma → chave Pix aprovada do organizador.
O organizador recebe **100% do valor da inscrição**. A plataforma assume as tarifas e precisa manter saldo suficiente, inclusive para essa diferença. O processamento assíncrono não garante crédito imediato no banco.

## Preparação e habilitação

1. Aplicar a migração `20261116010000_pix_payouts` com `npm run db:migrate` no ambiente escolhido. Ela é aditiva e não ativa transferências nem modifica cobranças anteriores. Gerar o cliente com `npm run db:generate` e compilar.
2. Conectar a conta Mercado Pago da plataforma por OAuth. Identificar o UUID interno da `PaymentAccount` correspondente, sem copiar tokens. Não usar o número do usuário Mercado Pago como UUID.
3. Executar `npm run payments:payouts:keys -- --configure-local`. O comando gera um par Ed25519 em `.test-temp/mercado-pago-payouts/` e configura apenas a chave privada no `.env` local. É idempotente e recusa substituir um par divergente. Guardar a chave privada em armazenamento seguro; não enviar nem versionar esse arquivo ou o `.env`.
4. Enviar **somente `public.pem`** à equipe de Integrações do Mercado Pago e confirmar que a conta/aplicação está habilitada para Payouts no Brasil. As credenciais comuns de Checkout e o segredo do webhook não substituem esse processo.
5. Em ambiente de teste separado, usar conta, credenciais e chave Pix de teste, `MERCADO_PAGO_TEST_MODE=true` e o UUID da conta de teste em `MERCADO_PAGO_PIX_PLATFORM_ACCOUNT_ID`. O painel Financeiro passa a oferecer o cadastro da chave. Cada chave precisa de aprovação de um administrador, após conferência do beneficiário e da titularidade fora do sistema. A validação de formato local não comprova a titularidade bancária.
6. No Financeiro, o organizador cadastra sua chave. O administrador seleciona o organizador, confere os dados e usa **Aprovar chave Pix conferida**. Qualquer alteração revoga a aprovação. A aprovação fica vinculada à versão exibida da chave.
7. Somente se for escolhida automação no futuro, depois da habilitação e homologação, configurar em produção `MERCADO_PAGO_TEST_MODE=false`, `MERCADO_PAGO_PIX_PLATFORM_ACCOUNT_ID=<UUID da conta real da plataforma>`, `MERCADO_PAGO_PAYOUT_MODE=automatic`, `MERCADO_PAGO_PAYOUTS_PRIVATE_KEY_BASE64=<PEM privado em base64>` e `MERCADO_PAGO_PAYOUTS_ENABLED=true`. Reiniciar o serviço. Manter as rotinas de reconciliação habilitadas. Em Lambda, usar os mesmos campos no SecureString do runtime; o agendador de pagamentos existente também processa a fila de repasses.
8. Conferir uma inscrição de teste: pagamento aprovado/acreditado e inscrição confirmada → repasse `processing` → `paid` somente após consultar `success/accredited` na transação. HTTP 202 não comprova crédito.

Deixar `MERCADO_PAGO_PIX_PLATFORM_ACCOUNT_ID` vazio mantém o fluxo anterior. `MERCADO_PAGO_PAYOUTS_ENABLED=false` interrompe o worker, mas **não cancela transferências já aceitas** pelo provedor. O recebimento centralizado pode ficar configurado com o worker desabilitado; nesse caso as novas cobranças são recebidas e os repasses ficam na fila.

## Garantias e limites

- Somente novas cobranças Pix com snapshot explícito usam a conta centralizada. Nenhum pagamento antigo é convertido em repasse. Cartões continuam usando a conta do organizador quando ela existe; sem ela, o checkout oferece apenas Pix.
- O destinatário e o valor vêm do servidor, do evento e da inscrição. O cliente não envia o valor do repasse. Chaves e snapshots ficam criptografados. O histórico retorna uma lista explícita de campos, sem credenciais ou dados bancários.
- A atualização validada do pagamento e a criação da fila ocorrem na mesma transação. Há unicidade por pagamento **e por inscrição**, posse temporária por worker, referência externa e chave de idempotência estáveis.
- Antes do primeiro envio, o worker consulta novamente o pagamento autenticado, verifica conta, moeda, valor, método, referência, aprovação e acreditação; exige inscrição confirmada, organizador ativo, destino aprovado e somente uma aprovação financeira.
- Troca de destino, inscrição cancelada/em revisão, estorno, contestação ou múltiplas aprovações retêm o repasse. Uma nova chave não redireciona automaticamente dinheiro reservado à chave anterior.
- O ciclo roda na rotina de pagamentos, normalmente a cada minuto no servidor local. O recebimento do webhook registra a fila; a reconciliação recupera notificações perdidas. A confirmação do repasse usa consulta autenticada à API e não depende de uma simulação de webhook de saída.
- Um POST iniciado sem resposta persistida passa a `unknown` e **não é reenviado automaticamente**, mesmo após reinício. É necessário consultar o Mercado Pago pela referência antes de qualquer ação manual. Não apagar registros ou limpar `submittedAt` para tentar novamente. Se os IDs foram persistidos, falhas de consulta são recuperadas automaticamente sem criar outro payout.
- Rejeição, saldo insuficiente, chave inválida e falhas bancárias ficam para revisão; não há novo débito automático. O painel exibe esses casos sem permitir recriar transferências. Estornos após um repasse concluído não recolhem automaticamente dinheiro da conta bancária do organizador.
- A fase de confirmação pela API e a decisão local não constituem uma transação distribuída com o provedor. Mudanças posteriores ao envio precisam de tratamento operacional. Não há promessa de desfazer um Pix já creditado.

## Verificação sem movimentar dinheiro

Testes locais usam `DATABASE_TEST_URL` exclusivo e gateways simulados. As configurações de integração e navegador forçam repasses reais desabilitados. Esses testes não comprovam habilitação, saldo ou crédito bancário real.

Homologação externa: **pendente** até confirmação da habilitação da aplicação, registro da chave pública e evidências de uma transferência autorizada. Registrar apenas referências de teste e estados; omitir chaves Pix, tokens, CPF e dados pessoais. Não usar uma transferência real como teste implícito.

## Migração e retorno

Usar `migrate deploy`; nunca `migrate reset` no banco habitual. Para voltar ao fluxo anterior, desativar o worker e limpar a conta centralizada na configuração. Preservar as tabelas e as colunas para auditoria e reconciliação das operações existentes. A reversão por exclusão de tabelas **não é suportada** depois de movimentações reais.

## Documentação oficial consultada

- [Visão geral e saldo de origem](https://www.mercadopago.com.br/developers/pt/docs/payouts/overview)
- [Corpo, idempotência e consultas](https://www.mercadopago.com.br/developers/pt/docs/payouts/integration-configuration/money-transfers)
- [Assinatura Ed25519 e contato com Integrações](https://www.mercadopago.com.br/developers/pt/docs/payouts/go-to-production)
- [Estados de processamento e crédito](https://www.mercadopago.com.br/developers/pt/docs/payouts/resources/transaction-status-and-errors)

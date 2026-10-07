# Decisões de arquitetura

## Organização por funcionalidades

`auth` cuida de identidade e autorização; `users`, das contas administrativas; `catalog`, dos eventos e publicação; `registrations`, das vagas e inscrições; `payments`, do provedor; `admin`, das consultas globais e auditoria. O módulo `events` original preserva a entidade e o contrato de persistência usados na etapa inicial de estudo.

Controllers recebem HTTP. Services coordenam operações. DTOs validam o formato da entrada. Políticas de domínio validam decisões do negócio, como capacidade disponível, prazo de inscrição e respostas obrigatórias. Prisma executa a persistência e fornece as transações.

Esta versão aplica conceitos de DDD sem criar uma camada vazia para cada operação. As políticas estão separadas do transporte, mas os services de coordenação de inscrições e catálogo ainda dependem do Prisma. Portanto, não é uma implementação de domínio inteiramente independente de infraestrutura. Essa separação adicional pode ser feita quando houver necessidade de trocar persistência ou aumentar a complexidade dos casos de uso.

## SOLID aplicado

- As regras de formulário podem ser testadas sem HTTP ou banco.
- `PaymentGateway` é uma porta abstrata. `MercadoPagoGateway` implementa a comunicação real; os testes usam um simulador, sem modificar os services.
- Os repositórios originais de usuários e eventos preservam contratos próprios; uma conexão única ao banco não substitui contratos com operações de negócio diferentes.
- `PrismaService` concentra a configuração da conexão. Os módulos recebem a dependência por injeção.

Não há vantagem em criar interfaces que apenas repitam todos os métodos do Prisma. Quando uma operação precisa bloquear uma vaga e salvar pagamento e auditoria juntos, a transação precisa abranger essas alterações.

## Vagas e concorrência

Verificar vagas e depois inserir fora de uma transação permitiria que dois participantes ocupassem a última vaga. Por isso, reserva, renovação e confirmação bloqueiam a linha do evento com `SELECT ... FOR UPDATE`. Após obter o bloqueio, a operação consulta novamente as vagas e grava a alteração.

Inscrições `confirmed` ocupam vaga. Reservas `reserved` só ocupam vaga enquanto `reservationExpiresAt` for futura. Suspender uma inscrição confirmada não libera sua vaga nem altera seu pagamento. A unicidade `(eventId, email)` impede registros duplicados mesmo quando duas requisições chegam simultaneamente.

A reserva inicial dura de 5 a 60 minutos, configurados no evento. Ao iniciar Pix, a implementação estende a reserva para ao menos 30 minutos mais margem de transmissão, sem ultrapassar o início do evento. O prazo de inscrição limita a entrada de novas cobranças; uma cobrança iniciada antes do prazo pode ter confirmação posterior.

## Identidade

E-mail é normalizado com `trim().toLowerCase()`. Ele identifica uma inscrição, mas não comprova que o participante é dono daquele endereço. Não existe verificação por e-mail nesta versão.

O participante recebe um `manageToken` aleatório uma única vez. O banco guarda somente seu hash SHA-256. As consultas e cobranças exigem o token no cabeçalho `x-registration-token`, além do ID. Esse token funciona como credencial: quem o possui consegue consultar os dados da inscrição. O futuro frontend deve montar um link com token no fragmento e evitar registrá-lo em logs ou compartilhá-lo com terceiros. Não há recuperação automática de token por e-mail.

Administradores e organizador usam senha e JWT. A senha é transformada em hash Argon2id. O JWT assinado identifica a sessão; ele não serve para armazenar ou proteger uma senha. Cada requisição verifica se a conta continua ativa e se `tokenVersion` ainda é válido. Logout invalida todas as sessões da conta.

## Pagamento confiável

Cada tentativa possui chave de idempotência e valor definido pelo servidor. O cliente não escolhe quanto pagar. Uma tentativa conserva a conta recebedora usada na criação mesmo quando o organizador conecta outra conta posteriormente.

Webhook não é comprovante suficiente. A API verifica HMAC, consulta o pagamento no Mercado Pago e confere recebedor, referência, moeda, valor, modalidade e parcelas. Notificações antigas não revertem aprovação. Uma reconciliação a cada minuto recupera notificações perdidas e acompanha reembolsos.

Se um pagamento for aprovado após a reserva expirar, a confirmação exige vaga disponível, evento publicado, responsável ativo e inscrição disponível. Caso contrário, a inscrição passa a `payment_review`. Isso não significa que a cobrança foi estornada: o organizador deve analisar e, se necessário, reembolsar pelo Mercado Pago. Depois de reembolso integral ou chargeback confirmado pelo provedor, sem outro pagamento aprovado, o estado passa a `canceled`.

Uma solicitação de cancelamento bloqueia novas cobranças. Aprovação ainda não confirmada após essa solicitação exige análise; uma inscrição já confirmada permanece confirmada até o desfecho do pagamento. Não há reembolso automático pela API.

## Histórico e indicadores

Alterações de contas, eventos, inscrições e pagamentos geram auditoria transacional. O organizador consulta histórico dos próprios eventos; o administrador consulta o histórico global. A API não oferece atualização ou exclusão desses registros. Administradores do banco continuam tecnicamente capazes de alterar os dados.

`approvedBaseAmountInCents` soma o preço base das tentativas atualmente aprovadas. Não representa saldo bancário, valor líquido recebido, juros pagos ou conciliação contábil. Esses valores dependem do Mercado Pago e não são calculados nesta versão.

## Operação futura

Antes de produção: executar roteiro de sandbox, disponibilizar HTTPS, configurar CORS com os domínios reais, backups e restauração, monitoramento e política de retenção de dados. Em várias instâncias, o rate limit em memória deve usar armazenamento compartilhado. Esses pontos não foram configurados em um servidor externo nesta entrega.

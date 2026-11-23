# Situação financeira dos participantes

A listagem autorizada e o Excel calculam `financialStatus` usando todas as
tentativas, nesta prioridade: gratuita, em mediação, aprovada, tentativa em
processamento (a mais recente), última tentativa encerrada, sem pagamento.
`latestPaymentStatus` apresenta a tentativa criada mais recentemente, ordenada
por `createdAt` e `id` decrescentes. A chegada de uma notificação não muda essa
ordem. `paymentStatus` conserva o contrato anterior (gratuita ou última tentativa).

`financialWarnings` pode conter `multiple_approvals` (mais de uma tentativa
atualmente aprovada) e `dispute_history` (mediação/contestação atual ou registrada
em `payment.updated` no histórico de auditoria). Histórico anterior à auditoria
existente não pode ser reconstruído. Nenhum campo de credencial é retornado.

O estado da inscrição continua independente: uma inscrição cancelada com
pagamento aprovado permanece cancelada e apresenta a aprovação financeira.
Os alertas orientam a resolução financeira; não efetuam estorno automático.
Não há migração nem alteração do modelo de dados.

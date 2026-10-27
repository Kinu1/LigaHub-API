# Revisão e reavaliação de confirmação

`Registration.reviewReason` é opcional, introduzido pela migration aditiva
`202610270004_payment_review_reason`. Nenhum motivo é inferido para registros
legados. A interface informa: “Motivo não registrado; consulte o pagamento antes
de resolver”.

A política compartilhada tem precedência determinística: inscrição cancelada,
cancelamento solicitado, suspensão, dono inativo, evento não publicado, evento
iniciado, estado inválido e lotação. A contagem inclui confirmações e reservas
vigentes, excluindo a própria inscrição. O fluxo automático aceita apenas
`reserved`/`expired`; somente a reavaliação explícita aceita `payment_review`.
Inscrições canceladas continuam canceladas. Confirmação e cancelamento limpam
o motivo; a auditoria conserva a causa específica.

`POST /registrations/:id/payment-review/confirmation` exige UUID e um administrador
ativo ou organizador ativo dono do evento. A propriedade é verificada antes de
acessar credenciais ou consultar o gateway. A resposta usa `Cache-Control:
no-store` e contém somente `id`, `status` e `reviewReason`.
Somente inscrições em `payment_review` entram na consulta; outros estados são
recusados com 409 antes do gateway. A confirmação já concluída permite repetição
idempotente. Rejeições dessa pré-condição não registram uma decisão de revisão.

É necessário exatamente um pagamento aprovado com identificador verificável,
sem outra aprovação ou mediação. A operação consulta esse identificador na conta
original da tentativa, sem criar cobrança nem solicitar reembolso. A validação
de identidade, recebedor, valor, moeda, método e parcelas é a mesma do webhook.
A sincronização persiste devoluções e contestações antes da decisão de confirmar.
Falha do provedor retorna 503; resposta antiga, mudança concorrente, ambiguidade
financeira ou regra bloqueante retorna 409, com mensagem segura em português.

Nenhuma transação fica aberta durante acesso à rede. A sincronização e a decisão
usam o lock do evento; a decisão bloqueia também a inscrição, relê tentativas,
ator e propriedade, confere timestamps e regras atuais. O lock do evento serializa
a disputa pela última vaga. Estados financeiros terminais e timestamps mais
recentes não são sobrescritos. A confirmação atualiza inscrição, enfileira o e-mail
e registra auditoria com ator, pagamento e motivo anterior na mesma transação.
Bloqueios de regra registram motivo e ator sem confirmar. O processador existente
envia o e-mail posteriormente. Repetir uma confirmação já concluída retorna o
estado seguro sem nova auditoria, consulta ao provedor ou e-mail.

O painel reutiliza `Confirm`, com confirmação explícita, estado pendente e erro
acionável. O POST usa `retry=false`; sucesso invalida consultas. Ajustes financeiros
irresolúveis são feitos na conta do provedor e depois sincronizados. Esta entrega
não implementa filtros financeiros, diagnóstico, exportação CSV ou reembolso.

Validação local: testes unitários, testes React (incluindo axe no modal) e testes
PostgreSQL em `test/payments.integration.e2e-spec.ts`, com gateway fake. O banco
de teste é exclusivamente `127.0.0.1:5433`; não são usados MP, SMTP ou Resend reais.
Com dependências compartilhadas por junction, `--configLoader runner` evita
gravações de cache do Vite fora do worktree; Prisma usa `JITI_FS_CACHE=false`.

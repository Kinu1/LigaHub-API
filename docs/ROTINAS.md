# Rotinas autenticadas — entrega 1 de 6

Os endpoints GET `/internal/jobs/emails` e GET `/internal/jobs/payments` permitem que um agendador externo execute os serviços existentes. Esta entrega não configura cron nem deploy. Não acesse estas URLs por navegador, prefetch ou monitor público: elas executam trabalho.

Configure `BACKGROUND_JOBS_ENABLED=true` explicitamente, `CRON_SECRET` com 32 a 256 caracteres ASCII visíveis, aleatórios e sem espaços (por exemplo, gerar 32 bytes com um gerador criptográfico e codificar em hexadecimal), e envie `Authorization: Bearer <segredo>`. Não coloque a credencial na URL nem em logs. Configure o agendador para preservar o header, usar HTTPS e aguardar a resposta. Todas as respostas destas rotas usam `Cache-Control: no-store`, inclusive falhas nos guards globais.

`BACKGROUND_TIMERS_ENABLED=false` desliga tanto o timer de e-mails quanto o de pagamentos em `onModuleInit`. Métodos manuais permanecem disponíveis. Use essa configuração em todas as instâncias ao operar pelo agendador: timers e chamadas administrativas existentes não participam do lease da rotina HTTP.

A rotina selecionada exige sua flag exatamente `true`: `EMAIL_DELIVERY_ENABLED` ou `PAYMENT_RECONCILIATION_ENABLED`. Ambas exigem chave de criptografia válida; e-mails também exigem remetente, URL de frontend válida e configuração do provedor escolhido por `selectedEmailProvider` (`SMTP_HOST` ou `RESEND_API_KEY`). Credenciais de contas de pagamento continuam sendo resolvidas pelo serviço existente, por tentativa. Falhas de configuração são recusadas antes do claim.

Respostas: 200 significa que o método retornou; 401 indica credencial ausente ou inválida; 404 indica rotas não habilitadas; 409 indica lease ativo; 503 indica configuração/rotina indisponível, falha de execução ou falha de controle. Nenhum segredo, header, entidade de banco ou erro bruto é retornado. A aleatoriedade do segredo é responsabilidade de quem o gera; a aplicação valida formato e tamanho.

## Controle distribuído

A migration aditiva `20261027000200_background_jobs` cria `background_jobs`. Cada nome tem lease UUID e expiração de cinco minutos, obtido por `INSERT ... ON CONFLICT ... WHERE` atômico, usando `NOW()` do PostgreSQL. Não há transação aberta durante chamadas externas. Instâncias concorrentes recebem 409 para o mesmo nome; rotinas diferentes podem executar em paralelo.

O término usa `updateMany` condicionado ao nome e ao UUID e verifica `count`. Uma execução antiga não sobrescreve outra que recuperou o lease. Falhas que chegam ao runner liberam o lease e registram apenas `JOB_FAILED`, datas e contadores. Falhas do banco na finalização podem deixar o lease até expirar. Interrupções recuperam após cinco minutos; não há heartbeat nem cancelamento da execução antiga. Se uma execução exceder o TTL, poderá haver sobreposição; dimensionar frequência/timeout com esse limite. Não remover registros operacionais para desbloquear execução ativa.

O campo `lastSucceededAt` indica retorno da rotina, não confirmação financeira nem entrega de e-mail. Serviços existentes podem absorver erros por item ou globais e retornar normalmente, ou ignorar chamada se já ocupados no processo. A etapa 6 detalhará resultados. `runCount` conta claims; `failureCount` conta falhas que chegam ao runner e cuja finalização foi persistida. Datas de início e expiração usam o relógio do banco; datas de término usam o relógio da aplicação.

## Idempotência e limites existentes

A outbox usa claim por item com `SKIP LOCKED`, lease de 90 segundos, confirmação condicionada ao UUID e chave estável `confirmation/<id>`. Resend limita a janela de idempotência; o serviço interrompe repetições automáticas após 23 horas ou oito tentativas. SMTP não garante deduplicação: interrupção após envio e antes de persistir pode duplicar mensagem. A reconciliação consulta o provedor e aplica o fluxo existente, com suas transações e verificações; este controle não oferece execução exatamente uma vez, nem muda pagamentos, links ou frontend.

## Verificação local

Os testes unitários de guards, flags e timers ficam em `src/modules/jobs/jobs.spec.ts`. A integração com PostgreSQL fica exclusivamente em `test/jobs.integration.e2e-spec.ts`, usa serviços fake e escuta HTTP em `127.0.0.1`. A URL do banco deve apontar exatamente para `127.0.0.1:5433`. Os testes abortam se já houver registros `emails`/`payments`, mesmo expirados; criam esses controles em transação e removem somente as fixtures que criaram. Execute em banco local reservado, sem aplicação/agendador concorrente. Nunca execute `migrate dev` ou reset para esses testes.

Com `DOTENV_CONFIG_PATH` apontando para o arquivo local autorizado, gere Prisma e aplique migrations com `npm run db:generate` e `npm run db:migrate` somente após verificar o destino local. Execute `npm test -- src/modules/jobs/jobs.spec.ts` e `npm run test:e2e -- test/jobs.integration.e2e-spec.ts`. Não são feitas chamadas MP, Resend ou SMTP pelos testes.

Na entrega 2, a rotina de e-mails também processa `access_email_outbox`, além da fila de confirmações. Ambas usam o mesmo timer e endpoint, mas conservam modelos, limites de tentativa e chaves separados. A resposta 200 continua significando término da rodada, sem comprovar entrega de cada mensagem. Veja [operação da fila de acesso](EMAILS.md#fila-durável-de-acesso-e-gestão--entrega-2-de-6).

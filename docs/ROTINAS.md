# Rotinas operacionais e observabilidade — entregas 1 e 6

Os endpoints GET `/internal/jobs/emails` e GET `/internal/jobs/payments` permitem que um agendador externo execute as rotinas em segundo plano. Não configure cron nem deploy sem autenticação. Não acesse estas URLs por navegador, prefetch ou monitor público: elas executam trabalho.

Configure `BACKGROUND_JOBS_ENABLED=true` explicitamente, `CRON_SECRET` com 32 a 256 caracteres ASCII visíveis, aleatórios e sem espaços (por exemplo, gerar 32 bytes com um gerador criptográfico e codificar em hexadecimal), e envie `Authorization: Bearer <segredo>`. Não coloque a credencial na URL nem em logs. Configure o agendador para preservar o header, usar HTTPS e aguardar a resposta. Todas as respostas destas rotas usam `Cache-Control: no-store`, inclusive falhas nos guards globais.

`BACKGROUND_TIMERS_ENABLED=false` desliga os timers periódicos gerenciados pelo coordenador `JobsSchedule` no `JobsModule`. Métodos manuais permanecem disponíveis. Use essa configuração em todas as instâncias ao operar exclusivamente pelo agendador HTTP.

A rotina selecionada via HTTP exige sua flag exatamente `true`: `EMAIL_DELIVERY_ENABLED` ou `PAYMENT_RECONCILIATION_ENABLED`. Ambas exigem chave de criptografia válida; e-mails também exigem remetente, URL de frontend válida e configuração do provedor escolhido por `selectedEmailProvider` (`SMTP_HOST` ou `RESEND_API_KEY`). Credenciais de contas de pagamento continuam sendo resolvidas pelo serviço existente, por tentativa. Falhas de configuração são recusadas antes do claim.

Respostas HTTP das rotinas:
- 200: rotina concluiu com sucesso todos os itens processados (`completed`).
- 401: credencial ausente ou inválida.
- 404: rotas não habilitadas (`BACKGROUND_JOBS_ENABLED !== 'true'`).
- 409: rotina ocupada / lease ativo em outra instância (`BUSY`).
- 503: configuração/rotina indisponível, falha de execução (`failed`) ou resultado parcial (`partial`).

Nenhum segredo, header, entidade de banco ou erro bruto confidencial é retornado.

---

## Observabilidade operacional segura (Entrega 6)

A migration aditiva `20261027000500_operational_observability` aprimora os modelos de controle e pagamentos para distinguir tentativas de sincronização de sucessos verificáveis e relatar métricas seguras.

### Semântica dos campos em `payment_attempts`:
- `lastSyncAttemptAt`: carimbo de data e hora do início da tentativa de consulta ao provedor ou reconciliação.
- `lastSyncSucceededAt`: carimbo de data e hora em que a consulta ao provedor foi concluída com sucesso verificável.
  - **Importante:** Uma consulta concluída com sucesso junto ao provedor que retorne estado `pending` ou nenhum resultado avança `lastSyncSucceededAt` (pois comprova que a consulta ao provedor foi completada e validada, sem erros de comunicação).
  - Falhas de credencial, rede, API ou banco de dados **não** avançam `lastSyncSucceededAt`.
  - A expiração de tentativas criadas e não enviadas (`expireUnsubmitted`) é um encerramento local por expiração da reserva no sistema, e portanto **não** conta como sucesso de comunicação com o provedor.
- `lastSyncErrorCode`: categoria segura de falha classificada por etapa:
  - `credentials_unavailable`: credenciais de acesso da conta não puderam ser obtidas ou decriptadas.
  - `provider_unavailable`: timeout ou indisponibilidade de rede no gateway do provedor.
  - `invalid_provider_response`: resposta malformada ou inesperada do provedor.
  - `database_unavailable`: falha temporária ao registrar os dados no banco local.
  - `sync_failed`: falha genérica de sincronização.
  - **Privacidade:** Mensagens de erro de exceções (`Error.message`), rastros de pilha (`stack`), tokens, CPF, e-mail ou corpos brutos de requisição nunca são persistidos nem expostos.
- `lastSyncedAt`: mantido para compatibilidade histórica e ordenação equitativa (fair FIFO). Representa a data em que o registro foi inspecionado pela rotina, não devendo ser interpretado isoladamente como comprovação de sucesso externo.

### Semântica dos campos em `background_jobs`:
- `status`: resultado do último ciclo (`completed`, `partial`, `failed`, `skipped`).
- `processedCount`: quantidade de itens inspecionados ou processados no ciclo.
- `succeededCount`: quantidade de itens concluídos com êxito comprovado.
- `failedCount`: quantidade de itens que falharam.
- `skippedCount`: quantidade de itens ignorados por regras de elegibilidade ou expiração local.
- `lastSucceededAt`: avança **somente** se a rotina concluiu sem falhas (`status: 'completed'`).
- `lastFailedAt` e `failureCount`: atualizados em caso de falha global (`failed`) ou resultado parcial (`partial`). Execuções com conflito de concorrência (`busy` / 409) ou ignoradas (`skipped`) não contam como sucesso nem como falha da rotina.

---

## Coordenador de agendamento (`JobsSchedule`)

Os timers periódicos das rotinas foram centralizados no `JobsSchedule` dentro do `JobsModule`:
- Timer de e-mails: intervalo de 15 segundos, exige `EMAIL_DELIVERY_ENABLED === 'true'`.
- Timer de reconciliação de pagamentos: intervalo de 60 segundos, preserva semântica anterior `PAYMENT_RECONCILIATION_ENABLED !== 'false'`.
- Operam de forma independente da flag HTTP `BACKGROUND_JOBS_ENABLED`, permitindo execução em processos de worker sem expor endpoints HTTP.
- Respeitam `BACKGROUND_TIMERS_ENABLED=false` para desligamento global.
- Usam `.unref()` nos intervalos e cancelamento no ciclo de vida `onModuleDestroy`.

---

## Diagnóstico administrativo seguro (`GET /admin/operations`)

O endpoint administrativo `GET /admin/operations` (alias `/admin/jobs`) fornece um diagnóstico seguro e consolidado da operação:
- **Acesso restrito:** Exclusivo para administradores autenticados (`@Roles('admin')`). Bloqueado para organizadores e anônimos.
- **Cache:** Resposta protegida com cabeçalho `Cache-Control: no-store`.
- **Conteúdo retornado:**
  - `flags`: status booleano das configurações do sistema (sem valores confidenciais como chaves ou senhas).
  - `routines`: estado atual, timestamps de início, término, último sucesso verificável e última falha, contadores do último lote e status do lease ativo para as duas rotinas (`emails` e `payments`).
  - `queues`: resumo quantitativo por status (`pending`, `processing`, `sent`, `failed`, `skipped`) e data do próximo agendamento mais antigo para a fila de confirmação e a fila de links de acesso. (Observação: `sent` significa aceito pelo provedor de e-mail, sem computar entrega final na caixa de entrada).
  - `failedPayments`: lista paginada de tentativas de pagamento com falha de sincronização recente (`lastSyncErrorCode` preenchido), contendo apenas identificadores, dados do evento, valores, datas e categoria de erro (sem nomes, CPF, tokens ou dados de cartão).
- Em caso de falha no banco de dados, o endpoint retorna erro 503 com mensagem genérica: "Diagnóstico operacional indisponível."

---

## Painel de gestão (`/painel/operacao`)

A página "Operação" no painel administrativo permite acompanhar a saúde das rotinas:
- Acessível exclusivamente no menu de navegação de administradores.
- Carregamento sob demanda (lazy loading).
- Apresenta timestamps com legendas claras sobre a diferença entre última tentativa, último sucesso e última falha.
- Apresenta contadores e estados traduzidos para o português brasileiro.
- Exibe o comparativo das filas de confirmação versus links de acesso.
- Exibe a lista paginada de consultas de pagamento que necessitam de atenção técnica.
- Tratamento resiliente de erros: falhas de atualização não mascaram o estado do sistema nem exibem dados obsoletos como saudáveis.

Quando existe início sem término registrado, a API apresenta `running` enquanto o
lease está ativo ou `unfinished` depois do vencimento. O painel mostra “Em execução”
ou “Sem conclusão registrada”; os contadores ficam indisponíveis (`null`), sem
reutilizar resultados antigos como se fossem da rodada atual. A data do último
sucesso concluído é preservada. Isso não presume falha financeira nem permite
sobrescrever outra concessão.

A reconciliação manual continua disponível mesmo com seu timer desativado; as
flags são verificadas pelo coordenador e pelas rotas autenticadas. Uma consulta
ao provedor concluída, inclusive sem pagamento encontrado, não significa aprovação
ou confirmação de inscrição. Resultado ausente de uma rotina é falha operacional,
nunca um lote vazio bem-sucedido.

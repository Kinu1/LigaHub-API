# Inclusão manual de participantes — cortesias

Implementado em `feat/inclusao-manual-participantes`, exclusivamente na worktree
`C:/Projetos/LigaHub-cortesias`.

## Comportamento

- Em **Eventos → detalhes → Inscrições → Adicionar participante**, informe nome
  completo, e-mail, CPF válido, categoria e respostas do formulário atual.
- O modal usa os componentes e as cores existentes. Tem foco contido, retorno de
  foco ao botão de abertura, campos rotulados, erros anunciados, corpo com rolagem
  e título/botões visíveis em desktop e celular. Bloqueia reenvio/fechamento enquanto salva.
- `POST /events/:eventId/registrations/manual`: administrador ou organizador dono
  do evento, com autenticação e validação globais. Outro organizador recebe 403;
  sessão ausente/inativa recebe 401. Dados não autorizados não revelam duplicatas.
- Exige início futuro, evento não encerrado e responsável ativo. Permite rascunho,
  suspensão das inscrições públicas e inclusão após o prazo público; a cortesia
  continua sujeita às capacidades geral e da categoria.
- CPF validado pelos dígitos verificadores e armazenado criptografado. E-mail
  normalizado com trim/lowercase. Nome completo e respostas obrigatórias/tipos são
  verificados pelo backend. O formulário original fica em `formSnapshot`.
- A mesma linha de `academic_events` é bloqueada com `FOR UPDATE` na inclusão
  manual e na reserva pública. Contam confirmações e reservas ainda vigentes;
  reservas vencidas não ocupam vagas. A consulta de duplicata acontece sob o lock,
  antes da capacidade, e respeita a unicidade existente por evento/e-mail.
- Duplicata retorna 409, mensagem e `registrationId`, sem credenciais ou respostas.
  O filtro HTTP preserva somente esse identificador seguro. O modal oferece
  **Localizar inscrição existente**, limpando filtros e buscando pelo e-mail.
- A inscrição nasce `confirmed`, `priceInCents=0`, `origin=manual`, categoria
  preservada, `manualAuthorId` e `manualCreatedAt`. Uma auditoria
  `registration.confirmed_manual` registra ator, evento, categoria e preço zero.
  Não exige conta de recebimento, não cria PaymentAttempt, taxa ou PixPayout.
  A rota de pagamento também recusa uma tentativa contra essa inscrição confirmada.
- Resposta de criação: `{id, status, origin, emailDeliveryStatus: "pending"}`.
  Nunca retorna manageToken/statusToken nem dados criptografados.
- Confirmação entra no **EmailOutbox existente na mesma transação**. O processador
  existente renderiza e envia posteriormente, com o link pessoal de consulta;
  esse fluxo também permite solicitar acesso à gestão pelo mecanismo de recuperação.
  A mensagem de cortesia não afirma aprovação de pagamento. A requisição de criação
  não faz preflight nem chama o provedor. Falha de envio posterior preserva a vaga;
  falha na persistência da própria fila reverte inscrição/auditoria, sem órfãos.
- Lista e painel exibem Cortesia, data e confirmação por e-mail pendente até o
  aceite persistido do provedor. Detalhes e página de situação preservam a origem.
  Excel acrescenta **Origem** ao final (coluna K), mantendo as colunas financeiras
  existentes e a categoria original. Cortesia tem valor zero e não tem reserva a vencer.

## Schema e compatibilidade

Migration aditiva `20261118221000_manual_registrations`: enum
`RegistrationOrigin`, origem com default `public`, autor UUID e data opcionais,
índices e CHECK que exige autor/data/preço zero para origem manual. Registros
anteriores recebem `public`; nenhuma gratuidade histórica é inferida como cortesia.
`historical` fica disponível como origem explícita, sem reclassificação automática.
Campos da API/frontend são aditivos; os campos de origem são opcionais nos tipos da UI.

A migration foi aplicada somente no banco de teste. Em implantação, aplique-a
antes do novo backend. O DDL requer locks de schema/índice: programar conforme o
volume real. Reversão de aplicação pode conservar as colunas aditivas; não apagar
cortesias/auditoria. Mudanças posteriores de schema devem usar nova migration.

## Arquivos

- Backend: `src/modules/registrations/registrations.{controller,dto,service}.ts`,
  `participants-export.ts`, `src/common/http.ts`,
  `src/modules/notifications/confirmation-email.ts`.
- Persistência: `prisma/schema.prisma` e a migration acima.
- UI: `frontend/src/pages/manual-registration.tsx`, `event-details.tsx`,
  `participant.tsx`, `participant-status.tsx`, `audit-list.tsx`,
  `frontend/src/{api,types}.ts`.
- Testes: `test/manual-registrations.integration.e2e-spec.ts`,
  `frontend/src/pages/manual-registration.test.tsx`,
  `test/browser/manual-registration.spec.ts`.
- Infra de teste: configurações Vite/Vitest/Playwright, `scripts/browser-test-server.mjs`,
  `test/browser-teardown.ts` e guardas de banco em `test/{access-outbox,jobs}.integration.e2e-spec.ts`.

O cabeçalho Content-Disposition foi restaurado conforme HEAD. Os comentários
corrompidos do schema foram recuperados de HEAD antes das adições. Removidos apenas
os temporários dos workers: `check.py`, `check_bytes.py`, `fix.js`, `fix.patch`,
`fix.py`, `fix2.py`, `fix3.py`, `fix_bytes.py`, `fix_controller.js` e
`src/modules/registrations/registrations.controller.ts.bak`.

## Validação executada em 18/11/2026

Banco exclusivo `127.0.0.1:5434/ligahub_manual_test`, selecionado obrigatoriamente
por `DATABASE_TEST_URL` através de `scripts/test-database.mjs`. Banco habitual não
foi acessado. Nenhum envio real ou chamada real de pagamento foi realizado.

| Verificação                                                    | Resultado                                                |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| `npm.cmd run db:generate`                                      | PASS; Prisma 7.10 gerado em `src/generated/prisma` local |
| `npm.cmd run build`                                            | PASS                                                     |
| `npm.cmd run lint`                                             | PASS; um aviso preexistente em `catalog.service.ts:445`  |
| `npm.cmd test -- --configLoader runner`                        | 44 arquivos, 392 testes PASS                             |
| `npm.cmd --prefix frontend run build -- --configLoader runner` | PASS; TypeScript e Vite                                  |
| `npm.cmd --prefix frontend test -- --configLoader runner`      | 24 arquivos, 118 testes PASS                             |
| `npm.cmd run db:migrate:test`                                  | PASS; 22 migrations, incluindo cortesia                  |
| `npm.cmd run test:e2e -- --configLoader runner`                | 15 arquivos, 163 testes PASS                             |
| Spec de navegador manual, desktop e celular 390×844            | 2 testes PASS; 18,1 s; teardown concluído                |
| `git diff --check`                                             | PASS                                                     |

Os 21 novos testes HTTP/PostgreSQL cobrem autorização real, dados inválidos,
datas, responsável inativo, rascunho/prazo público, preço zero em categoria paga,
ausência e bloqueio de cobranças, auditoria, dados seguros, Excel, concorrência
manual/manual e manual/pública, duplicatas, reservas vigentes/vencidas, falha
simulada do provedor e rollback por falha de gravação da fila. Os quatro testes
de UI cobrem respostas tipadas, CPF, duplicata/busca, foco, axe, envio único e
falha de atualização da lista após salvar. O navegador verifica o fluxo com
backend real, perguntas obrigatórias, validação, categoria, pendência, duplicata,
Excel zero e ausência de cobranças/mensagens, com screenshots e sem overflow.

### Ajustes necessários ao ambiente Windows desta worktree

`npm.cmd` evita a política de execução do shim npm.ps1. Para gerar Prisma com
node_modules compartilhado, foi usado `JITI_FS_CACHE=false`; a geração recebeu
uma DATABASE_URL fictícia apenas para carregar o config (generate não conecta).
Essa variável fictícia não foi mantida nos comandos de banco/teste.

Vite/Vitest usam `--configLoader runner` para não escrever configuração compilada
no node_modules compartilhado; caches estão em `.test-temp` local. As dependências
frontend usam junction, e nenhum cliente Prisma foi gerado no checkout principal.
O config e2e permite servir apenas a raiz frontend e suas dependências resolvidas,
incluindo a fonte Inter através da junction.

A primeira execução completa e2e encontrou duas guardas antigas fixas na porta 5433. Elas agora exigem correspondência exata com DATABASE_TEST_URL, host local
e nome identificando teste, preservando a proteção. A repetição passou 163/163.
A primeira execução de navegador passou os testes mas expirou no teardown nativo
do Windows. O harness agora fecha explicitamente os dois servidores por controles
locais autenticados exclusivos de teste, com token aleatório por execução para
não fechar outro harness que já esteja usando uma porta. A execução final passou
com exit code 0.

Portas isoladas usadas na execução final:

```powershell
$env:LIGAHUB_BROWSER_API_PORT='3110'
$env:LIGAHUB_BROWSER_WEB_PORT='3111'
npm.cmd run test:browser -- test/browser/manual-registration.spec.ts
```

Os defaults 3100/3101 permanecem disponíveis para os specs existentes. Não executar
duas suítes de banco simultaneamente no mesmo banco exclusivo. As fixtures de
navegador usam credenciais falsas e o servidor bloqueia fetch externo, substituindo
gateways por simuladores. Os endpoints de desligamento só existem no harness e
no config Vite e2e, nunca na aplicação de produção.

## Limites e riscos

Revisão final local: diff e permissões conferidos; 392 testes unitários,
118 frontend, 163 de integração e 2 de navegador passaram. Cobertura do
formulário: 93,1% das linhas e 82,75% dos ramos. A suíte de integração cobriu
91,44% das linhas e 100% das funções de RegistrationsService; a cobertura
global dos testes unitários é 59,11% das linhas, sem limiar global configurado.

Nenhuma entrega real de e-mail foi verificada. O estado `sent` significa aceite
persistido pelo provedor, não leitura ou chegada na caixa de entrada. O envio
depende da fila/rotina e da configuração já existente. Falhas permanecem visíveis
no painel de fila existente. Não houve implantação nem migration fora do teste.
Os únicos avisos remanescentes foram o lint preexistente, anotações de terceiros
Zod no build e canvas não implementado pelo jsdom nos testes axe existentes.

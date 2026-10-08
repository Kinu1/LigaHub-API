# LigaHub API

Aplicação para organizar eventos pagos de **uma liga acadêmica**, com backend TypeScript, NestJS, Prisma e PostgreSQL e frontend React com Tailwind CSS.

O frontend fica em `frontend/`. Depois de iniciar a API, execute `npm.cmd --prefix frontend ci` e `npm.cmd run frontend:dev`, e abra [LigaHub local](http://localhost:3001). Instruções de e-mail local, segurança, contratos e publicação estão em [frontend/README.md](frontend/README.md).

## Funcionalidades

- Administrador com acesso global e um responsável organizador com acesso aos próprios eventos.
- JWT de 15 minutos, senhas Argon2id e revogação de sessões.
- Eventos em rascunho, publicados, suspensos ou encerrados; formulário personalizável e preço único em centavos.
- Inscrições pelo link divulgado pelo organizador, sem catálogo público nem conta do participante.
- Uma inscrição por e-mail normalizado por evento; reserva temporária e proteção da última vaga com transação no PostgreSQL.
- Pix e cartão com parcelamento; conta recebedora conectada por OAuth com PKCE.
- Webhooks autenticados, idempotência e reconciliação de pagamentos.
- Solicitação de cancelamento, suspensão de inscrições, auditoria e indicadores administrativos.

Não há taxa da plataforma nos pagamentos. Reembolsos são executados pelo organizador no Mercado Pago e acompanhados pela sincronização. Não há certificados.

## Iniciar no Windows

Requisitos: Node.js 24, Git e Docker Desktop iniciado. No terminal do Cursor, dentro da pasta do projeto:

```powershell
npm.cmd ci
npm.cmd run env:init
docker compose up -d
npm.cmd run db:generate
npm.cmd run db:migrate
```

`env:init` cria `.env` se necessário e gera os segredos JWT e de criptografia. Segredos existentes são preservados. PostgreSQL: `127.0.0.1:5433`; API: porta 3000. Ao trocar a senha do banco, atualize também `DATABASE_URL`. Alterar a variável não altera a senha de um volume PostgreSQL já inicializado.

Para criar o primeiro administrador, preencha **somente no `.env` local**:

```dotenv
BOOTSTRAP_ADMIN_NAME=Pedro
BOOTSTRAP_ADMIN_EMAIL=seu-email@example.com
BOOTSTRAP_ADMIN_PASSWORD=escolha-uma-senha
```

```powershell
npm.cmd run admin:bootstrap
npm.cmd run start:dev
```

Senhas aceitam de 6 a 128 caracteres. O bootstrap não redefine senhas, não promove usuários existentes e não reativa contas suspensas. Depois da criação, remova `BOOTSTRAP_ADMIN_PASSWORD` do `.env`. Não versione credenciais.

Com `API_DOCS_ENABLED=true`, abra [Swagger local](http://localhost:3000/docs). Exemplos em [docs/API.md](docs/API.md), decisões em [docs/ARQUITETURA.md](docs/ARQUITETURA.md) e configuração de pagamentos em [docs/MERCADO_PAGO.md](docs/MERCADO_PAGO.md).

## Verificar

Confirmação automática por e-mail e link somente de consulta: veja [docs/EMAILS.md](docs/EMAILS.md). O envio fica desativado até configurar o provedor e publicar a página de consulta.

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd test
npm.cmd run test:e2e
npm.cmd audit
```

Os testes de integração exigem as migrations aplicadas. Criam dados identificados por UUID e removem somente esses dados; prefira um banco separado para testes. Pagamentos usam provedor simulado, sem cobrança real. O GitHub Actions usa um PostgreSQL exclusivo do job.

## Limites da entrega

A integração com Mercado Pago está implementada, mas a validação ponta a ponta no sandbox depende de aplicação, credenciais e conta de teste configuradas pelo proprietário. Nenhum recebimento real foi validado. A API recebe apenas o token temporário do cartão; o frontend usa o SDK do Mercado Pago para tokenização.

O histórico é imutável pelas rotas da API; administradores do banco podem editar registros. Reservas expiradas deixam de consumir vagas pela data de expiração, mesmo antes de o estado ser materializado como `expired`.

## Versionamento

Branches de autenticação, eventos, inscrições, pagamentos e administração são encadeadas porque uma funcionalidade depende da anterior. Revise e integre na mesma ordem. `.github/workflows/backend.yml` verifica lint, compilação, testes e dependências a cada push ou PR.

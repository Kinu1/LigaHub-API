# Publicação na Vercel

Roteiro preparado para a LigaHub. Nenhum projeto foi criado nem publicado na conta Vercel nesta etapa. O plano da conta e o banco de destino ainda precisam ser definidos. A homologação externa existente está em [e-mails](HOMOLOGACAO_EMAILS.md) e [pagamentos](HOMOLOGACAO_PAGAMENTOS.md).

## Organização dos projetos

Use dois projetos Vercel ligados ao mesmo repositório:

| Projeto | Diretório raiz | Framework | Preparação |
| --- | --- | --- | --- |
| API | raiz do repositório | NestJS | Instalar dependências, gerar Prisma e compilar a API |
| Web | `frontend` | Vite | Instalar dependências, executar `npm run build` e publicar `dist` |

O suporte atual da Vercel reconhece `src/main.ts` como entrada NestJS. A API vira uma Vercel Function; isso não equivale a manter um processo permanente executando os timers da aplicação. Referência: [NestJS na Vercel](https://vercel.com/docs/frameworks/backend/nestjs).

Na API, a preparação usada pelo projeto é:

```sh
npm ci
npm run db:generate
npm run build
```

Use Node.js 24, versão adotada pelo projeto, e confira o build no ambiente Vercel. Não configure `frontend/dist` como saída da API. A geração Prisma precisa ocorrer antes da compilação; `src/generated` não é versionado.

## Banco e migrations

Provisione PostgreSQL acessível pela API. O PostgreSQL do Docker local não fica disponível para a Vercel. Cadastre `DATABASE_URL` como segredo somente no projeto da API, com a configuração de conexão exigida pelo provedor de banco escolhido.

Mantenha bancos distintos para homologação e produção. Antes de atualizar um banco existente, confira as migrations pendentes e disponha de um backup cuja restauração tenha sido validada. Aplique migrations uma vez por entrega, em etapa controlada, com a URL do banco de destino:

```sh
npm run db:migrate
```

O comando executa `prisma migrate deploy`. Não execute os testes de integração no banco de produção, nem use reset ou `migrate dev` nesse banco. O CI já utiliza PostgreSQL separado. Voltar a versão da aplicação não desfaz migrations: confira a compatibilidade com o schema aplicado e prepare uma migration corretiva quando necessário.

## Variáveis da API

Cadastre os segredos pelo painel da Vercel, separando os ambientes. Não publique o `.env` local nem copie suas credenciais para o frontend.

| Variável | Configuração de destino |
| --- | --- |
| `NODE_ENV` | `production`, inclusive para homologação HTTPS; controla os cookies Secure |
| `DATABASE_URL` | Banco do ambiente correspondente |
| `JWT_SECRET` | Segredo aleatório com pelo menos 32 caracteres |
| `CREDENTIALS_ENCRYPTION_KEY` | Chave de 32 bytes em base64; preservar para ler contas e tarefas já criptografadas |
| `FRONTEND_URL` | Origem HTTPS estável do Web, sem caminho e sem barra final |
| `CORS_ORIGINS` | Origem HTTPS autorizada do Web |
| `API_DOCS_ENABLED` | `false` no ambiente público, salvo decisão explícita de expor o Swagger |
| `MERCADO_PAGO_TEST_MODE` | `true` durante homologação; não liberar cobranças reais nesta etapa |
| `MERCADO_PAGO_NOTIFICATION_URL` | URL pública da API com `/payments/webhook` |
| `MERCADO_PAGO_REDIRECT_URI` | URL pública da API com `/payments/accounts/callback`, para OAuth |
| Credenciais Mercado Pago | Configurar conforme [o roteiro de pagamentos](MERCADO_PAGO.md); credenciais de teste não substituem OAuth de produção |
| `EMAIL_PROVIDER` | `resend` para o provedor já homologado |
| `RESEND_API_KEY` e `EMAIL_FROM` | Chave privada e remetente autorizado; remetente de teste apenas nos destinatários permitidos |
| `EMAIL_DELIVERY_ENABLED` | `false` enquanto o processamento serverless e o link público não forem validados |
| `PAYMENT_RECONCILIATION_ENABLED` | `false` na função enquanto a execução agendada não estiver adaptada |

Os dois últimos valores desativam os timers existentes; não criam um agendador alternativo. São configurações de preparação, não uma liberação funcional completa. Após implantar as rotas agendadas, revisar o uso de cada flag antes de habilitar os processadores.

## Web, proxy e rotas públicas

O frontend chama `/api` na própria origem. O proxy em `vite.config.ts` atende apenas ao desenvolvimento. No projeto Web da Vercel, será necessário encaminhar `/api/:path*` à URL real da API, removendo `/api`, e manter fallback de SPA para os links públicos.

Exemplo de `frontend/vercel.json`, a preencher quando a URL estável da API existir; **não está configurado no projeto**:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://URL-REAL-DA-API/:path*" },
    { "source": "/:path*", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/api/:path*",
      "headers": [{ "key": "Cache-Control", "value": "no-store" }]
    }
  ]
}
```

A regra de API vem antes do fallback. Valide que erros da API continuam sendo JSON, sem resposta HTML da SPA; preserve cookies e cabeçalhos CSRF. Não envie o token do participante para logs. Referência: [rewrites para APIs externas](https://vercel.com/docs/routing/rewrites).

## Processamento em segundo plano: adaptação pendente

Hoje a fila executa por `setInterval` a cada 15 segundos, e a reconciliação também depende de um timer. Na Vercel, adapte essas rotinas para chamadas autenticadas por um agendador. A aplicação ainda não oferece essas rotas: não configure cron apontando para um endpoint inexistente.

A documentação Vercel orienta autenticar rotas agendadas com `Authorization` e `CRON_SECRET`. No Hobby, o cron nativo executa no máximo uma vez por dia, insuficiente para substituir a frequência atual; no Pro, o intervalo mínimo é um minuto. O destino dessas rotinas depende do plano escolhido e pode exigir um agendador externo. Não declare e-mail ou recuperação automática de pagamentos operacionais apenas porque o frontend abriu. Referências: [tarefas agendadas em NestJS](https://vercel.com/docs/frameworks/backend/nestjs#run-scheduled-tasks) e [limites de cron](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Critérios de aceitação no destino

1. A API retorna `{"name":"LigaHub API","status":"running"}` em `/`. Essa resposta comprova o processo HTTP, não a saúde do banco ou dos provedores.
2. Login, logout e renovação funcionam pelo Web com cookies HttpOnly e Secure. Mutações sem CSRF são rejeitadas.
3. Recarregar diretamente `/eventos/:publicId`, `/inscricao/:id` e `/inscricoes/:id` abre a SPA. A consulta sem credencial não expõe dados do participante.
4. Uma inscrição fictícia persiste no banco de homologação, respeita capacidade e permite recuperar acesso.
5. Após adaptar o processamento, um envio controlado chega ao destinatário autorizado e seu link funciona no domínio publicado.
6. Pix e cartão são conferidos em sandbox no domínio final. O webhook automático continua uma etapa pendente de homologação, adiada pelo usuário; uma requisição assinada localmente não substitui essa evidência.
7. Registre commit publicado, URLs, resultado dos testes e limites observados. Use um domínio estável de homologação; previews não devem reutilizar banco ou credenciais de produção indiscriminadamente.

Ainda faltam: plano Vercel, PostgreSQL de destino, URLs dos projetos, configuração real do proxy, adaptação do agendamento e validação externa. A conclusão deste roteiro não significa que esses passos tenham sido executados.

# Homologação: AWS, Supabase e Resend

Esta entrega prepara código e infraestrutura declarativa. Não cria contas, recursos,
migrações remotas nem envia mensagens. Os preços e limites gratuitos dependem da
conta e do consumo; esta arquitetura não garante custo zero. Configure AWS Budgets
e alertas antes da publicação. Logs, alarmes, armazenamento, requisições, backups e
transferência podem gerar cobrança.

## Infraestrutura

```text
Navegador / Mercado Pago sandbox
            | HTTPS
         CloudFront
            |-- / e rotas SPA -> S3 privado (OAC)
            |-- /api e /api/* -> Lambda Function URL -> NestJS -> Supabase Postgres
                                      |                         (Prisma)
                                      +-> Resend / Mercado Pago sandbox
EventBridge Scheduler -> Lambda emails / payments -> mesmas filas persistentes
SSM SecureString -> configuração no cold start
CloudWatch -> logs (7 dias), alarmes de erros e DLQ
pg_dump manual -> S3 privado, versionado e criptografado
```

API sem cache, com cookies, Authorization, query string, CSRF, idempotência e headers
de webhook encaminhados. A reescrita SPA ocorre somente no comportamento do frontend;
erros da API mantêm seu status. `/api` é removido uma vez pelo adaptador Lambda.
O frontend já utiliza `/api` na mesma origem.

Uma CloudFront Function sobrescreve `x-ligahub-client-ip` com o IP do visitante;
o adaptador usa esse IP para o throttler, sem confiar em `X-Forwarded-For` enviado
pelo cliente. Os limites Nest usam memória por instância Lambda e não são uma quota
global distribuída. Avaliar WAF/storage compartilhado antes de exigir esse tipo de limite.

A Function URL tem autenticação AWS `NONE` e é alcançável pela internet. O handler
exige `x-ligahub-origin` com segredo aleatório de pelo menos 32 caracteres antes de
inicializar Nest/SSM/banco. CloudFront sobrescreve esse header. Isso não é isolamento
de rede: proteja/rotacione o segredo e restrinja quem pode ler a distribuição e o
ambiente da função. A autenticação JWT, cookies, CSRF e permissões Nest continuam
obrigatórias. OAC é usado no S3. Não se usa OAC da Lambda para manter compatibilidade
com POSTs do navegador e webhooks que não assinam `x-amz-content-sha256`.

## Preparação externa (quando a publicação for autorizada)

1. Criar projeto **Supabase de homologação**, selecionar região próxima da Lambda
   (ex.: us-east-1) e copiar as conexões do painel. Desabilitar Data API se não houver
   uso direto; este projeto mantém o login NestJS e não usa Supabase Auth/Storage.
   Nunca expor credenciais PostgreSQL ou service role ao frontend.
2. Runtime: `DATABASE_URL` do **transaction pooler, porta 6543**, com TLS. Prisma 7
   usa `@prisma/adapter-pg`; não adicionar opções antigas do engine sem necessidade.
   Pool por processo: 2 conexões. Com concorrência API 5 + dois jobs 1, planejar até
   14 conexões cliente no pooler, além de migrações e ferramentas.
3. CLI e backup: `DIRECT_URL` direta (IPv6) ou **session pooler, porta 5432** para
   runners IPv4. Nunca rodar migrações/pg_dump pela conexão transaction 6543.
   Validar a cadeia TLS; não desabilitar verificação de certificado.
4. Preparar domínio/remetente verificado no Resend e aplicação/usuários de teste no
   Mercado Pago. Usar apenas credenciais sandbox nesta stack.
5. Copiar `infra/runtime-config.example.json` para `infra/runtime-config.local.json`.
   Substituir TODOS os placeholders. Gerar JWT aleatório e chave de criptografia
   com `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
   Manter a chave estável: alterá-la sem migração impede ler credenciais/filas antigas.
6. Criar **fora do CloudFormation** um parâmetro SSM **SecureString Standard**, até
   4 KB, `/ligahub/homologation/runtime-config`, com JSON e chave padrão `aws/ssm`.
   Se adotar CMK, adicionar permissão `kms:Decrypt` específica ao template. O JSON
   aceita somente as chaves do exemplo; flags, `NODE_ENV`, AWS e segredo da origem
   ficam fora dele. Erro de carregamento/validação impede inicializar a função.
7. O domínio CloudFront só existe após a primeira implantação: criar inicialmente o
   SSM com URLs HTTPS reservadas de configuração, manter agendas desabilitadas,
   implantar, atualizar FRONTEND_URL/CORS_ORIGINS/callback/webhook com o domínio real
   e reciclar os ambientes Lambda (atualização da configuração/redeploy). O JSON é
   cacheado por ambiente; editar apenas SSM não atualiza instâncias quentes.
8. Cadastrar callback `/api/payments/accounts/callback` e webhook
   `/api/payments/webhook` no Mercado Pago. Confirmar HTTPS, cookies, CSRF e sandbox.

## Validação e publicação manual

Requisitos locais: Node 24, npm, AWS CLI, SAM CLI, Docker Linux x86_64 e credenciais
temporárias. O build gera Prisma e instala argon2 no Linux. Não publicar o `dist`
ou `node_modules` produzidos no Windows.

```sh
npm ci
npm run db:generate
npm run lint
npm run build
npm test
node --test scripts/homologacao.test.mjs
npm ci --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend
sam validate --lint --template-file infra/template.yaml
sam build --use-container --template-file infra/template.yaml
```

Geração de Prisma não consulta o banco. Migrações são uma etapa separada e só devem
usar `DIRECT_URL` da homologação depois de revisar o SQL e obter backup restaurável.
Não há mudança de schema nesta entrega; `prisma migrate deploy` aplica migrações
existentes. Nunca executar `migrate dev`/reset contra ambientes remotos.

O workflow `.github/workflows/homologacao.yml` é somente `workflow_dispatch`.
`deploy=false` valida e monta o pacote Linux, sem credenciais AWS. `deploy=true`
aplica migrações, implanta a stack e publica o frontend; precisa do environment
GitHub **homologation**, preferencialmente com revisão obrigatória e restrição à
branch de entrega. Configurar:

| Tipo     | Nome                     | Uso                                              |
| -------- | ------------------------ | ------------------------------------------------ |
| Variable | AWS_REGION               | Região AWS                                       |
| Variable | AWS_STACK_NAME           | Nome exclusivo da stack                          |
| Variable | AWS_DEPLOY_ROLE_ARN      | Role assumida por OIDC                           |
| Variable | RUNTIME_CONFIG_PARAMETER | Nome do SSM existente                            |
| Secret   | CLOUDFRONT_ORIGIN_SECRET | Segredo aleatório base64url, 32 a 128 caracteres |
| Secret   | DIRECT_URL               | Banco de homologação para migrações              |

A confiança OIDC da role deve exigir `aud=sts.amazonaws.com` e
`sub=repo:OWNER/REPO:environment:homologation`, com OWNER/REPO reais. Não criar access
keys permanentes. A role de implantação precisa operar CloudFormation/SAM, publicar
artefatos e frontend S3, invalidar CloudFront, criar os recursos descritos e passar
somente as roles desta stack. Ajustar sua política ao nome da stack/recursos e usar
uma service role CloudFormation restrita quando necessário. A role de runtime tem
somente leitura do parâmetro, logs e, nos jobs, envio à DLQ.

O primeiro workflow de implantação requer que SSM e os secrets já existam. O SAM
cria bucket auxiliar de artefatos (`--resolve-s3`), que também pode gerar custo.
O deploy sempre mantém agendas desabilitadas: habilitá-las apenas numa atualização
revisada com `EnableEmailSchedule=true`/`EnablePaymentSchedule=true`, após testar a
configuração e o sandbox. Os timers internos e rotas públicas de cron ficam desligados.

Jobs têm timeout de 240 s (lease do coordenador de 300 s), orçamento de processamento
de até 120 s e param de reivindicar itens com menos de 30 s de margem. A fila de
acesso recebe parte desse orçamento para não impedir confirmações. Conflito de lease
vira `BUSY`; falhas reais rejeitam a execução para retry/DLQ. Não limpar leases nem
reenviar pagamentos manualmente sem conferir idempotência e estado no provedor.

## Checklist de aceite em homologação

- `GET /api/health` retorna 200; `/api/ready` retorna 200 com banco disponível e 503
  se indisponível. Function URL direta sem segredo retorna 403.
- Abrir uma rota SPA diretamente funciona; 401/403/404 da API continuam JSON.
- Login/logout, renovação, CSRF, papéis e isolamento entre ligas funcionam em HTTPS.
- Inscrição gratuita e paga, webhook repetido, reconciliação e idempotência sandbox.
- Um e-mail de teste chega ao destinatário autorizado e retry não duplica o envio.
- Nenhum cron HTTP é público; jobs desabilitados não reivindicam itens.
- CloudWatch não contém tokens, URLs de banco, payloads pessoais nem segredos.
- Alarmes existem; configurar ações SNS/destinatários antes de depender de notificações.
  O template cria alarmes sem ações de notificação. Verificar DLQ e retenção.

## Backup e recuperação

Instalar `pg_dump` compatível com a versão PostgreSQL do Supabase. Definir `DIRECT_URL`
em ambiente seguro e executar `node scripts/backup-database.mjs backups/manual.dump`.
Opcional: definir `BACKUP_BUCKET` com o output da stack para upload SSE-S3 via AWS CLI.
O script não sobrescreve arquivo existente nem imprime senha; backups contêm dados
sensíveis e devem ficar fora do Git e fora de diretórios compartilhados. Proteger
também os arquivos locais com ACLs no Windows.

Bucket privado/versionado, retenção atual de 30 dias e versões anteriores de 7 dias.
Upload requer uma role operacional com `s3:PutObject` nesse bucket; API/jobs não a têm.
Backups são **manuais**, sem promessa de agendamento automático. Monitorar sua idade.
Restaurar primeiro em banco descartável separado com `pg_restore --no-owner --no-acl
--dbname "$RESTORE_URL" backup.dump`; não usar `--clean` no banco ativo. Validar
contagens, relacionamentos e fluxos do app. Incluir a chave de criptografia no plano
seguro de recuperação. Registrar teste de restauração antes de promover a produção.

Rollback: restaurar versão anterior de código/artefatos e invalidar CloudFront.
Não desfazer migrations automaticamente: mudanças de dados exigem plano compatível.
Buckets possuem `DeletionPolicy: Retain`; remover a stack não remove dados/backups.

Referências: [Supabase + Prisma](https://supabase.com/docs/guides/database/prisma),
[Function URL + CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html),
[headers de origem](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/add-origin-custom-headers.html),
[SAM build em container](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-build.html).

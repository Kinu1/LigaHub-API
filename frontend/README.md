# LigaHub Web

React, TypeScript e Tailwind CSS. Interface branca e vermelha, com painel de gestão e inscrição pública. As regras de negócio continuam na API NestJS.

## Iniciar

Na raiz do repositório, prepare e inicie a API conforme o README principal. Em outro terminal:

```powershell
npm.cmd --prefix frontend ci
npm.cmd run frontend:dev
```

Abra http://localhost:3001. O proxy do Vite envia `/api` para a API na porta 3000. Use **localhost** como endereço no navegador, conforme `FRONTEND_URL` e `CORS_ORIGINS`; origens diferentes precisam ser explicitamente configuradas na API.

```powershell
npm.cmd run frontend:build
npm.cmd run frontend:test
```

## E-mail local

```powershell
docker compose --profile mail up -d mailpit
```

Configure no `.env` do backend, preservando as demais configurações:

```dotenv
EMAIL_DELIVERY_ENABLED=true
EMAIL_PROVIDER=smtp
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
EMAIL_FROM=LigaHub <inscricoes@ligahub.test>
FRONTEND_URL=http://localhost:3001
```

Reinicie a API. A caixa local está em http://localhost:8025 e não entrega mensagens para a internet. Em produção, configure seu servidor SMTP, remetente e autenticação DNS do domínio. Resend existente permanece disponível com `EMAIL_PROVIDER=resend`.

Os links de gestão têm uso único e validade de 15 minutos; após a troca, o cookie da inscrição dura 8 horas. O link de confirmação já existente, em `/inscricoes/:id`, continua sendo somente de consulta e mantém seu contrato. Falha no e-mail de acesso não desfaz a reserva: o participante pode solicitar outro. SMTP pode repetir mensagens caso haja falha depois de o servidor aceitar o envio; ele não oferece a garantia de idempotência da API Resend.

## Contratos e segurança

- Sessão interna: JWT HttpOnly de até 15 minutos, refresh rotativo limitado a 8 horas desde o login; logout revoga sessões da conta. Renovação entre abas usa Web Locks quando disponível.
- `GET /browser/csrf`, `POST /auth/refresh` e cabeçalho `x-browser-client: 1` permitem a integração do navegador, sem retornar o JWT ao JavaScript. Mutações usam `x-csrf-token`; cookies autenticados exigem essa proteção mesmo sem o cabeçalho de identificação do navegador.
- `GET /dashboard` fornece agregados autorizados pelo backend.
- Eventos e inscrições aceitam `search` e `status` com paginação. Para inscrições, `status=cancellation` filtra pedidos de cancelamento; reservas expiradas são calculadas no servidor.
- `GET /payments` com `x-browser-client: 1` retorna `{items,total,page,limit}`. Clientes existentes continuam recebendo uma lista.
- `POST /public/access/recover`: `{publicId,email}`; resposta genérica e limite de 3 solicitações por hora por IP.
- `POST /public/registrations/:id/access`: `{token}`; troca o link de uso único por cookie HttpOnly. Reservas criadas pelo navegador também recebem esse cookie sem exposição do token de gestão.
- Não há credenciais em `localStorage`, cache persistente de dados pessoais ou cartão completo enviado à LigaHub. O SDK Mercado Pago tokeniza o cartão; a API verifica preços, vagas e confirmações.
- Uma falha de rede no pagamento mantém a tentativa e a chave em memória; repetir usa o mesmo corpo e chave. Após recarregar, consulte o estado antes de iniciar outra tentativa.

## Publicação

Publique `frontend/dist` e configure fallback das rotas da SPA para `index.html`. Na mesma origem HTTPS, encaminhe `/api/` ao NestJS removendo o prefixo `/api`, preserve `Set-Cookie` e não armazene respostas autenticadas em cache. Configure `NODE_ENV=production`, `FRONTEND_URL` e `CORS_ORIGINS` com a origem real. Mantenha webhooks e callback OAuth nas URLs configuradas; um callback OAuth bem-sucedido retorna o resultado da API e o organizador pode voltar ao painel financeiro para atualizar a conexão.

Não há publicação automática. Pix e cartão precisam de verificação no sandbox com a configuração do proprietário.

## Organização

`src/pages` reúne painel, editor guiado e telas do participante. `src/api.ts` centraliza transporte, CSRF e renovação; `src/ui.tsx` e `src/styles.css` compõem a interface. As páginas são carregadas sob demanda. Os testes verificam perguntas obrigatórias, correção e preservação de dados, navegação após reserva, confirmação pelo backend e repetição idempotente.

## Verificação local no navegador

Com a API compilada, as migrations aplicadas e o Mailpit iniciado, `node scripts/frontend-qa.mjs` cria dados temporários e um e-mail na caixa local. Execute apenas em banco de desenvolvimento: as credenciais de pagamento são falsas e não permitem testar cobranças. Ao terminar, `node scripts/frontend-qa.mjs clean` remove os registros dessa execução. As credenciais temporárias ficam em `.test-temp`, que não é versionado.

A verificação desta implementação passou em 166 testes unitários da API, 54 testes de integração e 5 testes do frontend. Os builds e o lint da API passaram; a interface foi conferida em celular, tablet e desktop. E-mail e acesso por cookie foram verificados com Mailpit. Cobranças Pix/cartão e publicação ainda precisam de validação no ambiente do proprietário. O workflow `frontend.yml` executa build, testes e auditoria nas próximas execuções do CI.

Referências: [Tailwind com Vite](https://tailwindcss.com/docs/installation/using-vite), [SDK Mercado Pago](https://github.com/mercadopago/sdk-js), [Mailpit em Docker](https://mailpit.axllent.org/docs/install/docker/).

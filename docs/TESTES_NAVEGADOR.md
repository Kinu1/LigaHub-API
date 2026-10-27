# Testes do fluxo do participante no navegador

Os testes Playwright executam Chromium com viewport de desktop e celular. Usam a aplicação React, cookies, CSRF, rotas reais da API e PostgreSQL. O gateway financeiro e o envio de e-mail são substituídos somente no servidor de teste; não chamam Mercado Pago ou Resend e não cobram valores reais.

## Execução local

Instale as dependências do backend e frontend, gere o cliente Prisma e aplique as migrations em um PostgreSQL de desenvolvimento ou de teste. Não utilize banco de produção. A execução exige banco em `localhost`, `127.0.0.1` ou loopback IPv6.

```powershell
npm.cmd ci
npm.cmd --prefix frontend ci
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:browser
```

Os servidores de teste usam as portas 3100 e 3101; não reutilizam uma API já iniciada. O servidor exige `LIGAHUB_BROWSER_TEST=true` e `NODE_ENV=test`, definidos pelo Playwright, e escuta somente em loopback. Seus controles de fixtures existem em `scripts/browser-test-server.mjs`, sem importação pelo código de produção. O envio de rede pelo gateway está bloqueado.

Cada teste cria usuário, conta fictícia, evento e inscrições com UUIDs próprios, removidos após o teste. `.test-temp/browser-fixture.json` registra os identificadores para recuperar a limpeza após interrupção. A limpeza confere o usuário de teste e a propriedade do evento; não remove dados de outras execuções ou usuários.

## Casos cobertos

- Reserva pelo formulário, navegação para acompanhamento e acesso pelo link capturado pelo gateway de e-mail simulado.
- Cookie HttpOnly, remoção da credencial do endereço e recusa de reutilização do link de uso único em novo carregamento.
- Pix pendente, aprovação simulada pelo provedor, confirmação pela aplicação, solicitação de cancelamento e reembolso simulado.
- Resposta financeira perdida seguida de repetição com a mesma chave e uma única cobrança fictícia.
- Recuperação de tentativa interrompida antes do envio, expiração e renovação da reserva sem criar cobrança.
- Login administrativo e retomada confirmada de um e-mail com falha, utilizando o painel e a API reais.
- Apresentação final da inscrição reembolsada e verificação de ausência de rolagem horizontal no fluxo testado.

O workflow `Navegador` utiliza um banco exclusivo do job. Os relatórios, traces e screenshots ficam em `playwright-report/` e `test-results/`, ignorados pelo Git. Eles podem conter links pessoais das fixtures; não devem ser publicados como dados de usuários reais.

Estes testes não homologam tokenização de cartão pelo SDK, entrega externa de e-mail, notificações automáticas do provedor nem deploy. As mudanças de estado financeiro usam o gateway simulado e os serviços reais da aplicação.

Referências: [servidores de teste](https://playwright.dev/docs/test-webserver) e [execução em CI](https://playwright.dev/docs/ci-intro).

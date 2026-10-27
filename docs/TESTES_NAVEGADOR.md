# Testes do fluxo do participante no navegador

Os testes Playwright executam Chromium com viewport de desktop e celular. Usam a aplicação React, cookies, CSRF, rotas reais da API e PostgreSQL. O gateway financeiro e o envio de e-mail são substituídos somente no servidor de teste. O SDK de cartão também é simulado pelo alias exclusivo de `frontend/vite.e2e.config.ts`; o formulário de teste está em `frontend/test/card-sdk.tsx`. Não chamam Mercado Pago ou Resend e não cobram valores reais. O build de produção continua usando o SDK original.

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
- Cartão com parcelas escolhidas, revisão do valor base e confirmação após aprovação simulada.
- Recusa de cartão seguida de nova tentativa, com nova chave e novas parcelas.
- Resposta incerta de cartão: repetição com a mesma chave, token e parcelas, sem outra cobrança fictícia.
- Recuperação de tentativa interrompida antes do envio, expiração e renovação da reserva sem criar cobrança.
- Login administrativo e retomada confirmada de um e-mail com falha, utilizando o painel e a API reais.
- Apresentação final da inscrição reembolsada e verificação de ausência de rolagem horizontal no fluxo testado.

O workflow `Navegador` utiliza um banco exclusivo do job. Os relatórios, traces e screenshots ficam em `playwright-report/` e `test-results/`, ignorados pelo Git. Eles podem conter links pessoais das fixtures; não devem ser publicados como dados de usuários reais.

Estes testes não homologam tokenização de cartão pelo SDK, entrega externa de e-mail, notificações automáticas do provedor nem deploy. As mudanças de estado financeiro usam o gateway simulado e os serviços reais da aplicação.

## Homologação separada do SDK real

Use a configuração normal de desenvolvimento (`npm.cmd --prefix frontend run dev`), sem o servidor nem o alias de testes de navegador. Configure uma conta de teste do organizador com chave pública TEST e credenciais de sandbox, conforme [o roteiro do Mercado Pago](MERCADO_PAGO.md). Use somente cartões fictícios oficiais do sandbox; não registre número de cartão, CVV ou token em logs, screenshots ou relatórios.

Confira o carregamento do Brick, a tokenização, as opções e valores de parcelas, a revisão e os resultados aprovado/recusado no painel do provedor. Em resposta incerta, consulte a tentativa existente e confira sua identidade antes de repetir com a mesma chave; não inicie outra cobrança enquanto o resultado for desconhecido. Registre ambiente, data e resultado sem dados sensíveis. Esse roteiro externo permanece separado da suíte determinística e não foi executado como parte desta entrega.

Referências: [servidores de teste](https://playwright.dev/docs/test-webserver) e [execução em CI](https://playwright.dev/docs/ci-intro).

# Carregamento do frontend

Medição em 15/11/2026, base `6625e57` (PR #41), Node 24, Vite 7.3.7 e Chromium do Playwright. As páginas públicas e do painel agora têm módulos próprios. `public.tsx` e `panel.tsx` preservam os exports existentes para outros consumidores; o roteador importa diretamente cada página. `Steps`, `QueryState` e `Share` continuam compartilhados.

O checkout é carregado somente quando a inscrição permite pagar. O módulo `card-checkout.tsx`, único importador do SDK Mercado Pago, é carregado somente ao abrir Cartão. A chamada externa ao SDK já era condicionada ao cartão; a melhoria também adia o código local do pacote. O estado do nome e CPF continua no checkout e permanece ao alternar métodos. O layout de gestão, a página inicial e o formulário de login também são carregados sob demanda para não serem transferidos nas telas públicas sem uso.

## Medição de produção

Cada tela usa um contexto Chromium novo, cache frio, assets locais servidos com gzip e respostas fictícias da API. Os bytes são `Network.loadingFinished.encodedDataLength` do CDP para JavaScript, incluindo cabeçalhos HTTP. Não incluem HTML, CSS, fontes ou imagens. O cartão apresenta o total acumulado após partir do Pix, no mesmo contexto.

| Tela              | JS antes (bytes) | JS depois (bytes) | Redução | Requests JS antes → depois |
| ----------------- | ---------------: | ----------------: | ------: | -------------------------: |
| Evento            |          225.998 |           212.675 |    5,9% |                      5 → 9 |
| Recuperação       |          225.998 |           201.965 |   10,6% |                      5 → 4 |
| Pagamento Pix     |          225.998 |           174.436 |   22,8% |                      5 → 8 |
| Cartão, acumulado |          225.998 |           176.314 |   22,0% |                      5 → 9 |

O arquivo principal passou de **656,49 kB para 497,92 kB** minificado; gzip de **209,14 kB para 161,37 kB**. A divisão aumenta algumas contagens de requests, reduzindo o volume de JavaScript necessário. Não se infere melhora de latência a partir desses números: dependem da rede, cache e compressão do ambiente hospedado.

Os requests HTTPS externos são bloqueados durante a medição. O script confirma zero requests externos e zero chunks do cartão antes de abrir essa opção; após abrir, observa um chunk local do cartão e uma tentativa externa. Isso valida a fronteira do carregamento, sem homologar o SDK externo ou um pagamento real. O script também preenche nome/CPF e verifica sua preservação ao voltar ao Pix.

Evidências em `docs/evidencias/desempenho-antes.json` e `docs/evidencias/desempenho-depois.json`.

## Reprodução

```powershell
npm --prefix frontend run build
node scripts/frontend-performance.mjs frontend/dist resultado.json
npm --prefix frontend test
```

Para medir o build da base anterior com o mesmo script, use `--baseline` como quarto argumento; ele permite a ausência do chunk separado que ainda não existia. Nenhum banco ou credencial é necessário. A medição usa porta local livre, selecionada pelo sistema.

Validação desta frente: build TypeScript/Vite aprovado, 97 testes frontend aprovados em 19 arquivos, oxlint nos arquivos alterados e `git diff --check` aprovados. Os testes existentes verificam respostas e formulários ao revisar/corrigir, cancelar navegação, trocar tema e renovar sessão. O novo teste cobre especificamente início tardio do SDK e preservação de nome/CPF entre métodos. A suíte completa de navegador deve ser executada no checkout integrado com o banco exclusivo de testes.

# Direção visual: LigaHub

Interface para organizadores encontrarem eventos e participantes acompanharem inscrições. A prioridade do painel é a ação “Criar evento”, seguida pelas pendências e consultas. As páginas públicas priorizam o convite e o acesso à inscrição.

## Contrato

- Fundo marfim, cartões em branco quente, bordas rosadas e ações em vermelho vinho. A diferença entre fundo e superfícies deve permanecer visível sem depender apenas de sombras.
- Menu e cabeçalhos têm superfícies próprias; janelas de confirmação recebem borda, sombra e fundo externo escurecido.
- Animações curtas de entrada e troca de abas, sem remontar formulários nem descartar dados. Sem animação quando o sistema pede movimento reduzido.
- Sons breves e opcionais, desligados inicialmente. Apenas preferência visual/sonora fica no armazenamento local; nada de tokens ou dados de inscrição. Não há música, sons em hover nem sinal sonoro que substitua uma mensagem visual.
- Conferir 360×800 e 1440×900 com nomes longos, teclado, contraste, ações com pelo menos 44 px e sem rolagem horizontal.
- Estados: carregamento com progresso; vazio com orientação; erro com nova tentativa; informação parcial preservando o que carregou; resultado com próximos passos; acesso negado com limite explícito.

Referências locais: componentes em `frontend/src/ui.tsx`, painéis e aba de histórico em `pages/panel.tsx`, navegação em `layout.tsx` e capturas anteriores em `.test-temp/ecc-qa`. A paleta preserva o pedido de branco/vermelho e corrige a pouca separação entre superfícies. Nenhuma mudança visual altera regras de negócio da API.

## Implementação e verificação

- Paleta centralizada em `styles.css`: marfim `#f2ebe7`, branco quente `#fffdfa`, rosado `#faedf0`, vermelho `#a12d3e` e vinho `#822337`.
- Cartões, formulários, menus e janelas usam fundo, borda e sombra próprios. A página inicial oferece os caminhos de inscrição e organização; o painel destaca indicadores e pendências reais retornados pela API.
- Transições nativas de 220 ms nas páginas, nas abas do evento e nas etapas do editor. O wrapper permanece montado e não redefine campos. `prefers-reduced-motion` evita a animação e cancela uma transição em andamento quando a preferência muda.
- Sons locais de aproximadamente 100 ms, sintetizados com Web Audio em volume baixo. O botão “Sons” é um controle com estado anunciado; a preferência pode ser silenciada e vale apenas neste navegador. Falha no áudio ou no armazenamento não bloqueia ações. O som indica interação, nunca aprovação de pagamento.
- Build e 11 testes do frontend aprovados, incluindo silêncio inicial, ativação/mute, indisponibilidade do áudio, preservação de formulário e movimento reduzido.
- Navegador real com respostas determinísticas para o painel: 360×800 e 1440×900, nomes longos e estados de carregamento, vazio, erro, dados parciais e acesso negado. Nenhuma gravação de dados na API ou cobrança foi realizada nesta verificação visual.
- axe sem violações nas telas conferidas: eventos, início, painel, diálogo, abas, editor e login. Esse resultado não certifica toda a aplicação.
- Teclado nas abas, som após ativar e silêncio depois de desativar, ausência de animações com movimento reduzido e preservação de dados ao voltar uma etapa conferidos no navegador.
- Capturas e registro de evidência em `.test-temp/visual-qa/` (não versionados), validados pelo checker da skill `frontend-design-direction`.

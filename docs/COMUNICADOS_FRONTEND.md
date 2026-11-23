# Interface de comunicados — verificação

A ação Notificar participantes fica na aba Inscrições do evento. O editor permite rascunho, negrito/itálico/listas/links HTTP(S), prévia isolada, teste para a própria conta, anexos, seleção de categorias combinada com confirmados, revisão e confirmação. O acompanhamento usa contadores do snapshot e destinatários paginados; aceitação pelo provedor não é apresentada como entrega. A pesquisa usa debounce e a atualização consulta resumo e página, evitando uma chamada por estado.

Uploads usam partes de até 512 KiB, SHA-256 e base64 dentro do limite JSON de 1 MiB. O MIME é inferido da extensão admitida quando o navegador não o informa; a validação definitiva pertence ao servidor. A edição é salva antes do upload. Upload interrompido reaparece no rascunho para remoção.

Verificações executadas na worktree isolada:
- Build TypeScript/Vite passou.
- Frontend: 121 testes passaram (24 arquivos), incluindo 7 de comunicados: sanitização, filtros combinados, estados sem falsa entrega total, confirmação total, repetição com mesma chave, teste da própria conta e divisão de arquivo maior que 512 KiB.
- Playwright: fluxo de composição/anexo/teste/confirmação repetida/acompanhamento passou em desktop e celular. API de comunicados controlada pelo teste; login/evento reais no backend local de fixture. Não comprova transporte Resend real.
- A primeira execução parou numa seleção nativa de estado; o fluxo final usa pesquisa para atualizar os destinatários e passou. Capturas ficam em test-results; a configuração e2e permite fontes da dependência local resolvida por junction.

Após integração das duas funcionalidades: 125 testes frontend passaram e os seis testes de navegador passaram. O cenário adicional usa a API real local, PostgreSQL, anexos persistidos e webhook assinado, substituindo somente o transporte externo por um gateway simulado. O modal mantém cabeçalho/fechar fixos durante a rolagem; capturas de desktop e celular foram inspecionadas.

Nenhum e-mail real foi enviado. A confirmação de entrega real depende de domínio/remetente e webhook Resend acessível e configurado.

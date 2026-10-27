# Filtros do histórico financeiro

`GET /payments` aceita `page` (1 a 100000, padrão 1), `eventId` (UUID), `eventSearch` (nome parcial do evento, até 120 caracteres), `status`, `method` (`pix` ou `card`), `from` e `to` (ISO 8601 com fuso). Filtros são combinados com **E**. O estado usa os valores do pagamento, incluindo `created`, e não os estados da inscrição.

O período considera `PaymentAttempt.createdAt`: início inclusivo e fim exclusivo. Datas inválidas, período invertido/igual, parâmetros repetidos ou desconhecidos são recusados com 400. A consulta e a contagem usam os mesmos filtros no banco, sempre limitados aos eventos do organizador autenticado; administradores podem consultar todos. Os filtros não substituem a autorização.

A paginação conserva 50 itens por página, ordenados por criação e UUID decrescentes. Sem `x-browser-client: 1`, o retorno continua sendo um array; com o header, conserva `{items,total,page,limit}`. Cada item acrescenta `event: {id,title}`. Tokens, credenciais e payloads criptografados não são retornados.

No painel, **Aplicar filtros** e **Limpar filtros** voltam à primeira página; navegar mantém os filtros aplicados. O campo Evento pesquisa o nome no servidor, inclusive além da página atual. As datas representam dias completos em UTC−03:00, explicitado no formulário; o dia final é convertido para o início do dia seguinte. Não há exportação CSV nesta entrega.

Verificação: validação de DTO, fronteiras de data, 51 resultados filtrados em duas páginas, contagem, ordenação e isolamento com PostgreSQL; testes React para conversão de datas, aplicação, limpeza e paginação. Todos usam dados fictícios.

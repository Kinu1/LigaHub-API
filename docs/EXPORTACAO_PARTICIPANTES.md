# Exportação consistente de participantes

A exportação verifica acesso uma vez e conta uma vez dentro de uma transação
PostgreSQL `RepeatableRead`, marcada `READ ONLY`. Os filtros são os mesmos da
listagem; o horário usado para calcular reservas expiradas é fixado no início.
Participantes, pagamentos e histórico financeiro pertencem ao mesmo snapshot.

Os lotes têm até 500 inscrições e usam cursor com ordenação por `createdAt` e `id`
decrescentes. Inserções, exclusões ou atualizações concorrentes não alteram as
linhas exportadas. Não há consultas de respostas/formulários no Excel.

O ExcelJS usa `WorkbookWriter`, sem tabela de strings compartilhadas, e libera
cada linha após `commit()`. Apenas os bytes comprimidos do XLSX permanecem em
memória até o envio: ainda há consumo proporcional ao tamanho final do arquivo.
O controller só envia após o arquivo completo e o commit da transação; falhas ou
mais de 50.000 participantes não entregam arquivo parcial. O limite inclui
exatamente 50.000; o timeout da transação é 120 segundos.

CPF continua texto, inclusive zeros iniciais; textos iniciados com `=` não são
fórmulas. O arquivo separa inscrição, situação financeira, última tentativa e
alertas. As colunas de valor e CPF preservam suas posições anteriores.

Validação: teste PostgreSQL com 502 inscrições com o mesmo `createdAt`, dois lotes, criação e exclusão de
inscrições, alteração de nome/estado e reembolso numa conexão concorrente após
o primeiro lote. As 502 linhas originais aparecem uma vez e o pagamento mantém
o valor do snapshot, inclusive histórico real de mediação já resolvida. Testes
unitários cobrem acesso, filtros combinados, CPF, limite, snapshot vazio, falha,
encerramento dos recursos internos do ExcelJS e conteúdo XLSX.

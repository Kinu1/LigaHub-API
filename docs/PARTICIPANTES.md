# Participantes por tipo de inscrição

Na aba **Inscrições** do evento, administradores e o organizador responsável podem consultar nome completo, e-mail, CPF do participante, tipo de inscrição, situação da inscrição e status da última tentativa de pagamento. Inscrições gratuitas aparecem como **Gratuita**, sem cobrança.

O filtro **Tipo de inscrição** combina com a busca por nome/e-mail e com o estado da inscrição. Eventos antigos sem categorias configuradas usam **Inscrição geral**.

## CPF do participante

O cadastro público exige CPF do participante, validado por tamanho e dígitos verificadores no backend e armazenado com AES-256-GCM, usando a chave de criptografia já configurada na aplicação. O pagamento Pix ou cartão deve usar o mesmo CPF; a API recusa divergência antes de criar uma tentativa ou chamar o provedor. No Pix o campo já vem preenchido e bloqueado; no cartão é preenchido na inicialização e validado na revisão e na API.

Inscrições antigas sem CPF mostram **Não informado** e preservam o fluxo anterior de pagamento. O CPF do pagador não é copiado retroativamente para esses participantes. O endpoint de gestão da própria inscrição retorna o CPF somente após validar token/cookie de acesso; o endpoint de consulta restrita por status-token não o expõe. A resposta de gestão usa `Cache-Control: no-store`.

Antes de iniciar a nova versão, executar `npm run db:generate` e `npm run db:migrate`. A migration `20261115180000_participant_cpf` adiciona apenas uma coluna nullable; preserva as inscrições existentes. Para recuar a aplicação, manter a coluna e os dados criptografados; uma eventual remoção deve ocorrer em migration futura, após tratar sua retenção.

## Excel

O botão **Exportar Excel** baixa um arquivo `.xlsx` com todos os participantes dos filtros selecionados, incluindo todas as páginas. O arquivo contém evento, tipo de inscrição, nome completo, CPF do participante, e-mail, situação da inscrição, status do pagamento e valor da inscrição em reais.

O endpoint `GET /events/:eventId/registrations/export` exige autenticação e verifica propriedade do evento antes de consultar os participantes. A listagem e a exportação usam `Cache-Control: no-store`. Os filtros são os mesmos de `GET /events/:eventId/registrations`: `search`, `status` e `registrationTypeId`.

A exportação suporta até 50.000 participantes por arquivo. Acima desse limite, retorna uma mensagem pedindo filtros mais específicos; não entrega uma planilha incompleta. O arquivo preserva CPF como texto, inclusive zeros iniciais. Valores fornecidos pelos usuários são células de texto, sem geração de fórmulas ou hyperlinks. O status financeiro representa a última tentativa de pagamento; a situação da inscrição aparece em coluna própria.

## Verificação

Testes cobrem isolamento entre organizadores, combinação dos filtros, dados legados, CPF válido/inválido, exportação de todas as páginas, formato monetário, texto literal e limite de exportação. O fluxo de navegador usa organizador autenticado, categorias paga e gratuita e lê o XLSX baixado para conferir nome, CPF, e-mail, categoria e pagamento.

# Confirmação de inscrição por e-mail

Quando um pagamento aprovado permite confirmar a vaga, o backend grava a confirmação, o token de consulta e uma tarefa `email_outbox` na mesma transação. Falha nessa gravação desfaz também a confirmação; webhook ou reconciliação podem tentar novamente. Uma restrição única por inscrição impede criar várias confirmações. Pagamentos em revisão não geram e-mail afirmando que há uma vaga.

O envio usa Resend por uma interface `EmailGateway`. Configure no `.env` local:

```dotenv
EMAIL_DELIVERY_ENABLED=true
RESEND_API_KEY=sua-chave-local
EMAIL_FROM=LigaHub <confirmacoes@seu-dominio.com>
FRONTEND_URL=https://seu-frontend.com
```

Verifique o domínio e remetente no Resend antes de ativar. As restrições de destinatários do ambiente de teste do provedor devem ser respeitadas. Sem configuração, as tarefas permanecem pendentes; o pagamento e a vaga não dependem da disponibilidade do serviço de e-mail. Nenhum teste automatizado envia mensagens reais.

O worker consulta a fila a cada 15 segundos, processando até 10 itens por rodada. `FOR UPDATE SKIP LOCKED` e uma concessão de 90 segundos impedem que instâncias reivindiquem simultaneamente o mesmo item. Uma interrupção libera o item após expirar a concessão. O mesmo corpo e chave de idempotência são preservados em todas as tentativas, inclusive se o provedor aceitar o e-mail e a resposta se perder.

Há até oito tentativas, com espera progressiva de 1 a 64 minutos. Como as chaves do Resend duram 24 horas, interrompemos a repetição automática 23 horas após a primeira tentativa. Itens `failed` exigem análise operacional; não são reenviados automaticamente. Não há garantia absoluta de entrega na caixa de entrada: `sent` significa aceito pelo provedor. O conteúdo criptografado é apagado após aceite, mantendo identificador do provedor e data. Erros não registram e-mail ou token em logs.

## Link de consulta

Antes de cada tentativa, inclusive após falha ou timeout, o worker verifica se a inscrição continua confirmada, sem suspensão e com token válido. Caso contrário, descarta a tarefa como `skipped`. Um e-mail já aceito pelo provedor não pode ser desfeito por essa verificação.

O e-mail aponta para `/inscricoes/UUID#token=TOKEN` no frontend. O token fica no fragmento, não na query enviada ao servidor. A futura página deve lê-lo, removê-lo do endereço com `history.replaceState`, mantê-lo apenas em memória e chamar:

```http
GET /public/registrations/UUID/status
x-registration-status-token: TOKEN
```

A resposta mostra nome, situação da inscrição, suspensão, solicitação de cancelamento e dados do evento. Não inclui CPF, respostas do formulário ou credenciais. O token aleatório possui 256 bits, é guardado como hash na inscrição, expira 90 dias após a confirmação e não funciona nas rotas de alteração, cancelamento ou pagamento. A resposta usa `Cache-Control: no-store`.

A página do frontend ainda não foi implementada. Não ative envio para participantes reais antes de publicá-la e configurar `FRONTEND_URL`. O link mostra a situação atual; um reembolso posterior pode mudar o status para cancelado.

## Hospedagem

O intervalo atende à API local ou um processo permanente. Para Vercel/serverless, será necessário invocar o processamento por um agendador autenticado ou executar o worker separadamente; não dependa de `setInterval` em funções efêmeras.

Referências: [Enviar e-mail no Resend](https://resend.com/docs/api-reference/emails/send-email), [Idempotência no Resend](https://resend.com/docs/dashboard/emails/idempotency-keys).

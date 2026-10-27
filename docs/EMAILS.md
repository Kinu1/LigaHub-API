# Confirmação de inscrição por e-mail

Quando um pagamento aprovado permite confirmar a vaga, o backend grava a confirmação, o token de consulta e uma tarefa `email_outbox` na mesma transação. Falha nessa gravação desfaz também a confirmação; webhook ou reconciliação podem tentar novamente. Uma restrição única por inscrição impede criar várias confirmações. Pagamentos em revisão não geram e-mail afirmando que há uma vaga.

O envio usa Resend por uma interface `EmailGateway`. Configure no `.env` local:

```dotenv
EMAIL_DELIVERY_ENABLED=true
EMAIL_PROVIDER=resend
RESEND_API_KEY=sua-chave-local
EMAIL_FROM=LigaHub <confirmacoes@seu-dominio.com>
FRONTEND_URL=https://seu-frontend.com
```

Verifique o domínio e remetente no Resend antes de ativar. As restrições de destinatários do ambiente de teste do provedor devem ser respeitadas. Sem configuração, as tarefas permanecem pendentes; o pagamento e a vaga não dependem da disponibilidade do serviço de e-mail. Nenhum teste automatizado envia mensagens reais.

Defina `EMAIL_PROVIDER=resend` para usar o Resend ou `EMAIL_PROVIDER=smtp` para usar SMTP. A seleção é compartilhada pelo envio e pela fila: com Resend selecionado, `SMTP_HOST` não substitui a exigência de `RESEND_API_KEY`; com SMTP selecionado, a chave do Resend não substitui `SMTP_HOST`. Se a configuração exigida estiver ausente, a fila permanece pendente sem consumir tentativas. Para compatibilidade, sem `EMAIL_PROVIDER`, a presença de `SMTP_HOST` seleciona SMTP; caso contrário, Resend.

O worker consulta a fila a cada 15 segundos, processando até 10 itens por rodada. `FOR UPDATE SKIP LOCKED` e uma concessão de 90 segundos impedem que instâncias reivindiquem simultaneamente o mesmo item. Uma interrupção libera o item após expirar a concessão. O mesmo corpo e chave de idempotência são preservados em todas as tentativas, inclusive se o provedor aceitar o e-mail e a resposta se perder.

Há até oito tentativas, com espera progressiva de 1 a 64 minutos. Como as chaves do Resend duram 24 horas, interrompemos a repetição automática 23 horas após a primeira tentativa. Itens `failed` exigem análise operacional; não são reenviados automaticamente. Não há garantia absoluta de entrega na caixa de entrada: `sent` significa aceito pelo provedor. O conteúdo criptografado é apagado após aceite, mantendo identificador do provedor e data. Erros não registram e-mail ou token em logs.

## Link de consulta

Antes de cada tentativa, inclusive após falha ou timeout, o worker verifica se a inscrição continua confirmada, sem suspensão e com token válido. Caso contrário, descarta a tarefa como `skipped`. Um e-mail já aceito pelo provedor não pode ser desfeito por essa verificação.

O e-mail aponta para `/inscricoes/UUID#token=TOKEN` no frontend. O token fica no fragmento, não na query enviada ao servidor. A página captura o token em memória, remove o fragmento do endereço com `history.replaceState` e chama:

```http
GET /public/registrations/UUID/status
x-registration-status-token: TOKEN
```

A resposta mostra nome, situação da inscrição, suspensão, solicitação de cancelamento e dados do evento. Não inclui CPF, respostas do formulário ou credenciais. O token aleatório possui 256 bits, é guardado como hash na inscrição, expira 90 dias após a confirmação e não funciona nas rotas de alteração, cancelamento ou pagamento. A resposta usa `Cache-Control: no-store`.

A página de consulta está implementada e mostra a situação da inscrição, nome e dados do evento, além de avisos de suspensão e solicitação de cancelamento quando presentes. Solicitar cancelamento não comprova reembolso: o estado da inscrição continua sendo apresentado separadamente. Links sem token, inválidos ou expirados oferecem acesso à recuperação.

A publicação da página e a entrega externa por e-mail ainda precisam ser verificadas no ambiente de destino. Antes de ativar envio para participantes reais, publique o frontend, configure `FRONTEND_URL` e valide o recebimento de um e-mail com link funcional. O link mostra a situação atual; um reembolso posterior pode mudar o status para cancelado.

## Hospedagem

O intervalo atende à API local ou um processo permanente. Para Vercel/serverless, será necessário invocar o processamento por um agendador autenticado ou executar o worker separadamente; não dependa de `setInterval` em funções efêmeras.

Referências: [Enviar e-mail no Resend](https://resend.com/docs/api-reference/emails/send-email), [Idempotência no Resend](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Operação administrativa da outbox

Somente administradores autenticados podem usar:

- `GET /admin/email-outbox?status=failed&page=1&limit=20`: status obrigatório (`pending`, `processing`, `sent`, `failed` ou `skipped`), páginas a partir de 1 e limite de 1 a 100. Ordenação por criação e identificador, decrescente. Retorna `items`, `total`, `page` e `limit`; cada item contém identificadores da tarefa/inscrição, status, tentativas e datas. Não retorna payload, destinatário, token, chave, leaseId ou erros brutos. `reason` é uma classificação segura, não um diagnóstico do provedor: janela expirada, limite de tentativas ou necessidade de análise manual. Sem coluna de erro no schema, a causa histórica exata não está disponível.
- `POST /admin/email-outbox/:id/retry`: uma tentativa imediata, sem corpo, somente para `failed`. Exige primeira tentativa conhecida há menos de 23 horas, mensagem original já preparada e válida, inscrição confirmada, não suspensa e token vigente. Itens sem primeira tentativa ou sem mensagem congelada exigem investigação; esta operação não reconstrói mensagens. Retorna identificador e status após aceite. Conflitos de segurança retornam 409; entrega desativada/falha do provedor retornam 503.

A retomada preserva o payload criptografado até aceite, a primeira tentativa e a chave `confirmation/ID_ORIGINAL`; incrementa tentativas sem apagar o histórico. Não cria outra tarefa nem chave. Bloqueio transacional impede duas retomadas simultâneas; a concessão impede disputa com o worker. A autorização grava auditoria `registration.email_retry_authorized` vinculada à inscrição, com ator, ID da tarefa e número da tentativa, sem conteúdo sensível. Falha do provedor mantém `failed`, sem voltar para repetição automática. Após interrupção do processo, a concessão existente continua sujeita às regras de recuperação do worker e à janela original.

Payload ilegível/inválido durante a preparação torna apenas aquele item `failed`, preserva o conteúdo para análise e permite continuar o lote. Chave ausente/malformada ou configuração de renderização inválida interrompem a rodada antes de reivindicar itens. Uma chave de tamanho válido, mas incorreta, não é distinguível de conteúdo corrompido: não restaure itens em massa; investigue a configuração antes de qualquer retomada. O endpoint não ativa entrega desativada nem contorna a seleção de provedor.

Validação local: `npm.cmd run test:e2e -- test/outbox.integration.e2e-spec.ts`. O teste exige PostgreSQL, cria e remove somente suas fixtures e limita o processamento a elas. O gateway é simulado; nenhum e-mail real é enviado.

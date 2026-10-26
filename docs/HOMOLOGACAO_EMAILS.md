# Homologação de e-mails

## Resultado de 26/10/2026

O envio externo foi validado com o remetente de teste `LigaHub <onboarding@resend.dev>` e um único destinatário autorizado, associado à conta Resend. A chave permaneceu no `.env` local e não foi versionada.

1. **Envio pelo gateway da aplicação:** `ResendEmailGateway` enviou uma mensagem de homologação usando a chave local. O provedor informou `delivered`, e o destinatário confirmou o recebimento.
2. **Confirmação de inscrição pela outbox:** um evento e uma inscrição fictícios, identificados como teste sem cobrança, foram criados no banco local. `enqueueConfirmation` produziu a tarefa; `EmailOutboxService.processBatch` processou somente essa inscrição. A mensagem utilizou o template da aplicação, com assunto e aviso explícitos de homologação. O provedor informou `delivered`.
3. **Persistência e repetição:** a tarefa ficou em `sent`, com identificador do provedor e conteúdo criptografado removido. Uma segunda chamada ao processamento não gerou outro envio.
4. **Consulta da inscrição:** o token recebido no e-mail retornou HTTP 200 e `confirmed` em `/public/registrations/:id/status`, com `Cache-Control: no-store`. O mesmo token não autorizou a rota de gestão, que retornou HTTP 401.
5. **Recuperação de acesso:** uma chamada HTTP a `/public/access/recover` gerou a segunda mensagem da aplicação pelo Resend; o provedor informou `delivered`. O link criado tinha prazo válido e continuou sem uso para conferência pelo destinatário.
6. **Troca de credencial e reutilização:** outro token de teste, criado exclusivamente para verificação, foi trocado por cookie HttpOnly. A consulta autenticada retornou HTTP 200; reutilizar esse token retornou HTTP 401. O teste não consumiu o link enviado ao destinatário.

As evidências locais resumidas ficaram em `.test-temp/resend-homologacao.json` e `.test-temp/confirmacao-resend-resultado.json`, fora do versionamento. A confirmação da outbox e a recuperação foram verificadas no provedor às 17h05, horário de Brasília.

## Condições e limites

- Nenhuma cobrança ou pagamento real foi realizado. A inscrição foi confirmada como fixture local, portanto esta execução não comprova o encadeamento de um pagamento externo real até o envio.
- O processamento da outbox foi invocado de maneira controlada e limitado à inscrição de teste. Os timers de envio e reconciliação foram desativados na inicialização desse processo; esta execução não homologa o agendamento em produção.
- As alterações de provedor, remetente e flags valeram somente no processo de homologação. O `.env` e os destinatários de tarefas antigas não foram alterados.
- Os links apontam para `http://localhost:3001`, e a API local foi disponibilizada para conferência no mesmo computador. A resposta da rota da SPA foi HTTP 200; isso não constitui uma nova inspeção visual da interface.
- `delivered` registra a aceitação pelo servidor destinatário; não demonstra, sozinho, a pasta em que a mensagem apareceu. O primeiro teste teve confirmação adicional do destinatário.
- O remetente `onboarding@resend.dev` só permite envio ao endereço associado à conta Resend. Envio a participantes requer domínio próprio verificado.

## Pendências antes de produção

- Publicar o frontend e a API em HTTPS e configurar `FRONTEND_URL`, CORS, proxy e cookies para a origem definitiva.
- Validar os links recebidos nesse ambiente, incluindo o uso no navegador, expiração e recuperação.
- Configurar e verificar o domínio/remetente de produção e validar a entrega aos destinatários permitidos.
- Comprovar o fluxo completo: pagamento sandbox aprovado, confirmação transacional, processamento pelo worker e entrega externa. Observar também o webhook automático e a recuperação por reconciliação.

Referência do provedor: [restrições do remetente de teste](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

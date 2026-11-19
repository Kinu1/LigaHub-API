# Comunicações de eventos — contrato

Base `/events/:eventId/communications`. JWT/cookie e CSRF existentes. Admin ou organizer dono ATUAL do evento em todas as ações. No-store inclusive erros. IDs de rota UUID.

- POST / cria draft: `{subject,htmlContent,textContent,audienceType,audienceCategoryIds,confirmedOnly?}`. audienceType: all_active|confirmed_only|categories. IDs de categoria vêm do JSON registrationTypes do evento. confirmedOnly default false compõe com categories. Retorna campanha 201.
- PUT /:campaignId mesmos campos opcionais, somente draft, retorna campanha 200.
- GET / `?status=&search=&limit=20&offset=0`: `{data,total,limit,offset}` com recipientCount/attachmentCount.
- GET /:campaignId: campanha, event, owner, attachments (metadados), recipientCount, counts e allDelivered. Sem payload/chunks/leases internos. Destinatários paginados separadamente.
- GET /:campaignId/preview: `{total,byCategory:[{categoryId,count}],sample:[{registrationId,email,name,status,categoryId}]}` (até 10).
- POST /:campaignId/test `{email?}`: destino sempre email atual do usuário autenticado no banco; email divergente 403. Retorna 200 `{providerId,message}`. Inclui anexos e logo. Exige draft completo.
- POST /:campaignId/send `{idempotencyKey:UUIDv4}`: 202 `{campaignId,recipientCount,status:'queued',alreadySent?}`. Mesma campanha/chave repete snapshot. Outra chave após envio ou mesma chave noutra campanha:409. Chave da campanha permanente.
- GET /:campaignId/recipients `?status=&search=&limit=50&offset=0`: `{data,total,limit,offset}`. Estados pending|queued|processing|accepted|delivered|delayed|failed|unconfirmed_after24h|skipped.
- POST /:campaignId/attachments/initiate `{filename,mimeType,sizeBytes,checksum,totalChunks}` (SHA256 hex):201 `{attachmentId,expiresAt}`.
- POST /:campaignId/attachments/:attachmentId/chunks `{dataBase64,chunkIndex,checksum}`:200 `{receivedChunks,totalChunks}`. Chunks de 524288 bytes, último menor; totalChunks=ceil(sizeBytes/524288). Repetição idêntica idempotente; divergente409.
- POST /:campaignId/attachments/finalize `{attachmentId}`:200 `{status:'ready',message}`. Chunks apagados após finalização.
- DELETE /:campaignId/attachments/:attachmentId:200 `{message}`, somente draft.
- GET /:campaignId/attachments/:attachmentId/download: binário attachment, Content-Type correspondente.

Limites 5 arquivos/soma10MiB, JSON1MiB. PDF PNG JPEG TXT CSV UTF8 e DOCX/XLSX/PPTX sem macros; ZIP parseado com inflação/entradas limitadas, bloqueia executável/OLE/macros. HTML parser allowlist p,strong,em,ul,ol,li,a,br, href http/https. Templates escapam dados dinâmicos. Conteúdo e anexos/chunks criptografados em repouso.

Ativos: confirmed, payment_review mesmo reserva vencida, reserved com reserva futura; exclui suspensos/cancelados/expirados. Pedido de cancelamento sozinho não cancela. Categorias validadas. Snapshot e bloqueio transacional no envio; edição/upload usa mesmo lock. Rechecagem antes do provedor.

Job emails: acesso e confirmação antes de comunicações. Resend dedicado independente SMTP; EMAIL_FROM verificado, Reply-To do usuário autenticado que enviou (snapshot). Logo atual CID empacotado em src/assets e dist/assets, também Lambda. Sem opens/read tracking.

POST público /notifications/resend/webhook: Svix oficial sobre corpo ORIGINAL, headers svix-id, svix-timestamp (segundos), svix-signature v1,<base64>, tolerância5min. Deduplica e persiste eventos antecipados; delivered não regride; bounce/complaint ficam no histórico. Accepted/delayed nunca reenviados. Sem confirmação24h vira unconfirmed_after24h, corrigível por entrega tardia. allDelivered só TODOS destinatários originais (>0) entregues.

Operação: ver communications.env.example. Sem Resend fila fica intacta. Leases90s, até5 tentativas, backoff exponencial temporário, janela conservadora23h (Resend24h), deadline preservado. Upload incompleto24h; anexos terminais30d sem pendências. Migração aditiva; rollback desabilitando feature, manter dados, remoção exige nova migração.

Checks reais e limitações serão preenchidos ao término. Sem email/rede real ou migração produção.

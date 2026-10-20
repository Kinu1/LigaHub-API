# Dados do pagador no financeiro

`GET /payments` exige sessão de administrador ou organizador. O organizador vê somente pagamentos dos eventos que possui; o administrador mantém acesso ao histórico geral. A resposta recebe `Cache-Control: no-store` e acrescenta `payer: { name, cpf } | null` apenas nesse endpoint. As respostas públicas de pagamento e acompanhamento não contêm esses campos.

O checkout de Pix e cartão solicita o nome completo de quem está pagando, preenchido inicialmente com o nome da inscrição e editável caso sejam pessoas diferentes. O nome e o CPF aparecem na revisão antes do envio. A API valida o nome (até 120 caracteres) e o CPF (11 dígitos), e inclui o nome na verificação de idempotência. Para compatibilidade com clientes anteriores, `payerName` é opcional na API e sua ausência utiliza o nome cadastrado na inscrição.

Os dados informados são guardados em `PaymentAttempt.payerEncrypted`, criptografados com AES-256-GCM pela mesma infraestrutura de credenciais existente. Esse registro contém somente nome e CPF, permanece após aprovação/recusa e não contém token de cartão. Trata-se dos dados informados no checkout, não de uma confirmação da identidade do titular da conta bancária ou do cartão pelo provedor.

Registros antigos sem esses dados mostram “Não informado”. Requisições antigas ainda criptografadas podem fornecer o nome/CPF originalmente enviados; ao processar o resultado, esses dados são preservados antes do descarte da requisição. Não se atribui um CPF inventado nem se substitui o pagador pelo participante atual.

## Banco e publicação

Executar `npm run db:migrate` e `npm run db:generate` antes de iniciar a versão atualizada da API. A migração `202610120002_payment_payer` adiciona uma coluna opcional e preserva os registros existentes. Para reverter a aplicação, manter a coluna e seus dados; uma eventual remoção requer uma nova migração depois de retirar as referências no código.

## Verificação

### Validação real de sandbox em 20/10/2026

Um novo evento de teste foi criado e publicado pela API local. Uma inscrição com participante e pagador de nomes diferentes recebeu um pagamento Mastercard de teste de R$ 50 em uma parcela, aprovado pela Orders API. A inscrição ficou `confirmed`.

O banco manteve `payerEncrypted` preenchido e descartou `providerRequestEncrypted` após identificar a order. O histórico autenticado retornou exatamente o nome e CPF de teste enviados. Repetir o corpo com a mesma chave retornou a mesma tentativa, mantendo apenas um registro. Após parar e iniciar novamente a API, o histórico continuou retornando os mesmos dados. A confirmação foi capturada no Mailpit, com uma única tarefa na outbox; o link somente de consulta retornou HTTP 200 e `confirmed`.

Os seis pagamentos anteriores, feitos antes da implementação de persistência do pagador, permanecem sem esses dados. Esta validação não os preenche nem altera sua identidade. Os resultados locais, sem tokens nos relatórios, estão em `.test-temp/payer-validation-result.json`, `.test-temp/payer-after-restart-result.json` e `.test-temp/payer-confirmation-result.json`.

O webhook de sandbox foi atualizado para o túnel HTTPS ativo, mantendo produção sem URL e os tópicos `order` e `payment`. Uma chamada assinada localmente recebeu HTTP 201 e uma assinatura inválida recebeu HTTP 401. Uma segunda compra de teste foi aprovada após essa configuração, mas o diagnóstico do provedor continuou sem notificações registradas. Isso não comprova entrega automática pelo Mercado Pago. Posteriormente, o proprietário confirmou sucesso da simulação pelo painel após a correção da assinatura descrita em `MERCADO_PAGO.md`. O endereço temporário deve ser atualizado quando o túnel mudar.

Testes de integração cobrem armazenamento criptografado, preservação após processamento, diferença entre participante e pagador, isolamento entre organizadores, acesso administrativo, idempotência e ausência de CPF nas respostas públicas. O frontend verifica a exibição do nome/CPF formatado, ausência explícita em registros antigos e repetição da mesma tentativa após falha de rede.

Verificação local em 12/10/2026 seguindo `verification-loop`: builds da API/frontend e checagem de tipos pelos respectivos projetos passaram; 205 testes unitários da API, 57 testes de integração e 13 testes do frontend passaram. A cobertura de linhas da suíte unitária geral é 65,59%, abaixo da referência de 80% da skill; essa medição não inclui a suíte de integração. O lint com análise de tipos passou em Linux via Docker, com zero avisos e erros; esse ambiente evita o bloqueio do executável pelo Controle de Aplicativos do Windows. A revisão do diff passou e as auditorias de dependências da API/frontend não encontraram vulnerabilidades.

Conferência visual com dados fictícios em 360, 768, 1024 e 1440 px: sem rolagem horizontal e sem violações no axe. Em telas menores que 1280 px, os pagamentos aparecem em linhas empilhadas para acomodar os seis campos e nomes longos. Evidência local, fora do versionamento: `.test-temp/payer-qa/report.json` e screenshots nessa pasta. Nenhuma cobrança real foi criada para esses testes.

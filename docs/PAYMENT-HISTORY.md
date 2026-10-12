# Dados do pagador no financeiro

`GET /payments` exige sessão de administrador ou organizador. O organizador vê somente pagamentos dos eventos que possui; o administrador mantém acesso ao histórico geral. A resposta recebe `Cache-Control: no-store` e acrescenta `payer: { name, cpf } | null` apenas nesse endpoint. As respostas públicas de pagamento e acompanhamento não contêm esses campos.

O checkout de Pix e cartão solicita o nome completo de quem está pagando, preenchido inicialmente com o nome da inscrição e editável caso sejam pessoas diferentes. O nome e o CPF aparecem na revisão antes do envio. A API valida o nome (até 120 caracteres) e o CPF (11 dígitos), e inclui o nome na verificação de idempotência. Para compatibilidade com clientes anteriores, `payerName` é opcional na API e sua ausência utiliza o nome cadastrado na inscrição.

Os dados informados são guardados em `PaymentAttempt.payerEncrypted`, criptografados com AES-256-GCM pela mesma infraestrutura de credenciais existente. Esse registro contém somente nome e CPF, permanece após aprovação/recusa e não contém token de cartão. Trata-se dos dados informados no checkout, não de uma confirmação da identidade do titular da conta bancária ou do cartão pelo provedor.

Registros antigos sem esses dados mostram “Não informado”. Requisições antigas ainda criptografadas podem fornecer o nome/CPF originalmente enviados; ao processar o resultado, esses dados são preservados antes do descarte da requisição. Não se atribui um CPF inventado nem se substitui o pagador pelo participante atual.

## Banco e publicação

Executar `npm run db:migrate` e `npm run db:generate` antes de iniciar a versão atualizada da API. A migração `202610120002_payment_payer` adiciona uma coluna opcional e preserva os registros existentes. Para reverter a aplicação, manter a coluna e seus dados; uma eventual remoção requer uma nova migração depois de retirar as referências no código.

## Verificação

Testes de integração cobrem armazenamento criptografado, preservação após processamento, diferença entre participante e pagador, isolamento entre organizadores, acesso administrativo, idempotência e ausência de CPF nas respostas públicas. O frontend verifica a exibição do nome/CPF formatado, ausência explícita em registros antigos e repetição da mesma tentativa após falha de rede.

Verificação local em 12/10/2026 seguindo `verification-loop`: builds da API/frontend e checagem de tipos pelos respectivos projetos passaram; 205 testes unitários da API, 57 testes de integração e 13 testes do frontend passaram. A cobertura de linhas da suíte unitária geral é 65,59%, abaixo da referência de 80% da skill; essa medição não inclui a suíte de integração. O lint com análise de tipos passou em Linux via Docker, com zero avisos e erros; esse ambiente evita o bloqueio do executável pelo Controle de Aplicativos do Windows. A revisão do diff passou e as auditorias de dependências da API/frontend não encontraram vulnerabilidades.

Conferência visual com dados fictícios em 360, 768, 1024 e 1440 px: sem rolagem horizontal e sem violações no axe. Em telas menores que 1280 px, os pagamentos aparecem em linhas empilhadas para acomodar os seis campos e nomes longos. Evidência local, fora do versionamento: `.test-temp/payer-qa/report.json` e screenshots nessa pasta. Nenhuma cobrança real foi criada para esses testes.

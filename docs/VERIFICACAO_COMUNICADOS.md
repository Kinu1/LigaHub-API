# Verificação — cortesias e comunicados

| Etapa | Resultado |
|---|---|
| Prisma e migrations aditivas | PASS, somente PostgreSQL de teste na porta 5434 |
| Build e tipos backend/frontend | PASS, comandos suportados do projeto |
| Lint | PASS, somente aviso preexistente em catalog.service.ts |
| Backend | 433/433 testes |
| Frontend integrado | 125/125 testes; 7 casos de comunicados |
| Integração PostgreSQL | 186/186 testes |
| Scripts e empacotamento | 16/16 testes |
| Navegador | 6/6, desktop e celular |
| Segurança e diff | Permissões, no-store, validação de conteúdo, SQL parametrizado e ausência de segredos nos novos arquivos conferidos |

A cobertura por integração dos núcleos de comunicados foi 92,43% das linhas do
processador, 85,71% do serviço e 87,83% de anexos. A medição e2e isolada de todo
o diretório (que inclui DTOs e arquivos de teste) não atingiu 80% global; unidade
e integração foram executadas separadamente. Não há limiar global de cobertura
configurado. O formulário de cortesia atingiu 93,1% das linhas e 82,75% dos ramos.

Os cenários verificam concorrência de vagas e duplicatas, valor zero e ausência
de cobrança, seleção/snapshot do público, arquivos/chunks criptografados,
HTML e formatos, chave idempotente, concessões e interrupções, aceite versus
entrega, webhooks inválidos/repetidos/antecipados/fora de ordem, entrega tardia,
ocorrências posteriores e retenção. A suíte completa mantém os testes de acesso,
confirmação de inscrição e pagamentos.

O navegador validou o frontend com API controlada e também o fluxo completo com
API/PostgreSQL locais e webhook Svix assinado. Somente o transporte de e-mail foi
simulado nesse segundo cenário; não representa homologação real do Resend.
As capturas estão nos artefatos locais ignorados em `test-results`.

As branches são separadas. O PR de comunicados usa a branch de cortesias como
base para revisar os diffs independentemente e já inclui a resolução dos pontos
compartilhados da aba Inscrições e do harness de testes. A base anterior das duas
funcionalidades é feat/taxa-ligahub-pix, checkout original da tarefa.

Sem implantação, migration remota ou envio real. Faltam domínio/remetente e
webhook Resend acessível, configuração dos secrets e homologação com destinatários
autorizados. O empacotamento do logo foi testado; não foi feito build SAM/Linux.

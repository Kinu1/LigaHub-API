# Webhook de sandbox — verificação de 15/11/2026

## Resultado: homologação automática pendente

A verificação remota foi executada em **15/11/2026 às 19:26:37 UTC (16:26:37 de Brasília)**, usando a configuração local e consultas somente de leitura. Nenhuma cobrança, alteração de credenciais, alteração no painel do provedor ou escrita no banco foi realizada.

| Verificação atual | Evidência |
| --- | --- |
| Ambiente selecionado | `MERCADO_PAGO_TEST_MODE=true` explícito. |
| Credencial da conta | `GET https://api.mercadopago.com/users/me` retornou HTTP 200; `test_user=true` e `site_id=MLB`. Identificador e dados pessoais foram omitidos. |
| Public Key e segredo de webhook | Presentes. A presença não comprova que correspondam à aplicação configurada no painel. |
| Endpoint configurado | URL HTTPS, sem credenciais embutidas e com caminho `/payments/webhook`. Host omitido. |
| Acessibilidade | Resolução DNS retornou `ENOTFOUND`. As consultas a `/health` e `/payments/webhook` não estabeleceram conexão na primeira verificação, às 19:25 UTC. A nova consulta DNS confirmou a falha às 19:26 UTC. |
| Operação nova de sandbox | Não criada: o destino configurado não recebe chamadas enquanto não resolver DNS. |
| Recebimento automático e assinatura | Pendente. Nenhum callback do Mercado Pago foi observado nesta execução. |
| Atualização, confirmação e ausência de duplicação | Pendentes nesta execução remota. Testes automatizados com gateway simulado não substituem esta evidência. |
| Reenvio do provedor e recuperação por reconciliação | Pendentes para a nova operação. |

O erro comprova a indisponibilidade do endereço configurado a partir deste ambiente naquele instante; não identifica a causa do problema do provedor nem verifica a configuração do painel. As evidências históricas de 26/10 permanecem em [HOMOLOGACAO_PAGAMENTOS.md](HOMOLOGACAO_PAGAMENTOS.md), com seus próprios limites.

## Repetir a verificação sem cobrar

Na raiz do checkout com o `.env` configurado:

```powershell
node scripts/check-mercado-pago-remote.mjs
node --test scripts/mercado-pago-preflight.test.mjs
```

Em outro worktree, é possível indicar o arquivo local pelo mecanismo nativo do Node:

```powershell
node --env-file=C:\Projetos\ApiLiga\.env scripts/check-mercado-pago-remote.mjs
```

O comando consulta a conta de teste e, quando o DNS permite, faz somente GET em `/health` e `/payments/webhook`, sem encaminhar o token a esses destinos. Não segue redirecionamentos. O JSON imprime apenas presença de configuração, códigos HTTP, identificação booleana do ambiente de teste e erro DNS permitido; nunca imprime URL configurada, credenciais, assinatura ou resposta bruta da conta.

O código de saída é `1` quando um pré-requisito remoto falha; `0` significa apenas que as consultas preliminares responderam. Um GET em `/payments/webhook`, inclusive HTTP 404/405, **não comprova** que o POST esteja roteado ou que a assinatura seja aceita. O campo `automaticWebhook` permanece `pending` em todos os casos. Public Key, segredo e aplicação do painel ainda exigem conferência privada.

## Concluir a homologação automática

1. Disponibilizar o receptor HTTPS, conferir DNS e `/health` externamente e manter a API acessível durante a observação. Se um túnel temporário for usado, atualizar tanto o ambiente da API quanto o painel quando o endereço mudar.
2. No painel da aplicação, selecionar **Teste**, cadastrar o endereço atual, habilitar **Order (Mercado Pago)** e conferir em privado se credenciais, aplicação e segredo pertencem à mesma integração. Não registrar capturas com segredos ou dados pessoais.
3. Usar a simulação do painel apenas para diagnosticar conectividade e assinatura. Registrar separadamente que se trata de uma simulação; ela não conclui o recebimento automático.
4. Criar uma inscrição fictícia e uma operação pela LigaHub usando somente a conta `test_user` conferida e dados oficiais de teste. Revalidar o modo de teste e o vínculo local `isTest=true` antes de criar a operação. Para observar a transição financeira, usar um cenário inicialmente pendente e evitar que a reconciliação atualize essa tentativa antes do callback.
5. Acompanhar simultaneamente a aba **Webhooks / Teste** do provedor e os registros do receptor. Registrar horário UTC, alias da operação, evento `order`, resultado da validação de assinatura, código de resposta e a atualização local vinculada ao mesmo recurso. O provedor espera HTTP 200 ou 201. Preservar evidência privada para correlação; no repositório, usar somente aliases e contagens.
6. Conferir que o pagamento atualizado confirmou a inscrição e produziu somente uma tarefa de confirmação. Quando a resposta de criação já confirmar o pagamento, registrar esse fato e não atribuir a confirmação ao callback posterior.
7. Usar **Reenviar notificações** no monitoramento do provedor para a mesma notificação. Conferir que quantidades de tentativas, tarefas de confirmação e efeitos de atualização não aumentam. Uma assinatura criada localmente não comprova esse reenvio.
8. Em uma segunda operação fictícia e isolada, comprovar a recuperação de uma atualização não recebida pela rotina real de reconciliação. Restringir a execução à tentativa de teste; repetir a rotina e conferir ausência de duplicação. Diferenciar explicitamente esse resultado do webhook automático.
9. Se o provedor não enviar a notificação mesmo com o receptor acessível e a configuração conferida, preservar o resultado do monitoramento e acionar o suporte. Manter a homologação pendente até existir o callback verificável.

Referência consultada em 15/11/2026: [configuração, assinatura, monitoramento e reenvio de notificações de orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications).

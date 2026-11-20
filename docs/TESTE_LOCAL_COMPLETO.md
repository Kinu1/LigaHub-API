# Projeto completo com dados fictícios

As funcionalidades de cortesia e comunicados foram integradas no checkout
`C:/Projetos/ApiLiga`, na branch `chore/integracao-comunicados-cortesias`, que
preserva o histórico anterior de `feat/taxa-ligahub-pix`.

O ambiente local preparado usa:

- Frontend completo: http://localhost:3001/login
- API completa: http://127.0.0.1:3000
- Acesso de demonstração: `admin@ligahub.test` / `Teste@123456`
- Banco fictício exclusivo: `ligahub_communications_test`, porta 5434.
- Quatro eventos em estados diferentes, 36 participantes, 24 pagamentos e
  três usuários fictícios, incluindo administrador e organizador.

Dashboard, Eventos, Financeiro, Usuários, Auditoria, fila de e-mails e Operação
foram conferidos pelo navegador. A inclusão manual criou uma cortesia com as
perguntas do evento. O comunicado criado pela API foi processado e recebeu
webhook assinado simulado. Nenhum erro HTTP 500 foi observado nessa verificação.

O AppModule e o frontend são os do projeto completo. Somente os gateways externos
do harness de demonstração usam simuladores: pagamentos não geram cobranças e
mensagens não saem para destinatários reais. As entregas exibidas são simuladas.

O harness exige `NODE_ENV=test` e `LIGAHUB_BROWSER_TEST=true`. A opção
`LIGAHUB_PERSIST_FIXTURE=true` preserva a base fictícia entre reinícios manuais;
quando ausente, os testes automatizados continuam limpando sua fixture ao iniciar.
As rotinas automáticas normais ficam desabilitadas; o simulador local usa os
gateways falsos e o endpoint de e-mails para processar a demonstração.

Arquivos de inicialização, seed, credenciais fictícias, PIDs, logs, verificações
e capturas desta sessão estão em `.test-temp/full-demo/`, ignorado pelo Git.
O `.env` existente e o banco habitual do projeto foram preservados. O ambiente
anterior nas portas 3110/3111 foi encerrado. Não houve deploy nem migration no
banco habitual ou em ambiente remoto.

Evite rodar a suíte automatizada contra esse mesmo banco enquanto estiver
usando a demonstração manual: as fixtures automatizadas têm limpeza própria.

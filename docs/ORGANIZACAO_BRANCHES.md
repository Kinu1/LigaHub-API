# Organização das branches

Revisão em 15/11/2026, baseada em `origin/main` no commit `8cacdb5`.

## Trabalho para revisão

| Branch | Escopo | Base |
| --- | --- | --- |
| `feat/interface-temas` | Componentes compartilhados, navegação, temas claro/escuro e detecção automática do sistema | `main` |
| `feat/agenda-digitavel` | Entrada de data pelo teclado com calendário nativo | `feat/interface-temas` |
| `feat/inscricoes-multiplas-gratuitas` | Categorias, preços, limites de vagas, inscrição gratuita, persistência e seleção pública | `feat/agenda-digitavel` |
| `docs/roteiro-publicacao` | Recupera o roteiro de publicação que estava em uma branch antiga | `main` |
| `chore/integracao-features` | Reúne as features e a documentação para um único PR destinado à `main` | `main` |

As branches de frontend são encadeadas porque agenda e inscrições usam os componentes da interface. O PR de integração permite revisar o resultado completo e os commits por assunto. Nenhuma alteração deste PR foi incorporada à `main` durante esta organização.

## Limpeza do histórico

Foram removidas 32 branches remotas antigas. Para cada uma, foi verificado que seus commits eram ancestrais da `main` ou que não existiam patches exclusivos segundo `git cherry origin/main <branch>`. Isso inclui branches com merges antigos que não eram ancestrais diretos, mas não continham alterações de código exclusivas.

Branches locais já integradas e sem worktree associado foram removidas. As branches vinculadas a worktrees foram mantidas para preservar os diretórios de trabalho. A `main` local foi atualizada por fast-forward em seu worktree limpo.

Foram preservadas as referências locais `backup/eventos-antes-atualizacao-base`, `feat/event-form-builder`, `fix/event-minimum-price` e `fix/payment-webhook-diagnostics`, pois ainda apresentam patches exclusivos. Os três últimos compartilham uma versão antiga da documentação do sandbox; a documentação atual já contém a seção correspondente. O backup de eventos contém versões anteriores de mudanças e não foi reintegrado automaticamente.

O commit exclusivo de `docs/publicacao-projeto` foi recuperado em `docs/roteiro-publicacao`. A referência original permanece vinculada ao worktree antigo.

Antes da limpeza foram salvos um bundle de todas as referências Git, um patch binário das alterações e cópias dos arquivos modificados em uma pasta local de backup. Configurações locais, artefatos de QA e a cópia independente `LigaHub-API` ficaram fora dos commits.

## Validação

- Build do backend e build do frontend concluídos.
- Backend: 322 testes passaram.
- Frontend: 96 testes passaram.
- Os testes foram atualizados para os rótulos das categorias, o identificador do tipo enviado à API e o novo calendário.
- Corrigida a preservação de eventos antigos com preço anterior ao mínimo e a restauração de foco ao cancelar a saída do editor.

Existe uma migration nova para os tipos de inscrição. A organização não executou migrations remotas, publicação, pagamentos reais ou merge na `main`. Os testes unitários e builds não substituem a validação da migration e do fluxo completo em homologação.

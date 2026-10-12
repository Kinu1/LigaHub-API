# Skills ECC aplicadas ao frontend

Fonte: [affaan-m/ECC](https://github.com/affaan-m/ECC), revisão `b92f181b3b748d1abbc2afd94af6aa7d8c8fca29`. As cinco skills foram instaladas em `C:/Users/pedro/.codex/skills` pelo instalador de skills. A instalação é local ao ambiente do desenvolvedor; não é uma dependência do aplicativo.

| Skill                                                                                                                                       | Aplicação neste projeto                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [frontend-patterns](https://github.com/affaan-m/ECC/tree/b92f181b3b748d1abbc2afd94af6aa7d8c8fca29/skills/frontend-patterns)                 | Hook de busca com pausa de 350 ms; consultas e filtros continuam na API.                                               |
| [frontend-a11y](https://github.com/affaan-m/ECC/tree/b92f181b3b748d1abbc2afd94af6aa7d8c8fca29/skills/frontend-a11y)                         | Rótulos associados aos campos, descrições e erros conectados, diálogo nomeado, foco seguro e menu com Escape.          |
| [frontend-design-direction](https://github.com/affaan-m/ECC/tree/b92f181b3b748d1abbc2afd94af6aa7d8c8fca29/skills/frontend-design-direction) | Preserva o painel branco/vermelho e seus componentes; conferência renderizada com títulos longos e estados diferentes. |
| [react-testing](https://github.com/affaan-m/ECC/tree/b92f181b3b748d1abbc2afd94af6aa7d8c8fca29/skills/react-testing)                         | Testes por nome acessível e comportamento; axe para associação de campos; foco e layout verificados em navegador real. |
| [react-performance](https://github.com/affaan-m/ECC/tree/b92f181b3b748d1abbc2afd94af6aa7d8c8fca29/skills/react-performance)                 | Reduz chamadas durante a digitação, preservando TanStack Query e carregamento das páginas sob demanda.                 |

## Contrato visual

O organizador precisa encontrar um evento e abrir sua gestão. A ação principal permanece “Criar evento”; busca, estado e resultados usam os componentes existentes. A interface mantém branco, vermelho e neutros, controles de toque de pelo menos 44 px e foco visível. Títulos longos precisam caber em 360×800 e 1440×900 sem rolagem horizontal. Nenhuma mudança transfere regras de preço, pagamento, permissão ou vagas para o frontend.

## Verificação desta alteração

- Build aprovado e 7 testes do frontend passaram.
- Respostas determinísticas interceptadas no navegador; não foram usados dados pessoais, credenciais reais, pagamento ou envio de e-mail.
- Busca digitada em sequência produziu uma única consulta com o texto completo após a pausa.
- axe no navegador não encontrou violações nas páginas de eventos dos dois tamanhos, incluindo a regra de contraste. Isso não certifica toda a aplicação.
- Menu móvel: Escape fecha e restaura o foco; menu fechado permanece `inert`.
- Diálogo: nome e descrição associados, foco inicial em “Voltar”, Escape e restauração do foco conferidos.
- Capturas de carregamento, vazio, erro, resultado, dados parciais e acesso negado em `.test-temp/ecc-qa/`. Os dados gerais do evento permanecem visíveis quando a consulta de inscrições falha.
- Registro local `.test-temp/ecc-qa/report.json` aprovado pelo checker da skill de direção visual; artefatos não são versionados.

Os testes desta alteração validam apresentação e interação. Não repetem a integração real de autenticação ou pagamentos e não representam aprovação de produção.

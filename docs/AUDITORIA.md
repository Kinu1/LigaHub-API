# Auditoria administrativa

A área `/painel/auditoria` é exclusiva de administradores. O histórico apresenta a ação em português, o responsável identificado, o registro afetado e a data com segundos no horário de Brasília. É possível filtrar por usuários, eventos, inscrições, pagamentos ou contas de recebimento; o filtro é aplicado no banco antes da paginação e da contagem.

Quando disponíveis, os detalhes mostram:

- Nome, e-mail e perfil do responsável pela ação.
- Evento, participante ou titular da conta relacionado ao registro.
- Forma e valor do pagamento, situação registrada e motivo da revisão.
- Situação anterior e posterior do acesso do usuário.
- Campos alterados no evento, prazo de reserva e quantidade de reservas expiradas.
- Identificadores da auditoria, do objeto e do provedor, em uma seção expansível.

Nomes e perfis são consultados no cadastro atual; não representam uma cópia histórica desses dados no instante da ação. A consulta não altera os registros de auditoria. Ações sem responsável identificado não são atribuídas automaticamente ao sistema ou ao participante.

Os detalhes dependem dos metadados gravados originalmente. Alterações de evento antigas registram apenas os nomes dos campos, sem valores anteriores e posteriores. Informações ausentes e ações desconhecidas são apresentadas explicitamente; não são reconstruídas por suposição. Objetos ou usuários removidos continuam identificáveis pelos IDs preservados quando disponíveis.

O endpoint `GET /admin/audit` mantém a proteção de administrador e aceita `entityType` com os valores `user`, `event`, `registration`, `payment` e `payment_account`, além de `page` e `limit`. Campos de identificação usam seleção explícita; os metadados retornados são limitados a uma lista de campos conhecidos. Senhas, tokens, dados brutos do cartão e respostas dos formulários não fazem parte dos detalhes.

Se uma atualização falhar após o carregamento, a tela preserva os dados anteriores e permite tentar novamente. A ausência de novos registros nessa situação não confirma que nenhuma ação ocorreu.

## Verificação local

Testes automatizados cobrem identificação e contexto, filtro e paginação, registros antigos, metadados não permitidos, restrição de acesso e preservação dos dados após falha de atualização. O teste de integração usa PostgreSQL e verifica o endpoint autenticado. A validação visual em desktop e celular permanece pendente: a ferramenta de controle do Chrome bloqueou a inspeção por não conseguir confirmar a URL atual.

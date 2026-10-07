# Roteiro de uso da API

Base local: `http://localhost:3000`. Corpos de requisição usam JSON. Datas usam ISO 8601 com fuso horário; preços são inteiros em centavos (`2500` = R$ 25,00). Erros retornam `statusCode`, `message` em português e, quando aplicável, `errors` com os campos inválidos.

## Autenticar e criar o responsável

Crie primeiro o administrador conforme o README. No PowerShell:

```powershell
$apiUrl = 'http://localhost:3000'
$loginBody = @{ email = 'seu-email@example.com'; password = 'sua-senha-local' } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$apiUrl/auth/login" -ContentType 'application/json' -Body $loginBody
$adminHeaders = @{ Authorization = "Bearer $($login.accessToken)" }

$organizerBody = @{
  name = 'Responsável pela liga'
  email = 'responsavel@example.com'
  password = 'escolha-outra-senha'
  role = 'organizer'
} | ConvertTo-Json
$organizer = Invoke-RestMethod -Method Post -Uri "$apiUrl/users" -Headers $adminHeaders -ContentType 'application/json' -Body $organizerBody
```

Existe somente um organizador cadastrado. Suspender sua conta não libera a criação de um segundo responsável. Administradores podem ser múltiplos. Contas não possuem cadastro público.

| Método | Rota | Permissão e comportamento |
| --- | --- | --- |
| POST | `/auth/login` | Público; retorna `accessToken`, `expiresIn` e usuário seguro |
| GET | `/auth/me` | Sessão autenticada |
| POST | `/auth/logout` | Revoga todas as sessões da conta; retorna 204 |
| POST / GET | `/users` | Administrador; criação e listagem sem hashes |
| PATCH | `/users/:id/status` | Administrador; corpo `{ "active": false }` |

O administrador não pode suspender a própria conta nem o último administrador ativo. Contas suspensas deixam de poder usar sessões anteriores.

## Criar e publicar evento

```powershell
$eventBody = @{
  ownerId = $organizer.id
  title = 'Jornada da Liga Acadêmica'
  description = 'Encontro para estudantes'
  location = 'Auditório'
  priceInCents = 2500
  capacity = 50
  startsAt = (Get-Date).AddDays(7).ToUniversalTime().ToString('o')
  endsAt = (Get-Date).AddDays(7).AddHours(4).ToUniversalTime().ToString('o')
  registrationDeadline = (Get-Date).AddDays(6).ToUniversalTime().ToString('o')
  reservationMinutes = 15
  form = @(@{ id = 'instituicao'; label = 'Instituição'; type = 'text'; required = $true })
} | ConvertTo-Json -Depth 6
$event = Invoke-RestMethod -Method Post -Uri "$apiUrl/events" -Headers $adminHeaders -ContentType 'application/json' -Body $eventBody
Invoke-RestMethod -Method Post -Uri "$apiUrl/events/$($event.id)/publish" -Headers $adminHeaders
```

Quando o próprio organizador cria o evento, pode omitir `ownerId`. O administrador informa o organizador ativo. O identificador `id` serve à gestão; `publicId` serve ao link divulgado. A conta Mercado Pago precisa estar conectada antes de aceitar inscrições.

Campos do formulário: `{ id, label, type, required, options? }`. Tipos: `text`, `number`, `select`, `checkbox`. Uma seleção exige `options` com os valores aceitos. Um checkbox obrigatório precisa ser `true`. Há limite de 25 campos. Respostas desconhecidas são rejeitadas.

| Método | Rota | Comportamento |
| --- | --- | --- |
| POST / GET | `/events` | Criar ou listar; administrador global, organizador somente próprios |
| GET / PATCH | `/events/:id` | Consultar ou editar |
| POST | `/events/:id/publish` | Publicar ou retomar evento suspenso |
| POST | `/events/:id/suspend` | Interromper novas inscrições e cobranças |
| POST | `/events/:id/close` | Encerrar; estado terminal |
| GET | `/public/events/:publicId` | Público; detalhes, formulário, vagas e disponibilidade |
| GET | `/events/:id/registrations?page=1&limit=20` | Listar participantes com autorização |
| GET | `/events/:id/history?page=1&limit=20` | Consultar auditoria daquele evento |

Após a primeira inscrição, preço, formulário e responsável ficam protegidos contra alteração. A capacidade pode aumentar; não pode cair abaixo das vagas ocupadas. Não existe uma rota pública para listar todos os eventos.

## Inscrever um participante

```powershell
$registrationBody = @{
  name = 'Participante Exemplo'
  email = 'participante@example.com'
  answers = @{ instituicao = 'Universidade Exemplo' }
} | ConvertTo-Json -Depth 5
$registration = Invoke-RestMethod -Method Post -Uri "$apiUrl/public/events/$($event.publicId)/registrations" -ContentType 'application/json' -Body $registrationBody
$participantHeaders = @{ 'x-registration-token' = $registration.manageToken }
Invoke-RestMethod -Method Get -Uri "$apiUrl/public/registrations/$($registration.id)" -Headers $participantHeaders
```

**Guarde o token como uma credencial.** Ele não é retornado novamente. E-mail não substitui esse token no acesso à inscrição. Não envie o token em logs ou URLs de query string.

| Método | Rota | Comportamento |
| --- | --- | --- |
| POST | `/public/events/:publicId/registrations` | Reserva e entrega token de acesso |
| GET | `/public/registrations/:id` | Exige token; dados e pagamentos da inscrição |
| POST | `/public/registrations/:id/renew` | Exige token; renova reserva expirada se houver vaga e nenhum pagamento pendente |
| POST | `/public/registrations/:id/cancellation` | Exige token; registra solicitação, sem estorno automático |
| PATCH | `/registrations/:id/suspension` | Responsável ou administrador; corpo `{ "suspended": true }` |

## Iniciar pagamento

Configure primeiro o Mercado Pago conforme [MERCADO_PAGO.md](MERCADO_PAGO.md). `GET /public/registrations/:id/checkout`, com o token, retorna a chave pública da conta recebedora e o valor base.

Envie uma UUID v4 nova no cabeçalho `Idempotency-Key` para cada tentativa diferente. Ao repetir a mesma tentativa após falha de rede, reutilize a mesma chave **e o mesmo corpo**.

Pix — `POST /public/registrations/:id/payments`:

```json
{ "method": "pix", "installments": 1, "cpf": "CPF_DE_TESTE_COM_11_DIGITOS" }
```

O CPF acima é um marcador: substitua pelo dado de teste válido informado pelo Mercado Pago. Não use CPF real para simular o sandbox. Resposta pode incluir `checkout.qrCode`, `qrCodeBase64` e `ticketUrl` fornecidos pelo provedor.

Cartão — mesma rota:

```json
{
  "method": "card",
  "cardToken": "TOKEN_TEMPORARIO_GERADO_PELO_MERCADO_PAGO",
  "paymentMethodId": "visa",
  "installments": 3,
  "cpf": "CPF_DE_TESTE_COM_11_DIGITOS"
}
```

`issuerId` é opcional. A API aceita 1 a 12 parcelas, mas disponibilidade e juros reais dependem do provedor. Número completo do cartão, validade e CVV nunca devem ser enviados à LigaHub API. O token será obtido pelo SDK do Mercado Pago no futuro frontend.

| Método | Rota | Comportamento |
| --- | --- | --- |
| POST | `/payments/accounts/authorize` | Autenticado; retorna URL OAuth. Administrador pode enviar `ownerId` |
| GET | `/payments/accounts/callback` | Callback do provedor; `state` e `code` |
| GET | `/payments/accounts` | Estado público da conexão; administrador pode filtrar `ownerId` |
| GET | `/public/registrations/:id/checkout` | Exige token; configuração segura |
| POST / GET | `/public/registrations/:id/payments` | Exige token; criar ou consultar tentativas |
| POST | `/payments/webhook` | Notificação com assinatura Mercado Pago |
| GET | `/payments?page=1` | Histórico; administrador global, organizador somente próprios; 50 itens/página |
| GET | `/admin/overview` | Indicadores; somente administrador |
| GET | `/admin/audit?page=1&limit=20` | Histórico global; somente administrador |

O histórico não possui rotas de edição. `payment_review` exige análise do organizador; não equivale a inscrição confirmada nem a reembolso. Estados de pagamento mantêm os códigos do provedor. Listagens de inscrições podem conter `reserved` com data já expirada: consulte `reservationExpiresAt`; a consulta individual calcula `expired` para o participante.

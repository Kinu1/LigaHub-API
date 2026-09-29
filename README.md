# LigaHub API

Backend de uma plataforma para gestão de eventos de uma liga acadêmica.

Projeto em desenvolvimento para estudo e portfólio, com aplicação
organizada por funcionalidades, com controllers, services, DTOs e entidades.

## Organização

Cada funcionalidade fica em `src/modules/`. O módulo de eventos contém:

- `events.controller.ts`: base para as rotas HTTP de eventos.
- `events.service.ts`: criação de eventos e chamada ao repositório.
- `events.module.ts`: configuração do módulo NestJS.
- `events.repository.ts`: contrato de persistência dos eventos.
- `dto/create-event.dto.ts`: formato dos dados de criação.
- `entities/academic-event.entity.ts`: entidade e validações do evento.

Os testes ficam ao lado dos arquivos que verificam. O acesso ao banco e as
rotas de eventos ainda não foram implementados. Quando houver uma implementação
de `EventsRepository`, ela deverá ser registrada junto com `EventsService` nos
providers do módulo. O DTO descreve os dados; ele ainda não valida requisições HTTP.

## Tecnologias

- Node.js
- TypeScript
- NestJS
- npm

## Funcionalidades planejadas

- Gestão de eventos.
- Formulários de inscrição personalizáveis.
- Controle de vagas e reservas temporárias.
- Pagamentos com Pix e cartão via Mercado Pago.
- Acesso administrativo e acesso do organizador.
- Solicitações de cancelamento e acompanhamento de reembolsos.

## Executar localmente

Instale as dependências:

    npm ci

Inicie a aplicação em desenvolvimento:

    npm run start:dev

A aplicação utiliza a porta 3000 por padrão.

## Verificações

Compilar:

    npm run build

Executar testes:

    npm test

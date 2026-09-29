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
- `prisma-events.repository.ts`: implementação do contrato com Prisma.
- `dto/create-event.dto.ts`: formato dos dados de criação.
- `entities/academic-event.entity.ts`: entidade e validações do evento.

O `PrismaService` fica em `src/prisma.service.ts`. O esquema e as migrations
ficam em `prisma/`. O módulo injeta `PrismaEventsRepository` onde o serviço
depende de `EventsRepository`: assim, a regra de criação não depende do Prisma.

Os testes unitários ficam ao lado dos arquivos que verificam. O teste de
persistência fica em `test/` e grava um evento no PostgreSQL. A rota HTTP de
criação ainda não foi implementada. O DTO descreve os dados; ele ainda não
valida requisições HTTP.

## Tecnologias

- Node.js
- TypeScript
- NestJS
- PostgreSQL
- Prisma
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

Copie `.env.example` para `.env` e inicie o PostgreSQL:

    docker compose up -d

Gere o cliente Prisma e aplique as migrations:

    npx prisma generate --config prisma7.config.ts
    npx prisma migrate deploy --config prisma7.config.ts

Inicie a aplicação em desenvolvimento:

    npm run start:dev

A aplicação utiliza a porta 3000 por padrão.

## Verificações

Compilar:

    npm run build

Executar testes:

    npm test

Executar os testes de integração (com o PostgreSQL iniciado):

    npm run test:e2e

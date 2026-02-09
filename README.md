# Sistema Igreja - Etapa Login/Cadastro

Implementacao inicial fullstack (backend + frontend) para login e cadastro em modo
multi-tenant.

## Stack

- Node.js + TypeScript
- Express
- PostgreSQL
- Frontend estatico servido pelo backend

## Funcionalidades entregues

- Cadastro completo em `POST /auth/register`
  - cria tenant (igreja)
  - cria usuario
  - cria vinculo `owner` no tenant
- Login completo em `POST /auth/login`
  - autenticacao por `email + password`
- CRUD da conta autenticada
  - `GET /auth/me`
  - `PUT /auth/me`
  - `DELETE /auth/me`
- Frontend funcional em `/`
  - aba de login
  - aba de cadastro
  - aba de conta autenticada com atualizar/sair/excluir

## Variaveis de ambiente

Copie `.env.example` para `.env` e ajuste:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sistema_igreja
DB_USER=postgres
DB_PASSWORD=postgres
DB_SSL=false
JWT_SECRET=troque_esta_chave_por_uma_string_com_no_minimo_32_caracteres
JWT_EXPIRES_IN=1d
```

## Migrations e schema

- `db/schema.sql` (schema completo atual)
- `db/migrations/001_enable_extensions.sql`
- `db/migrations/002_create_auth_tables.sql`

Runner de migrations:

```bash
npm run migrate
```

## Como executar

1. Instale dependencias:

```bash
npm install
```

2. Rode as migrations:

```bash
npm run migrate
```

3. Suba a aplicacao:

```bash
npm run dev
```

4. Acesse no navegador:

```txt
http://localhost:3000
```

## Scripts

- `npm run dev` - desenvolvimento
- `npm run build` - compila TypeScript para `dist`
- `npm run start` - executa versao compilada
- `npm run migrate` - aplica migrations pendentes

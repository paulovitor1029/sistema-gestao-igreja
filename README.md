# Sistema Igreja - Painel Administrativo

Implementacao fullstack (backend + frontend) para autenticacao e painel administrativo
de igrejas com foco em celulas e hierarquia de lideranca.

## Stack

- Node.js + TypeScript
- Express
- PostgreSQL
- Frontend estatico (HTML/CSS/JS) servido pelo backend

## Funcionalidades desta etapa

- Login e cadastro com sessao JWT (`/auth/register`, `/auth/login`, `/auth/me`)
- Geracao interna de slug da igreja (nao exposto no frontend)
- Perfis e escopo por papel:
  - `admin_geral`
  - `pastor_presidente`
  - `pastor_rede`
  - `lider_celula`
  - `secretaria`
- Painel administrativo em `http://localhost:3000/panel.html` com:
  - sidebar fixa e submenus
  - topbar fixa com busca global
  - dashboard com KPIs e presenca semanal
  - transferencia entre celulas (duas listas + log)
  - configuracao de nomenclaturas de modulos
  - visoes de pastor presidente/rede/lider
  - envio e log de e-mails
  - consolidacao (lista + formulario + historico)
  - botao flutuante de atalhos

## Rotas principais do painel (API)

- `GET /panel/me`
- `GET /panel/search`
- `GET /panel/dashboard`
- `GET /panel/cells`
- `GET /panel/transfers/context`
- `POST /panel/transfers`
- `GET /panel/config/module-names`
- `POST /panel/config/module-names/save-selected`
- `POST /panel/config/module-names/restore-default`
- `GET /panel/president/tree`
- `GET /panel/president/gd`
- `POST /panel/president/gd`
- `GET /panel/network/gd`
- `POST /panel/email/send`
- `GET /panel/email/logs`
- `GET /panel/leader/components`
- `POST /panel/leader/components/:participantId/promote`
- `GET /panel/consolidation`
- `GET /panel/consolidation/:id`
- `POST /panel/consolidation`
- `PUT /panel/consolidation/:id`

## Banco de dados

- `db/schema.sql` (snapshot completo)
- `db/migrations/001_enable_extensions.sql`
- `db/migrations/002_create_auth_tables.sql`
- `db/migrations/003_admin_panel_core.sql`

## Variaveis de ambiente

Copie `.env.example` para `.env`:

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

## Como executar

1. Instale dependencias:

```bash
npm install
```

2. Rode migrations:

```bash
npm run migrate
```

3. Suba a aplicacao:

```bash
npm run dev
```

4. Acesse:

- Login/cadastro: `http://localhost:3000/`
- Painel: `http://localhost:3000/panel.html`

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run migrate`

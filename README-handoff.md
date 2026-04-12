# RFID Middleware System - Technical Handoff

## Overview
This repository provides the middleware layer between RFID scanners, POS, and store operations dashboards.

Core runtime stack:
- Node.js + Express API
- PostgreSQL (primary data store)
- RabbitMQ (async queue)
- Redis (optional cache)
- Vite React dashboard (`rfid-dashboard`)

## Canonical Entrypoints
- API server: `backend/server.js`
- Worker: `backend/worker.js`
- Migrations: `scripts/run_migrations.js`

## Quick Start
1. Copy env template:
   - `copy .env.example .env`
2. Start dependencies:
   - `docker compose up -d postgres rabbitmq redis`
3. Install dependencies:
   - `npm install`
   - `cd rfid-dashboard && npm install`
4. Run DB migrations:
   - `npm run migrate`
5. Start API:
   - `npm run start`
6. Start worker (separate shell):
   - `npm run worker`
7. Start dashboard (separate shell):
   - `npm run dashboard`

## Common Commands
- API dev mode: `npm run start:dev`
- Dashboard build: `cd rfid-dashboard && npm run build`
- Dashboard lint: `cd rfid-dashboard && npm run lint`
- Tests: `npm test`
- On-prem install (Windows): `npm run onprem:install`
- On-prem update (Windows): `npm run onprem:update`
- On-prem backup (Windows): `npm run onprem:backup`
- Bootstrap master admin on blank DB: `npm run bootstrap:master -- --email admin@zyro.local --password "CHANGE_ME_STRONG"`
- SaaS stack up (Docker): `npm run saas:up`
- SaaS stack down (Docker): `npm run saas:down`
- SaaS logs (Docker): `npm run saas:logs`

## Database Notes
- PostgreSQL is the source of truth.
- Migration runner applies:
  - `migrations/000_create_tables_postgres.sql`
  - `migrations/010_postgres_feature_tables.sql`
  - `migrations/20251111_add_anomaly_rules.sql`
- Migration tracking table: `schema_migrations`

## Environment Variables (minimum)
- `PORT`
- `FRONTEND_ORIGIN`
- `DATABASE_URL` (or `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`)
- `JWT_SECRET`
- `RABBITMQ_URL`
- `SCAN_API_KEY`
- `POS_API_KEY`
- `DEVICE_API_KEY`

## Operational Notes
- API health endpoint: `GET /api/health`
- SSE stream: `GET /api/v1/events/stream`
- Worker consumes from queue: `scan_jobs`
- If Redis is unavailable, set `DISABLE_REDIS=1`
- If RabbitMQ is unavailable for local API-only testing, set `DISABLE_RABBIT=1`
- On-prem rollout guide: `docs/onprem-first-customer-playbook.md`
- SaaS rollout guide: `docs/saas-launch-playbook.md`

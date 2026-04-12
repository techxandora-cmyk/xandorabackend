# SaaS Launch Playbook (Option 1)

Use this path when Zyro is hosted centrally and many customers are served from one platform.

## 1. Infrastructure You Need

- One Linux VPS/cloud server (Ubuntu 22.04+ recommended).
- One domain (example: `app.yourdomain.com`) pointed to server public IP.
- Open inbound ports: `80`, `443`.
- Docker + Docker Compose plugin installed.

## 2. Prepare Config

From repo root:

```bash
cp deploy/saas/.env.saas.example deploy/saas/.env.saas
```

Edit `deploy/saas/.env.saas`:

- `DOMAIN`
- `ACME_EMAIL`
- `FRONTEND_ORIGIN` (must match domain with `https://`)
- `JWT_SECRET`, `SCAN_API_KEY`, `POS_API_KEY`, `DEVICE_API_KEY`
- `PGPASSWORD`
- `DATABASE_URL`

## 3. First Launch

```bash
docker compose -f deploy/saas/docker-compose.saas.yml --env-file deploy/saas/.env.saas up -d --build
```

Check status:

```bash
docker compose -f deploy/saas/docker-compose.saas.yml ps
docker compose -f deploy/saas/docker-compose.saas.yml logs -f api
```

Health:

```bash
curl -i http://127.0.0.1:3000/api/health
```

## 4. First Admin Account

Important: migrations do not auto-seed a `MASTER_ADMIN` account on a blank DB.

Choose one:

1. Restore your prepared baseline DB backup (recommended).
2. Bootstrap from script:

```bash
npm run bootstrap:master -- --email admin@zyro.local --password "CHANGE_ME_STRONG" --company Zyro --store STORE_001
```

## 5. Customer Onboarding Flow (SaaS)

From master admin UI:

1. Create tenant/company admin.
2. Create customer stores.
3. Create role-scoped users (`ADMIN`, `STORE_MANAGER`, `STORE_STAFF`, `HANDHELD_USER`).
4. Map reader/device IDs to the correct store.
5. Configure billing profile and due alerts.

## 6. Reader Connectivity (Customer Sites)

At each customer site, run reader bridge processes that post scans to your SaaS API endpoint:

- `SCAN_API_KEY` must match platform key.
- Use unique `DEVICE_ID` per reader.
- Use correct `STORE_ID` for tenant store.

Use:

- `docs/multi-reader-deployment.md`
- `deploy/systemd/reader.env.example`

## 7. Routine Operations

Update:

```bash
docker compose -f deploy/saas/docker-compose.saas.yml --env-file deploy/saas/.env.saas up -d --build
```

Backup DB (inside VPS):

```bash
docker exec -t $(docker ps --filter name=postgres --format "{{.ID}}" | head -n 1) \
  pg_dump -U postgres -d rfid > /opt/zyro/backups/rfid_$(date +%Y%m%d_%H%M%S).sql
```

## 8. Go-Live Gate

Before first paid customer, confirm:

- HTTPS valid on domain.
- API health stable.
- Master admin can switch and view tenant data.
- Customer admin scopes are correct.
- Handheld/store scope rules are enforced.
- Backup + restore tested at least once.

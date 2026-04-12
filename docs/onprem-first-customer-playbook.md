# On-Prem First Customer Playbook (No Domain)

Use this when you want to deploy Zyro for your first customer at their site, without cloud hosting.

## 1. Customer Machine Requirements

- Windows 10/11 Pro (or Windows Server) with stable power.
- Node.js 20+ installed.
- Docker Desktop installed and running.
- At least 8 GB RAM, SSD preferred.
- Reader network reachable from this machine.

## 2. One-Time Install at Customer Site

From repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-onprem.ps1
```

What this does:

- Creates `.env` from `.env.example` if missing.
- Installs backend + dashboard dependencies.
- Starts Postgres/RabbitMQ/Redis with Docker Compose.
- Runs migrations.
- Builds dashboard.
- Starts API, worker, dashboard with PM2 (`ecosystem.onprem.config.cjs`).

## 3. Configure Production Secrets

Edit `.env` and change these before handing over:

- `JWT_SECRET`
- `SCAN_API_KEY`
- `POS_API_KEY`
- `DEVICE_API_KEY`
- `DATABASE_URL` (if not default local DB)
- `FRONTEND_ORIGIN` (keep `http://localhost:5173` for local-only setup)

After editing:

```powershell
npx pm2 restart ecosystem.onprem.config.cjs --update-env
```

## 4. Day-to-Day Operations

PM2 status:

```powershell
npx pm2 status
```

View logs:

```powershell
npx pm2 logs zyro-api --lines 100 --nostream
npx pm2 logs zyro-worker --lines 100 --nostream
npx pm2 logs zyro-dashboard --lines 100 --nostream
```

Health check:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/health
```

## 5. Backup Routine

Run manual backup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup-onprem.ps1
```

Notes:

- If `pg_dump` exists, a `.dump` backup is created.
- A JSON snapshot backup is always created as fallback.
- Keep at least one off-machine copy (external drive or secure cloud folder).

## 6. Update Routine (Remote or On-Site)

After new code is in place:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\update-onprem.ps1
```

If using git on customer machine:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\update-onprem.ps1 -WithGitPull
```

## 7. Remote Support Setup (Recommended)

To avoid on-site visits for every update:

- Install a secure remote access solution (for example Tailscale).
- Restrict admin access to your support account only.
- Use update script remotely and verify API health after each change.

## 8. Handover Checklist

- Master admin login verified.
- Customer admin login verified.
- Store list and role permissions verified.
- Reader ingestion verified in `Devices` and `Scans`.
- Backup script tested once.
- Update script tested once.

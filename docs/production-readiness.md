# Xandora Production Readiness

## What is now in place

- Structured API logging with request IDs
- API security headers
- Login rate limiting and admin write throttling
- Health endpoints:
  - `/api/health/live`
  - `/api/health/ready`
  - `/api/health`
- CI workflow for backend tests, frontend lint/build, and browser E2E
- Retention job with dry-run/apply support
- Browser test account bootstrap script

## Before deployment

1. Copy `deploy/saas/.env.saas.example` into a real deployment env file.
2. Replace all placeholder secrets.
3. Set `TRUST_PROXY=true` behind your reverse proxy.
4. Decide whether Redis and RabbitMQ are required in your environment.
5. Set retention windows to match your compliance policy.

## Health checks

- Liveness:
  - `GET /api/health/live`
- Readiness:
  - `GET /api/health/ready`

Readiness checks:

- PostgreSQL connectivity
- Required schema tables
- Applied migrations
- Redis availability when enabled
- RabbitMQ availability when enabled

## Retention

Dry run:

```powershell
npm run retention:dry-run
```

Apply once:

```powershell
npm run retention:apply
```

Scheduled retention is controlled by:

- `DATA_RETENTION_ENABLED`
- `DATA_RETENTION_CRON`
- `SCAN_ITEM_RETENTION_DAYS`
- `SCAN_BATCH_RETENTION_DAYS`
- `COMPLETED_SESSION_RETENTION_DAYS`
- `POS_TRANSACTION_RETENTION_DAYS`
- `RESOLVED_ALERT_RETENTION_DAYS`
- `ACTIVITY_AUDIT_RETENTION_DAYS`
- `RECENT_EVENTS_RETENTION_DAYS`

## Browser E2E

Bootstrap local automation accounts:

```powershell
npm run bootstrap:e2e
```

Run browser tests:

```powershell
cd rfid-dashboard
npm run test:e2e
```

## Recommended ops baseline

- Daily database backups
- Restore drill at least once before production
- Monitoring on `/api/health/ready`
- Log shipping from API and worker
- TLS termination in front of the API/dashboard
- Staging verification before every production rollout

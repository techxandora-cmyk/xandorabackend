# SaaS Reader Agent Deployment

Use this model for customer sites where Xandora stays hosted in your cloud, but RFID readers are inside the customer's LAN.

## Architecture

```text
RFID readers -> customer server -> Xandora cloud backend -> web app / retail console
```

The customer server runs only the reader agent. POS machines and office computers only open the hosted web app.

## Customer Server Requirements

- Windows 10/11 Pro, Windows Server, or Linux
- Always on, stable power, internet access
- LAN access to every RFID reader
- Node.js 20+
- PM2 installed or available through `npx`

## Backend Setup

1. Provision the customer tenant and store.
2. Create or rotate a store token.
3. Register every reader under that customer/store.

Example reader layout:

```text
Store: COLOMBO_01
Reader: POS Reader 01   device_id=POS_01    reader_ip=192.168.1.21   zone_id=pos_1
Reader: POS Reader 02   device_id=POS_02    reader_ip=192.168.1.22   zone_id=pos_2
Reader: POS Reader 03   device_id=POS_03    reader_ip=192.168.1.23   zone_id=pos_3
Reader: Exit Reader     device_id=EXIT_01   reader_ip=192.168.1.30   zone_id=exit_gate
```

The store token controls which readers the agent can fetch and use.

## Customer Server Install

Copy the packaged reader-agent files to the customer server. Do not copy the full backend/dashboard source when deploying the SaaS model.

Set the customer-specific environment:

```powershell
$env:XANDORA_BASE_URL = "https://your-backend.example.com"
$env:STORE_TOKEN = "st_customer_store_token"
```

Start the background service:

```powershell
npx pm2 start deploy/reader-agent/ecosystem.reader-agent.config.cjs --update-env
npx pm2 save
```

Register PM2 startup so the agent returns after reboot:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-reader-pm2-startup.ps1
```

## Day-to-Day Behavior

After setup:

- the customer server starts the reader agent automatically
- the agent fetches its active readers from `/api/v1/bridge/config`
- one child bridge runs per registered reader
- scans are accepted only for that store and registered reader
- POS and retail console users log into the hosted web app

## Security Rules

- Store tokens cannot choose another `store_id`; the backend forces the store from the token.
- Company tokens must send an active store belonging to that company.
- Reader scan/event writes require the `device_id` to be registered for that company/store.
- Customer POS machines do not need middleware or source code.

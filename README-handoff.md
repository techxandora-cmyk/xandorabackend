# 🧠 RFID Middleware System — Technical Handoff

## 📋 Overview
This system provides a **complete middleware layer** between multiple **RFID scanners**, **POS terminals**, and **security workflows**.  
It handles:
- Tag scans from handheld scanners  
- POS confirmations and refunds  
- Event logging & auditing  
- Automatic database and queue synchronization  

**Core Tech Stack**
- Node.js (Express) — API
- RabbitMQ — Queue layer
- MySQL (Dockerized) — Persistent DB
- Redis (optional) — Cache layer
- PowerShell — Migration runner for Windows

---

## ⚙️ System Architecture

```text
[RFID Scanners] ---> [Middleware API] ---> [RabbitMQ Queue] ---> [Worker] ---> [MySQL Database]
                                |                                  |
                           (Device Auth)                      (POS, Tag, Events)
rfid-middleware/
│
├── src/
│   ├── api/routes/
│   │   ├── pos.js              # POS reserve / confirm / refund
│   │   ├── scan.js             # RFID scan batches
│   │   ├── security.js         # Security scanning
│   │   ├── devices.js          # Device registry
│   │   └── health.js           # Health endpoint
│   ├── middleware/
│   │   └── deviceAuth.js       # Bearer authentication middleware
│   ├── services/
│   │   ├── db.js               # MySQL connection
│   │   ├── cache.js            # Redis wrapper
│   │   ├── rabbit.js           # RabbitMQ setup
│   │   └── logger.js           # Logging utility
│   ├── app.js                  # Route mounting
│   └── server.js               # Startup entrypoint
│
├── worker.js                   # Background worker process
├── migrations/                 # Database migrations
│   ├── 001_init.sql
│   ├── 002_create_pos_and_tag_events.sql
│
├── scripts/
│   └── run_migrations.ps1      # PowerShell migration runner
│
├── .env                        # Environment configuration
└── README.md                   # This document


🚀 Setup Guide
1️⃣ Prerequisites

Docker Desktop running

Node.js 18+

.env file copied from .env.example

2️⃣ Start Databases
docker run -d --name mysql8 -e MYSQL_ROOT_PASSWORD=rootpass -p 3306:3306 mysql:8.0
docker run -d --name rabbit -p 5672:5672 -p 15672:15672 rabbitmq:3-management

3️⃣ Install Dependencies
npm install

4️⃣ Run Migrations
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run_migrations.ps1

5️⃣ Start API Server
node src/server.js

6️⃣ Start Worker
node worker.js


✅ You should see:

API listening on 3000
RabbitMQ connected (queue: scan_jobs)
Worker connected to RabbitMQ.

🧩 Testing Endpoints
POS Confirm
$body = @{
  pos_txn_id="POS-001";
  store_id="STORE-1";
  user="cashier-1";
  items=@(@{epc="EPC-TEST-001"; price=49.99}, @{epc="EPC-TEST-002"; price=50.00});
  total=99.99
}
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/pos/confirm" -Method POST -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 6)


✅ Expected Response:

{
  "confirmed": 2,
  "pos_txn_id": "POS-001"
}

Refund
$body = @{
  pos_txn_id="POS-001";
  store_id="STORE-1";
  user="cashier-1";
  items=@(@{epc="EPC-TEST-001"}, @{epc="EPC-TEST-002"});
}
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/pos/refund" -Method POST -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 6)

Check DB Results
$CID = docker ps --filter "ancestor=mysql:8.0" -q
docker exec -i $CID mysql -uroot -prootpass -D middleware_db -e "SELECT * FROM pos_transactions;"
docker exec -i $CID mysql -uroot -prootpass -D middleware_db -e "SELECT * FROM tag_events ORDER BY id DESC LIMIT 5;"

🧩 Maintenance
Task	Command
Apply new migration	powershell -File .\scripts\run_migrations.ps1
Restart API	node src/server.js
Restart Worker	node worker.js
View logs	Get-Content .\server_start_log.txt -Tail 100

| Layer                   | Responsibility                      | Notes                            |
| ----------------------- | ----------------------------------- | -------------------------------- |
| **API (Express)**       | Handles RFID and POS requests       | JSON REST endpoints              |
| **Worker (RabbitMQ)**   | Processes queue jobs asynchronously | Ensures non-blocking performance |
| **MySQL**               | Core data store                     | All tag, POS, and event data     |
| **Redis**               | Optional caching                    | Speed boost for frequent reads   |
| **Dockerized Services** | Container orchestration             | MySQL + RabbitMQ                 |

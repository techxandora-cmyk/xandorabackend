## 🧭 Technical Handoff – RFID Middleware & Dashboard

### 📦 Project Summary
This middleware layer acts as the central bridge between **RFID scanners**, the **inventory database**, and the **POS system**.  
It manages tag ingestion, validation, grouping, and synchronization with the existing MySQL infrastructure, while exposing REST APIs and live data endpoints for the dashboard.

The project is split into **two main components**:
- **Backend (Node.js Middleware):** Handles scanning, processing, queuing, and database synchronization.
- **Frontend (React Dashboard):** Displays real-time system and inventory data.

---

### ⚙️ Current Backend Architecture

#### 1. Core Services
| Service | Tech | Description |
|----------|------|--------------|
| **Middleware API** | Node.js + Express | REST interface for scanners and POS. Endpoints for health, scanning, and transactions. |
| **Database** | MySQL 8 | Stores tags, scans, POS transactions, and tag event history. |
| **Cache** | Redis 7 | Optional caching layer (used for session/state acceleration). |
| **Queue Broker** | RabbitMQ 3 | Message queue for decoupling scanner ingestion from backend processing. |
| **Worker Service** | Node.js (separate process) | Consumes RabbitMQ jobs, validates EPCs, writes to MySQL, and logs tag events. |

#### 2. Data Flow
1. **Warehouse Scanning**
   - RFID scanners POST to `/api/v1/scan/batch`.
   - Middleware validates EPCs, records them in `scans` table, and pushes a `scan_job` to RabbitMQ.
2. **Worker Processing**
   - Worker consumes from `scan_jobs`, ensures unique tag creation in `tags` table, logs events, and updates timestamps.
3. **POS Integration**
   - POS system interacts via `/api/v1/pos/*` endpoints to reserve, confirm, or refund items.
   - Tag status changes (e.g. SOLD, RETURNED) are reflected in the MySQL `tags` table.
4. **Security Scanner Checkout**
   - When billed and scanned out, the system updates tag sale status, ensuring traceability and theft prevention.

---

### 🧩 Middleware Endpoints

| Endpoint | Method | Description |
|-----------|---------|-------------|
| `/health/live` | GET | Checks if server is up. |
| `/health/ready` | GET | Verifies DB and RabbitMQ connections. |
| `/api/v1/scan/batch` | POST | Accepts RFID scan batches. |
| `/api/v1/pos/reserve` | POST | POS reserves items. |
| `/api/v1/pos/confirm` | POST | Confirms sales. |
| `/api/v1/pos/refund` | POST | Marks items as returned. |

---

### 🛠 Current Project Status

| Module | Status | Notes |
|---------|---------|-------|
| **Middleware Core (Express API)** | ✅ Working | Fully functional and running on `localhost:3000`. |
| **RabbitMQ Integration** | ✅ Working | Queues `scan_jobs`; retry logic enabled. |
| **MySQL Connection** | ✅ Working | Migrations applied; schema aligned with tags, scans, events, and POS tables. |
| **Worker (scanWorker.js)** | ⚙️ Minor Fix Needed | SQL insert column mismatch for tags; pending fix. |
| **POS Flow** | ⚙️ In Progress | Endpoint structure done; needs linking to POS data model. |
| **Dashboard (React + Tailwind)** | 🚧 Scaffolded | UI skeleton running; needs component buildout + API wiring. |

---

### 🧱 Environment & Setup

#### Dependencies
- Node.js ≥ 18
- Docker Desktop
- MySQL 8.0 container
- RabbitMQ 3 (management enabled)
- Redis 7 (optional)
- npm or yarn

#### Quick Start
```bash
# Start Docker containers
docker-compose up -d

# Install dependencies
npm install

# Run middleware API
node src/server.js

# In another terminal, start worker
node src/workers/scanWorker.js

Verify System Health

Invoke-RestMethod -Uri "http://localhost:3000/health/live" -Method GET
Invoke-RestMethod -Uri "http://localhost:3000/health/ready" -Method GET






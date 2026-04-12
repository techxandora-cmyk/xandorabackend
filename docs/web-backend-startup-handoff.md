# Web and Backend Startup Handoff

Prepared on April 6, 2026 for the Firebase web hosting handoff planned for April 7, 2026.

Important note: Firebase Hosting is suitable for the web dashboard only. The Node.js backend must run on a separate server or VM.

## Backend Startup

1. Open a terminal in the project root:
   `c:\Users\xbox_\rfid-middleware`
2. Copy the environment file:
   `copy .env.example .env`
3. Update `FRONTEND_ORIGIN` in `.env` to the real Firebase site URL, for example:
   `https://your-site.web.app`
4. Install backend dependencies:
   `npm install`
5. Start required services:
   `docker compose up -d postgres rabbitmq redis`
6. Run database migrations:
   `npm run migrate`
7. Start the API server:
   `npm run start`
8. Start the worker in a second terminal if queue features are needed:
   `npm run worker`
9. Backend health check:
   `http://YOUR_BACKEND_SERVER:3000/api/health`

## Frontend Local Startup

1. Open a second terminal.
2. Change directory:
   `cd rfid-dashboard`
3. Install frontend dependencies:
   `npm install`
4. Start the local frontend server:
   `npm run dev`
5. Local dev URL:
   `http://localhost:5173`

## Firebase Hosting

The repo is now prepared with a root `firebase.json` that serves `rfid-dashboard/dist` and rewrites all routes to `index.html` for the Vite single-page app.

1. Install Firebase CLI if needed:
   `npm install -g firebase-tools`
2. Sign in:
   `firebase login`
3. Link the correct Firebase project:
   `firebase use --add`
4. In `rfid-dashboard`, create `.env.production` from `.env.production.example`
5. Set the live backend URL in `.env.production`:
   `VITE_API_BASE_URL=https://YOUR_BACKEND_DOMAIN/api/v1`
6. Build the dashboard:
   `cd rfid-dashboard`
   `npm install`
   `npm run build`
7. From the repo root, deploy hosting:
   `firebase deploy --only hosting`

## Quick Checklist

- Backend server is running on port `3000`.
- `FRONTEND_ORIGIN` matches the Firebase domain exactly.
- `VITE_API_BASE_URL` points to the live backend URL ending in `/api/v1`.
- Firebase Hosting serves files from `rfid-dashboard/dist`.

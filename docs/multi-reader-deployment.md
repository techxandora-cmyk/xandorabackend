# Multi-Reader Deployment (LAN)

This project supports multiple readers by running one bridge process per reader.

## 1. Network Layout

- Connect all readers to the store LAN switch.
- Give each reader a static IP.
- Keep readers and Xandora backend reachable on the same routed network.
- Required ports:
  - Reader LLRP: `5084/tcp` from bridge host to reader.
  - Xandora API: `3000/tcp` from bridge process to backend.

## 2. Bridge Configuration

`xandora-llrp-bridge.js` is now env-driven.

Required per process:

- `READER_HOST` (reader IP)
- `DEVICE_ID` (unique per physical reader)
- `STORE_ID`
- `SCAN_API_KEY` (must match backend `SCAN_API_KEY`)

Useful optional values:

- `READER_PORT` (default `5084`)
- `XANDORA_BASE_URL` (for hosted backend, for example `https://xandorabackend-44dt.onrender.com`)
- `XANDORA_HOST` (default `127.0.0.1`)
- `XANDORA_PORT` (default `3000`)
- `ZONE_ID` (pos, exit, entrance, changing_room, etc.)

If `XANDORA_BASE_URL` is set, the bridge posts directly to that backend and ignores `XANDORA_HOST` / `XANDORA_PORT`.

## 3. Run 4 Readers with PM2

Use `ecosystem.readers.config.cjs` as the base file.

1. Edit each app entry:
   - `READER_HOST`
   - `DEVICE_ID`
   - `STORE_ID`
   - `ZONE_ID`
   - `SCAN_API_KEY`
2. Start:

```bash
pm2 start ecosystem.readers.config.cjs
pm2 status
pm2 logs
```

3. Persist across reboot:

```bash
pm2 save
pm2 startup
```

## 4. Run 4 Readers with systemd

Template unit: `deploy/systemd/xandora-reader@.service`  
Env template: `deploy/systemd/reader.env.example`

1. Install unit:

```bash
sudo cp deploy/systemd/xandora-reader@.service /etc/systemd/system/
sudo systemctl daemon-reload
```

2. Create env files (one per reader):

```bash
sudo mkdir -p /etc/xandora-reader
sudo cp deploy/systemd/reader.env.example /etc/xandora-reader/store001-pos.env
sudo cp deploy/systemd/reader.env.example /etc/xandora-reader/store001-exit.env
sudo cp deploy/systemd/reader.env.example /etc/xandora-reader/store001-fitting.env
sudo cp deploy/systemd/reader.env.example /etc/xandora-reader/store001-entrance.env
```

3. Edit each env file for correct `READER_HOST`, `DEVICE_ID`, `STORE_ID`, `ZONE_ID`, `SCAN_API_KEY`.

4. Enable/start:

```bash
sudo systemctl enable --now xandora-reader@store001-pos
sudo systemctl enable --now xandora-reader@store001-exit
sudo systemctl enable --now xandora-reader@store001-fitting
sudo systemctl enable --now xandora-reader@store001-entrance
```

5. Check logs:

```bash
journalctl -u xandora-reader@store001-pos -f
```

## 5. Device IDs and Dashboard

- Keep `DEVICE_ID` stable for each reader.
- Do not reuse one `DEVICE_ID` across multiple readers.
- Reader rows auto-upsert when scans arrive; then configure profile/antennas in the Devices UI.

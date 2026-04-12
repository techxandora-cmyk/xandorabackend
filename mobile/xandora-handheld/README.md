# Xandora Handheld

This is the imported React Native handheld app for Xandora. It now targets the same backend contract as the main platform instead of the original mock service layer.

## What Is Wired

- Real login against `POST /api/v1/auth/login`
- JWT decoding and handheld session persistence
- Current store scope from token `store_ids` / `default_store_id`
- Barcode verification from the live catalog
- RFID audit lookup from the live catalog
- Store transfer flow against the Xandora backend
- Notifications backed by live store alerts

## Current Limits

- Scanner connectivity is still simulated in-app.
  The current project expects keyboard-wedge style scans through the hidden text inputs.
- A vendor SDK bridge is still needed for true handheld Bluetooth / embedded RFID control.
- Android builds on this machine currently fail until Java is configured.

## API Base URL

The app defaults to:

```txt
http://10.0.2.2:3000/api/v1
```

That is correct for an Android emulator talking to a backend running on the same Windows machine.

If you need a different backend host, set an override in AsyncStorage under:

```txt
xandoraApiBaseUrl
```

The app will normalize it to `/api/v1`.

## Local Run

From this folder:

```sh
npm install
npm run android:dev
```

That single command:

```sh
npm start Metro if port 8081 is not already running
adb reverse tcp:8081 tcp:8081
react-native run-android --active-arch-only
```

It also pins the Android React Native debug host to `localhost:8081` so the emulator can load the bundle reliably.

## Android Toolchain Note

This environment does not currently expose Java:

- `JAVA_HOME` is not set
- `java` is not on `PATH`

Also, the copied project's old `android/local.properties` points to a different machine path:

```txt
C:\Users\ACER\AppData\Local\Android\Sdk
```

Before building locally, update Android SDK/JDK config for this machine.

## Validation Notes

- `npx tsc --noEmit` passed on the original coworker project
- Lint errors were removed from the imported copy's core flow files
- The original Jest failure came from navigation parsing; the imported test now mocks the navigator

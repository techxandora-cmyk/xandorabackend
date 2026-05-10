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

- Zebra DataWedge and Zebra RFID native modules are wired for Android, but the final validation
  step still needs a real handheld device and reader pairing test.
- Release builds from this Windows checkout currently work most reliably as `arm64-v8a` APKs.

## API Base URL

For installable builds, the app now defaults to:

```txt
https://xandorabackend-44dt.onrender.com/api/v1
```

That matches the hosted Render backend and is the right default for a real handheld device.

During local React Native development, the app still falls back to:

```txt
http://10.0.2.2:3000/api/v1
```

for the Android emulator talking to a backend running on the same Windows machine.

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

## Debug Vs Release

- `debug` builds require Metro and will show the red "Unable to load script" screen if the phone is not connected to the bundler.
- `release` builds are self-contained and should open without Metro.
- This project now installs the debug app as a separate package with the label `Xandora Debug` so it is easier to tell them apart on the device.

For the standalone app on a phone:

```sh
npm run android:release:install
```

To rebuild the standalone APK first and then install it:

```sh
npm run android:release:rebuild
```

To debug over USB with Metro:

```sh
npm run android:dev
```

That will install and launch `Xandora Debug`, keep the Metro tunnel on `localhost:8081`, and leave the standalone `Xandora` release app untouched.

The standalone APK is written to:

```txt
android/app/build/outputs/apk/release/app-release.apk
```

## Android Toolchain Note

This machine can build the app by using Android Studio's bundled JDK together with the local SDK
configured in `android/local.properties`.

## Validation Notes

- `npx tsc --noEmit` passed on the original coworker project
- Lint errors were removed from the imported copy's core flow files
- The original Jest failure came from navigation parsing; the imported test now mocks the navigator

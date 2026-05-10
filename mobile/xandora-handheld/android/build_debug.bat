@echo off
rem Builds and installs the debug APK.
rem Uses subst X: to shorten paths and avoid the 260-char Windows path limit.
subst X: /D >nul 2>&1
subst X: C:\Users\xbox_\rfid-middleware\mobile\xandora-handheld
cd /d X:\android
call gradlew.bat app:installDebug -PreactNativeDevServerPort=8081 --no-daemon %*

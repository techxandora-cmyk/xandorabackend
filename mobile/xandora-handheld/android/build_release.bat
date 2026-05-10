@echo off
rem Builds the release APK.
rem
rem Windows path length limit (260 chars) causes ninja to fail when node_modules
rem paths are embedded in .o filenames using the full C:\Users\... prefix.
rem Mapping X: to the handheld root shortens those paths to X:\node_modules\...
rem which keeps the total .o path under 260 chars.
subst X: /D >nul 2>&1
subst X: C:\Users\xbox_\rfid-middleware\mobile\xandora-handheld
cd /d X:\android
call gradlew.bat assembleRelease --no-daemon %*

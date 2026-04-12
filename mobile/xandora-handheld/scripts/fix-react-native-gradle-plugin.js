"use strict";

const fs = require("fs");
const path = require("path");

const pluginSettingsPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "@react-native",
  "gradle-plugin",
  "settings.gradle.kts",
);

const target = 'version("0.5.0")';
const replacement = 'version("1.0.0")';

if (!fs.existsSync(pluginSettingsPath)) {
  console.log("[postinstall] React Native Gradle plugin settings file not found, skipping.");
  process.exit(0);
}

const current = fs.readFileSync(pluginSettingsPath, "utf8");

if (current.includes(replacement)) {
  console.log("[postinstall] React Native Gradle plugin already patched for Gradle 9.");
  process.exit(0);
}

if (!current.includes(target)) {
  console.log("[postinstall] Expected foojay resolver version not found, skipping.");
  process.exit(0);
}

fs.writeFileSync(pluginSettingsPath, current.replace(target, replacement), "utf8");
console.log("[postinstall] Patched React Native Gradle plugin foojay resolver to 1.0.0.");

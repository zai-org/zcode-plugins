#!/usr/bin/env node
/**
 * Launcher for the vendored etsy-mcp server (github.com/aserper/etsy-mcp, MIT),
 * bundled with esbuild into a dependency-free server-bundle.mjs.
 *
 * Reads Etsy credentials from (first match wins):
 *   1. Real environment variables ETSY_API_KEY / ETSY_SHARED_SECRET
 *   2. ~/.etsy-mcp/config.json  ->  { "apiKey": "...", "sharedSecret": "...", "callbackPort": 3737 }
 *
 * Then spawns vendor/etsy-mcp/dist/index.js with those variables injected.
 * OAuth tokens are stored by the server itself at ~/.etsy-mcp/tokens.json.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const pluginRoot = join(fileURLToPath(import.meta.url), "..", "..");
const serverEntry = join(pluginRoot, "vendor", "etsy-mcp", "server-bundle.mjs");
const userConfigPath = join(homedir(), ".etsy-mcp", "config.json");

const env = { ...process.env };

if (!env.ETSY_API_KEY || !env.ETSY_SHARED_SECRET) {
  if (existsSync(userConfigPath)) {
    try {
      const cfg = JSON.parse(readFileSync(userConfigPath, "utf8"));
      if (cfg.apiKey && !env.ETSY_API_KEY) env.ETSY_API_KEY = cfg.apiKey;
      if (cfg.sharedSecret && !env.ETSY_SHARED_SECRET) env.ETSY_SHARED_SECRET = cfg.sharedSecret;
      if (cfg.callbackPort) env.ETSY_CALLBACK_PORT = String(cfg.callbackPort);
    } catch (err) {
      console.error(`[etsy-manager] Could not parse ${userConfigPath}: ${err.message}`);
      process.exit(1);
    }
  }
}

if (!env.ETSY_API_KEY || !env.ETSY_SHARED_SECRET) {
  console.error(
    [
      "[etsy-manager] Etsy credentials not found.",
      "",
      "Etsy urunlerinizi yonetebilmek icin once su adimlari yapin / To configure:",
      "",
      `1. Create the file: ${userConfigPath}`,
      '2. Content:  { "apiKey": "ETSY_KEYSTRING", "sharedSecret": "ETSY_SHARED_SECRET" }',
      "3. Get both values from your app at https://www.etsy.com/developers/apps",
      "   (register a new app if needed; callback URL: http://localhost:3737/callback)",
      "4. Restart this MCP server (reload the plugin / restart ZCode).",
      "",
      "Then run the 'authenticate' tool once to complete Etsy OAuth in a browser.",
    ].join("\n")
  );
  process.exit(1);
}

if (!existsSync(serverEntry)) {
  console.error(`[etsy-manager] Vendored server not found: ${serverEntry}`);
  process.exit(1);
}

const child = spawn(process.execPath, [serverEntry], {
  env,
  stdio: ["inherit", "inherit", "inherit"],
  windowsHide: true,
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    child.kill(sig);
  });
}
child.on("exit", (code) => process.exit(code ?? 1));

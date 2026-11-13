#!/usr/bin/env node
// Entry point: decrypt DPAPI-protected credentials into the environment, then run the
// MCP server in-process. MCP stdio traffic never passes through PowerShell; only two
// short ciphertexts do, at startup. Existing real environment variables win, so the
// secrets file stays optional.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const secretPath = join(homedir(), ".zcode", "secrets", "cloudflare-clef.json");

const psQuote = (value) => "'" + String(value).replace(/'/g, "''") + "'";

function haveEnv(name) {
  return typeof process.env[name] === "string" && process.env[name].length > 0;
}

function decryptStored(protectedString) {
  // ConvertTo-SecureString without -Key uses DPAPI CurrentUser scope: the ciphertext
  // only decrypts for the Windows user that ran store-secret.ps1 on this machine.
  const script = [
    "$ErrorActionPreference='Stop'",
    "function U($s){$p=ConvertTo-SecureString -String $s;" +
      "$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($p);" +
      "try{[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)}" +
      "finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}}",
    "U " + psQuote(protectedString),
  ].join("; ");
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
  const value = (result.stdout ?? "").trim();
  return result.status === 0 && value ? value : null;
}

function loadStoredCredentials() {
  if (!haveEnv("CLOUDFLARE_ACCOUNT_ID") || !haveEnv("CLOUDFLARE_API_TOKEN")) {
    if (existsSync(secretPath)) {
      let stored;
      try { stored = JSON.parse(readFileSync(secretPath, "utf8")); } catch { stored = null; }
      if (stored && typeof stored.accountId === "string" && typeof stored.apiToken === "string") {
        const accountId = decryptStored(stored.accountId);
        const apiToken = decryptStored(stored.apiToken);
        if (accountId && apiToken) {
          process.env.CLOUDFLARE_ACCOUNT_ID = accountId;
          process.env.CLOUDFLARE_API_TOKEN = apiToken;
        }
      }
    }
  }
}

loadStoredCredentials();
await import("./index.mjs");

// Settings store for ZCode RTL Fixer: ~/.zcode/rtl-fixer/settings.json
// Merged over engine/settings.default.json. Managed by the plugin commands.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(SCRIPTS_DIR, '..');
const DEFAULTS_PATH = path.join(SCRIPTS_DIR, 'engine', 'settings.default.json');
const USER_PATH = path.join(os.homedir(), '.zcode', 'rtl-fixer', 'settings.json');

export function loadSettings() {
  const defaults = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'));
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(USER_PATH, 'utf8'));
  } catch {
    /* first run: no user settings yet */
  }
  return { settings: { ...defaults, ...user }, defaults, userPath: USER_PATH };
}

export function saveSettings(patch) {
  fs.mkdirSync(path.dirname(USER_PATH), { recursive: true });
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(USER_PATH, 'utf8'));
  } catch {
    /* ignore */
  }
  const merged = { ...user, ...patch };
  fs.writeFileSync(USER_PATH, JSON.stringify(merged, null, 2) + '\n');
  return { settings: loadSettings().settings, userPath: USER_PATH };
}

/** Relative engine dir of this plugin (scripts/engine). */
export function engineDir() {
  return path.join(SCRIPTS_DIR, 'engine');
}

// CLI: `node settings.mjs get` / `node settings.mjs set '{"key":value}'`
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , cmd, arg] = process.argv;
  if (cmd === 'get') {
    console.log(JSON.stringify(loadSettings().settings, null, 2));
  } else if (cmd === 'set') {
    const patch = JSON.parse(arg);
    const res = saveSettings(patch);
    console.log('saved ->', res.userPath);
    console.log(JSON.stringify(res.settings, null, 2));
  } else {
    console.error('usage: node settings.mjs get | set \'{"key":value}\'');
    process.exit(1);
  }
}

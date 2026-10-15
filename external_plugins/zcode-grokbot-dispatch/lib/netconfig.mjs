/**
 * Single source for zcode-dispatch network settings (no hostnames, IPs or user paths in code).
 * Used by the receiver, lib/appsession, the plugin (dispatch + Stop hook); the private Yobiru wake adapter (outside this repo) reads the same config file. Transport selection and peers live in transport.mjs.
 *
 * Resolution order: environment variable > config file > discovery.
 *   config file: $ZCODE_DISPATCH_CONFIG or ~/.config/zcode-dispatch/config.json
 *     { "host": "<bind IP>", "port": 7791, "allowedIps": ["<box IP>"],
 *       "grokPeer": "<box MagicDNS name>/grok", "allowedPeers": ["<peer MagicDNS>", ...] }
 *   discovery (`tailscale status --json`; off with ZCODE_DISPATCH_DISCOVERY=0):
 *     host       -> this node's tailnet IPv4 (never 0.0.0.0)
 *     allowedIps -> tailnet IPs of the grokPeer node
 * Unresolved values stay null/empty: the receiver refuses to bind, the allowlist denies everyone,
 * and nothing is sent to Grok.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_FILE = () => process.env.ZCODE_DISPATCH_CONFIG
  || path.join(os.homedir(), '.config', 'zcode-dispatch', 'config.json');

export function readConfigFile(file = CONFIG_FILE()) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v && typeof v === 'object' ? v : {}; }
  catch { return {}; }
}

const TAILSCALE_CANDIDATES = ['tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];

let cachedStatus;
/** Parsed `tailscale status --json`, or null. Cached per process; override with statusProvider in tests. */
export function tailscaleStatus({ refresh = false } = {}) {
  if (process.env.ZCODE_DISPATCH_DISCOVERY === '0') return null;
  if (cachedStatus !== undefined && !refresh) return cachedStatus;
  cachedStatus = null;
  const bins = process.env.TAILSCALE_BIN ? [process.env.TAILSCALE_BIN] : TAILSCALE_CANDIDATES;
  for (const bin of bins) {
    try {
      const out = execFileSync(bin, ['status', '--json'], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
      cachedStatus = JSON.parse(out.toString('utf8')); break;
    } catch { /* try next */ }
  }
  return cachedStatus;
}

const stripDot = s => String(s || '').replace(/\.$/, '');
const ipv4 = ips => (ips || []).find(ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) || null;

export function selfIPv4(status) { return ipv4(status?.Self?.TailscaleIPs) || ipv4(status?.TailscaleIPs); }
export function selfDNSName(status) { return stripDot(status?.Self?.DNSName) || null; }

/** Tailnet IPv4s of the peer whose MagicDNS name (or short host name) matches `name`. */
export function peerIPs(status, name) {
  if (!status || !name) return [];
  const want = stripDot(name).toLowerCase();
  const short = want.split('.')[0];
  for (const p of Object.values(status.Peer || {})) {
    const dns = stripDot(p.DNSName).toLowerCase();
    if (dns === want || (want === short && (dns.split('.')[0] === short || String(p.HostName).toLowerCase() === short))) {
      return (p.TailscaleIPs || []).filter(ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
    }
  }
  return [];
}

const list = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(x => String(x).trim()).filter(Boolean);
export const peerHost = peer => (peer ? String(peer).split('/')[0] : null);

/** Resolve host/port/allowedIps/grokPeer. Sources are injectable for tests. */
export function resolveNetConfig({ env = process.env, file = readConfigFile(), status = tailscaleStatus } = {}) {
  let st; const ts = () => (st === undefined ? (st = status() || null) : st);
  const grokPeer = env.ZCODE_DISPATCH_GROK_PEER || file.grokPeer || null;
  const host = env.DISPATCH_HOST || file.host || selfIPv4(ts()) || null;
  const port = Number(env.DISPATCH_PORT || file.port || 7791);
  let allowedIps = list(env.DISPATCH_ALLOWED_IPS || file.allowedIps);
  if (!allowedIps.length) allowedIps = peerIPs(ts(), peerHost(grokPeer));
  return { host, port, allowedIps, grokPeer };
}

// Moved to transport.mjs (single place for Yobiru); re-exported for existing callers.
export { yobiruBin } from './transport.mjs';

/** Projects root: env ZCODE_DISPATCH_PROJECTS_ROOT > config "projectsRoot" > ~/Projects. */
export function projectsRoot(env = process.env, file = readConfigFile()) {
  const p = env.ZCODE_DISPATCH_PROJECTS_ROOT || file.projectsRoot;
  return p ? (p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p) : path.join(os.homedir(), 'Projects');
}

/** Refused project names: config "denyProjects" (regex source, case-insensitive) > /finance/i. */
export function denyProjectsRe(file = readConfigFile()) {
  return new RegExp(typeof file.denyProjects === 'string' && file.denyProjects ? file.denyProjects : 'finance', 'i');
}

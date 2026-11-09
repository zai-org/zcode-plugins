import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { userInfo } from "node:os";
import { join } from "node:path";

// Keep network access in an explicit preparation phase, outside MCP's 60s
// request deadline. Do not inherit unrelated CI credentials into the plugin.
export async function prepareKicadRuntime(launcher, cwd, options = {}) {
  const source = options.env ?? process.env;
  const env = Object.fromEntries([
    "PATH", "HOME", "USER", "LANG", "UV_CACHE_DIR", "UV_PYTHON_INSTALL_DIR",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "UV_NATIVE_TLS", "ZCODE_KICAD_PYTHON",
  ].filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
  // CI already supplies this egress for dependency builds. Reuse it only in
  // preparation, and preserve an explicitly selected HTTPS proxy.
  if (!env.HTTPS_PROXY && !env.https_proxy && source.CRAFT_HTTPS_PROXY) {
    env.HTTPS_PROXY = source.CRAFT_HTTPS_PROXY;
    env.https_proxy = source.CRAFT_HTTPS_PROXY;
    process.stderr.write("kicad: using build proxy for Python runtime preparation\n");
  }
  // HOME is deliberately disposable. Keep uv's managed Python installations
  // outside it, just like the launcher's shared wheel cache, so each artifact
  // check does not download the same interpreter again. Respect an override.
  env.UV_PYTHON_INSTALL_DIR ||= join(userInfo().homedir, ".cache", "zcode-plugins", "uv-python");
  env.HOME = cwd; // Preserve isolation of plugin data and all other home files.
  process.stderr.write("kicad: preparing Python runtime before MCP artifact check\n");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcher, "--prepare-runtime"], { cwd, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    const timer = setTimeout(() => {
      // Kill the provisioning group too, so a timed-out uv download cannot linger.
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch (error) { if (error.code !== "ESRCH") reject(error); }
    }, options.timeoutMs ?? 540000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const path = stdout.trim();
      if (code !== 0 || path !== "ready") {
        reject(new Error(`kicad: Python runtime preparation failed (${signal ?? code}); see dependency diagnostics above`));
      } else resolve(path);
    });
  });
  // Warm-cache resolution is allowed; network work must stay outside the handshake.
  return {
    ...Object.fromEntries(["UV_CACHE_DIR", "UV_PYTHON_INSTALL_DIR", "ZCODE_KICAD_PYTHON"]
      .filter((key) => env[key] !== undefined).map((key) => [key, env[key]])),
    UV_OFFLINE: "1",
  };
}

export function assertKicadRuntimeTools(tools) {
  assert.ok(tools.some((tool) => tool.name === "pcb_build"),
    "kicad: artifact check requires the Python server, not the missing-runtime fallback");
}

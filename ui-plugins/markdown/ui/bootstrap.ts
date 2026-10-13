// Styles arrive in the HTML head; only the editor code uses chunked MCP resources.
import { getClient } from "./client.ts";
import { applyHostTheme, showBootError } from "./boot.ts";

const ASSET_PREFIX = "ui://markdown/assets/";

async function readText(uri: string) {
  const response = await getClient().readResource(uri);
  const entry = (response.contents ?? [])[0];
  const text = entry && "text" in entry ? entry.text : undefined;
  if (typeof text !== "string") throw new Error(`asset missing: ${uri}`);
  return text;
}

async function main() {
  await getClient().ready();
  applyHostTheme();
  getClient().subscribe(applyHostTheme);
  document.body.dataset.boot = "loading";
  const manifest = JSON.parse(await readText(`${ASSET_PREFIX}assets.json`)) as {
    scripts: string[];
  };
  const parts = await Promise.all(
    manifest.scripts.map((name) => readText(`${ASSET_PREFIX}${name}`)),
  );
  const script = document.createElement("script");
  script.textContent = parts.join("");
  document.head.append(script);
}

void main().catch(showBootError);

import { App } from "@modelcontextprotocol/ext-apps";
import { EmptyResultSchema } from "@modelcontextprotocol/core";

const app = new App({ name: "my-mcp-app", version: "0.1.0" }, {});
let output: unknown;
let widgetState: unknown;

// Install handlers before connecting so initial data is not lost.
app.ontoolresult = (result) => {
  output = result.structuredContent;
  render();
};
app.onhostcontextchanged = () => render();
await app.connect();
widgetState = app.getHostContext()?.["zcode/widgetState"];
render();

export async function saveViewState(state: unknown) {
  if (!app.getHostCapabilities()?.experimental?.["zcode/widgetState"])
    throw new Error("Host does not support session widget state");
  await app.request(
    { method: "ui/set-widget-state", params: { widgetState: state } },
    EmptyResultSchema,
  );
  widgetState = state;
  render();
}

function render() {
  // Replace with the plugin's UI; committed documents remain server-owned.
  document.documentElement.dataset.theme = app.getHostContext()?.theme ?? "light";
  document.body.textContent = JSON.stringify({ output, widgetState });
}

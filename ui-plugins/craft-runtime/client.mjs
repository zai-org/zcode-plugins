import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";

const settings = __CRAFT_SETTINGS__;
const app = new App({ name: settings.name, version: settings.version }, {}, { autoResize: false });
const prefix = `ui://${settings.name}`;
let loaded = false;
let pendingFile;
let latestFile;
let loadingFile;
let lastExport;
let disposed = false;
let editorToken;
let workspaceRoot = "";
let operation;
const workspaceFiles = new Map();
const fileKey = (path) => {
  const parts = [];
  for (const part of String(path).replaceAll("\\", "/").split("/")) {
    if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part);
  }
  const key = parts.join("/");
  return workspaceRoot && key.startsWith(workspaceRoot + "/") ? key.slice(workspaceRoot.length + 1) : key;
};
globalThis.__craftList = (path) => {
  const prefix = fileKey(path);
  return [...workspaceFiles.keys()].filter((key) => !prefix || key.startsWith(prefix + "/")).sort();
};
globalThis.__craftMkdir = (path) => {
  if (!operation) throw new Error("Directory creation requires an active operation");
  operation.directories.add(fileKey(path));
};
globalThis.__craftRead = (path) => {
  const key = fileKey(path);
  const bytes = [...(operation?.outputs || [])].find(([path]) => fileKey(path) === key)?.[1] || workspaceFiles.get(key);
  if (!bytes) throw new Error(`File was not supplied to this operation: ${path}`);
  return bytes.slice();
};
globalThis.__craftWrite = (path, bytes) => {
  if (!operation) { void saveExport(new Blob([bytes]), String(path).split(/[\\/]/).pop()).catch(fail); return; }
  if (bytes.length > 128 * 1024 * 1024) throw new Error("Output exceeds 128 MiB");
  if (operation.request.readOnly) throw new Error("Read-only operation cannot write");
  if (operation.outputs.size >= 256 && !operation.outputs.has(fileKey(path))) throw new Error("Too many output files");
  const total = [...operation.outputs].reduce((sum,[key,value]) => sum + (key === path ? 0 : value.length),bytes.length);
  if (total > 128 * 1024 * 1024) throw new Error("Combined outputs exceed 128 MiB");
  operation.outputs.set(path, bytes.slice());
};
globalThis.__craftScreenshot = () => {
  const canvas = document.querySelector("#craft-stage canvas");
  const max = settings.name === "photocraft" ? operation?.request.arguments?.max_side : undefined;
  if (max > 2048) throw new Error("Screenshot side exceeds 2048 pixels");
  if (max > 0 && Math.max(canvas.width,canvas.height) > max) {
    const copy=document.createElement("canvas"), scale=max/Math.max(canvas.width,canvas.height);
    copy.width=Math.max(1,Math.round(canvas.width*scale)); copy.height=Math.max(1,Math.round(canvas.height*scale));
    copy.getContext("2d").drawImage(canvas,0,0,copy.width,copy.height);
    return copy.toDataURL("image/png").split(",")[1];
  }
  return canvas.toDataURL("image/png").split(",")[1];
};
const objectUrls = new Set();
const blobs = new Map();
const status = document.getElementById("craft-status");
const notice = document.getElementById("craft-notice");
const retry = document.getElementById("craft-retry-export");
const chinese = () => !app.getHostContext()?.locale?.startsWith("en");
const text = (zh, en) => chinese() ? zh : en;
function message(value, error = false) {
  status.textContent = value;
  status.dataset.error = String(error);
  notice.hidden = loaded && !error;
  retry.hidden = !error || !lastExport;
}
function fail(error) {
  message(error.message || String(error), true);
  console.error(`[${settings.name}]`, error);
}
const state = window.__craftPlugin = { loaded: false, error: null, openedFile: null, exports: 0 };
app.ontoolinput = () => {};
app.ontoolresult = (result) => {
  if (result.structuredContent?.file) {
    pendingFile = result.structuredContent.file;
    void openPending().catch(fail);
  }
};
app.onhostcontextchanged = () => {
  document.documentElement.lang = chinese() ? "zh-CN" : "en";
  retry.textContent = text("重新保存导出", "Retry export");
};
app.onteardown = async () => {
  disposed = true;
  if (editorToken) await app.callServerTool({ name: "_editor_detach", arguments: { token: editorToken } }).catch(() => {});
  for (const url of objectUrls) URL.revokeObjectURL(url);
  return {};
};

function decode(base64) {
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function encode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
async function readJson(uri) {
  const result = await app.readServerResource({ uri });
  return JSON.parse(result.contents[0].text);
}
async function readBytes(entry, uri) {
  const result = new Uint8Array(entry.bytes);
  let offset = 0;
  for (let part = 0; part < entry.parts; part++) {
    if (disposed) throw new Error("Editor closed");
    const response = await app.readServerResource({ uri: `${uri}/${part}` });
    const bytes = decode(response.contents[0].blob);
    if (offset + bytes.length > result.length) throw new Error("Invalid file length");
    result.set(bytes, offset);
    offset += bytes.length;
  }
  if (offset !== result.length) throw new Error("Incomplete file");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", result)),
    (value) => value.toString(16).padStart(2, "0")).join("");
  if (hash !== entry.sha256) throw new Error("File integrity check failed");
  return result;
}
async function openPending() {
  if (!loaded || !pendingFile || pendingFile.id === latestFile || loadingFile) return;
  const file = pendingFile;
  loadingFile = file.id;
  try {
    message(text("正在打开：", "Opening: ") + file.name);
    const bytes = await readBytes(file, file.uri);
    if (disposed || pendingFile?.id !== file.id) return;
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], file.name));
    const canvas = document.querySelector("#craft-stage canvas");
    canvas.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
    latestFile = file.id;
    state.openedFile = file.name;
    message(file.name);
  } finally {
    loadingFile = null;
    if (pendingFile?.id !== file.id) void openPending().catch(fail);
  }
}

async function saveExport(blob, name) {
  if (operation) {
    const current = operation;
    const requested = current.request.arguments?.path || current.request.arguments?.params?.path;
    const path = typeof requested === "string" ? requested : name;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (operation !== current) throw new Error("Export outlived its operation");
    globalThis.__craftWrite(path, bytes);
    return;
  }
  lastExport = { blob, name };
  if (!app.getHostCapabilities()?.downloadFile)
    throw new Error(text("此 ZCode 版本不支持文件保存，请升级后重试。", "This ZCode version does not support file downloads. Upgrade and retry."));
  if (blob.size > 50 * 1024 * 1024)
    throw new Error(text("导出超过宿主的 50 MiB 保存上限，请减小文件后重试。", "Export exceeds the host's 50 MiB limit. Reduce its size and retry."));
  const result = await app.downloadFile({ contents: [{
    type: "resource", resource: {
      uri: `file:///${encodeURIComponent(name)}`, name,
      mimeType: blob.type || "application/octet-stream",
      blob: encode(new Uint8Array(await blob.arrayBuffer())),
    },
  }] }, { timeout: 300000 });
  if (result.isError) throw new Error(text("保存已取消或失败；导出仍可重新保存。", "Save was cancelled or failed. You can retry the export."));
  state.exports++;
  lastExport = null;
  message(text("已交给宿主保存：", "Saved through host: ") + name);
}

function installDownloads() {
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    const url = create(blob);
    if (blob instanceof Blob) blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url) => { blobs.delete(url); revoke(url); };
  const download = (anchor) => {
    if (!anchor.hasAttribute("download")) return false;
    const name = anchor.download || "export";
    let blob = blobs.get(anchor.href);
    if (!blob && anchor.href.startsWith("data:")) {
      const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(anchor.href);
      if (match) blob = new Blob([match[2] ? decode(match[3]) : decodeURIComponent(match[3])], { type: match[1] });
    }
    if (!blob) {
      fail(new Error(text("无法读取导出文件。", "Cannot read the exported file.")));
      return true;
    }
    const pending = saveExport(blob, name);
    if (operation) operation.downloads.push(pending); else void pending.catch(fail);
    return true;
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (!download(this)) click.call(this); };
  document.addEventListener("click", (event) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[download]") : null;
    if (anchor && download(anchor)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  // Upstream pickers already fall back to download anchors; the host owns Save As.
  Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
  retry.onclick = () => { if (lastExport) void saveExport(lastExport.blob, lastExport.name).catch(fail); };
}

async function boot() {
  await app.connect(new PostMessageTransport(window.parent, window.parent));
  app.onhostcontextchanged();
  installDownloads();
  const manifest = await readJson(`${prefix}/assets.json`);
  const byPath = new Map(manifest.assets.map((entry) => [entry.path, entry]));
  const cache = new Map();
  const asset = (entry) => {
    if (!cache.has(entry.id)) cache.set(entry.id, readBytes(entry, `${prefix}/asset/${entry.id}`));
    return cache.get(entry.id);
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const url = new URL(typeof input === "string" ? input : input.url || input.href, location.href);
    const base = new URL(".", location.href);
    const path = url.pathname.startsWith(base.pathname) ? decodeURIComponent(url.pathname.slice(base.pathname.length)) : "";
    const entry = url.origin === location.origin ? byPath.get(path) : undefined;
    // The sandbox serves HTML only. A missing optional local asset is a normal 404,
    // rather than a network request that would be rejected by connect-src.
    if (!entry && url.origin === location.origin && url.protocol === location.protocol)
      return new Response("Not found", { status: 404 });
    if (!entry) return originalFetch(input, options);
    return new Response((await asset(entry)).slice(), { headers: { "Content-Type": entry.mime } });
  };
  const js = byPath.get(manifest.entry);
  const wasm = byPath.get(manifest.wasm);
  message(text("正在加载编辑器…", "Loading editor…"));
  const url = URL.createObjectURL(new Blob([await asset(js)], { type: "text/javascript" }));
  objectUrls.add(url);
  const module = await import(/* @vite-ignore */ url);
  await module.default({ module_or_path: await asset(wasm) });
  window.wasmBindings = module;
  window.dispatchEvent(new CustomEvent("TrunkApplicationStarted", { detail: { wasm } }));
  // WebRunner initializes asynchronously after wasm-bindgen's start function returns.
  const canvas = document.querySelector("#craft-stage canvas");
  for (let attempt = 0; attempt < 600; attempt++) {
    if (disposed) return;
    if (canvas?.width > 0 && canvas?.height > 0 &&
        (canvas.width !== 300 || canvas.height !== 150) &&
        !document.getElementById(`${settings.name}_loading`)) {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      loaded = true;
      state.loaded = true;
      message(text("就绪", "Ready"));
      await openPending();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(text("编辑器启动超时，请重新打开面板。", "Editor startup timed out. Reopen the panel."));
}
async function internal(name, args) {
  const result = await app.callServerTool({ name, arguments: args }, { timeout: 180000 });
  if (result.isError) throw new Error(result.content?.[0]?.text || "Editor bridge failed");
  return result.structuredContent;
}
async function automationLoop() {
  const module = window.wasmBindings;
  if (!module?.craft_submit || !module?.craft_catalog) throw new Error("This WASM build has no automation bridge");
  state.tools = JSON.parse(module.craft_catalog());
  const connected = await internal("_editor_attach", {});
  editorToken = connected.token;
  workspaceRoot = fileKey(connected.workspace);
  state.automationReady = true;
  while (!disposed) {
    const { request } = await internal("_editor_poll", { token: editorToken });
    if (!request) continue;
    let result;
    const written = [];
    try {
      workspaceFiles.clear();
      for (const input of request.inputs || []) workspaceFiles.set(fileKey(input.path), await readBytes(input, input.uri));
      operation = { request, outputs: new Map(), directories: new Set(request.directories), downloads: [] };
      module.craft_submit(JSON.stringify({ id: request.id, name: request.name, arguments: request.arguments }));
      const until = Date.now() + 110000;
      while (!disposed && Date.now() < until) {
        const reply = JSON.parse(module.craft_take_reply());
        if (reply?.id === request.id) { result = reply.result; break; }
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      if (!result) throw new Error("Editor operation timed out; inspect state before retrying");
      while (!module.craft_idle() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve,16));
      if (!module.craft_idle()) throw new Error("Input queue did not settle");
      // Allow asynchronous browser-download callbacks started by a synchronous Save to finish.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(operation.downloads);
      for (const [path, bytes] of operation.outputs) {
        const chunkBytes = 2 * 1024 * 1024;
        const total = Math.max(1, Math.ceil(bytes.length / chunkBytes));
        for (let part = 0; part < total; part++) {
          const saved = await internal("_editor_write", { token: editorToken, id: request.id, path, part, total,
            data: encode(bytes.subarray(part * chunkBytes, (part + 1) * chunkBytes)) });
          if (saved.complete) written.push(saved);
        }
      }
      if (result._craftSave) {
        module.craft_submit(JSON.stringify({id:request.id + ":saved",name:"__craft_saved",arguments:result._craftSave}));
        let acknowledged = false;
        for (let attempt=0; attempt<600; attempt++) {
          const reply=JSON.parse(module.craft_take_reply());
          if (reply?.id === request.id + ":saved") {
            if (reply.result.isError) throw new Error(reply.result.content[0].text);
            acknowledged=true; break;
          }
          await new Promise((resolve)=>setTimeout(resolve,16));
        }
        if (!acknowledged) throw new Error("File saved, but editor save acknowledgement timed out");
      }
      delete result._craftSave;
      if (written.length) result.content.push({ type: "text", text: JSON.stringify({ written }) });
    } catch (error) {
      result = { isError: true, content: [{ type: "text", text: `${error.message}; inspect document state before retrying` }, ...(written.length ? [{ type:"text", text:JSON.stringify({written}) }] : [])] };
    } finally { operation = null; workspaceFiles.clear(); }
    if (new TextEncoder().encode(JSON.stringify(result)).length > 6 * 1024 * 1024) {
      result = {isError:true,content:[{type:"text",text:"Result exceeds 6 MiB; inspect state and request a smaller range, preview, or batch before retrying."},
        ...(written.length ? [{type:"text",text:JSON.stringify({written})}] : [])]};
    }
    await internal("_editor_reply", { token: editorToken, id: request.id, result });
  }
}
boot().then(automationLoop).catch((error) => { state.error = error.message; fail(error); });

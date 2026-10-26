import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { NotebookRef, ServerInfo, SessionState } from "#nb/contract.ts";
import { host, ToolError } from "#ui/bridge.ts";
import type { Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { Menu, MenuItem, useMenu } from "#ui/Menu.tsx";
import { Command, Disclosure, Handoff, Intro, Requirements, SentStrip, Tag, type Requirement } from "#ui/setup-kit.tsx";
import { refreshState, selectNotebook, setupAction } from "#ui/store.ts";
import { hostOf, relativeTime } from "#ui/text.ts";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 没有 notebook 时页面的头部：只有标题，可选关闭。 */
function PlainHeader({ title, s, onClose, children }: { title: string; s: Strings; onClose?: () => void; children?: ReactNode }) {
  return (
    <header className="hdr">
      <div className="title">
        <Icon name="notebook" />
        <span className="name">{title}</span>
      </div>
      <span className="spacer" />
      {children}
      {onClose && (
        <button type="button" className="btn ghost icon-only quiet" aria-label={s.close} title={s.close} onClick={onClose}>
          <Icon name="x" />
        </button>
      )}
    </header>
  );
}

/** 本机发现的、尚未连接的 server。 */
function Discovered({ state, s, busy, run, label }: { state: SessionState; s: Strings; busy: string | null; run: Run; label: string }) {
  const discovered = state.discovered.filter((item) => !item.connectedAs);
  if (!discovered.length) return null;
  return (
    <div className="section">
      <div className="label">{label}</div>
      <div className="card">
        {discovered.map((item) => (
          <div className="row" key={item.url}>
            <div className="tile">
              <Icon name="server" />
            </div>
            <div className="grow">
              <div className="mono sm" style={{ fontSize: "var(--nb-text-caption)", lineHeight: "20px" }}>
                {hostOf(item.url)}
              </div>
              <div className="sm fg2" title={item.rootDir ?? undefined}>
                {[item.version && s.serverVersion(item.version), item.rootDir].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button
              type="button"
              className="btn outline"
              disabled={!!busy}
              onClick={() => void run(item.url, () => host.call("connect_server", { url: item.url }))}
            >
              {busy === item.url ? s.connectingServer : s.connect}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 按 URL 连接已有 server（远程 server 不需要本机安装 Jupyter）。 */
function ByUrl({ s, busy, run, label }: { s: Strings; busy: string | null; run: Run; label: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  return (
    <div className="section">
      <button type="button" className={`label ${open ? "open" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chevronDown" size={12} />
        {label}
      </button>
      {open && (
        <form
          className="url-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (url.trim())
              void run("url", () => host.call("connect_server", { url: url.trim(), ...(token.trim() ? { token: token.trim() } : {}) }));
          }}
        >
          <label className="field mono">
            <Icon name="link" size={14} />
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={s.urlPlaceholder} spellCheck={false} aria-label={label} />
          </label>
          <div className="line">
            <label className="field">
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={s.tokenPlaceholder}
                type="password"
                autoComplete="off"
                aria-label={s.tokenPlaceholder}
              />
            </label>
            <button type="submit" className="btn outline size-lg" disabled={!!busy || !url.trim()}>
              {busy === "url" ? s.connectingServer : s.connect}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

type Run = (key: string, action: () => Promise<unknown>) => Promise<void>;

/** 没有已连接 server 时：本机发现的 server、为工作区启动、按 URL 连接；缺少依赖时先显示设置页。 */
export function ServerSetup({ state, s }: { state: SessionState; s: Strings }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const discovered = state.discovered.filter((item) => !item.connectedAs);
  const starting = busy === "start" || busy === "uv" || state.servers.some((server) => server.status === "starting");
  const failed = state.servers.find((server) => server.status === "error");

  const run: Run = async (key, action) => {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (caught) {
      // 缺少依赖：server 已更新环境检查，设置页会显示要求清单，不需要再弹错误。
      if (!(caught instanceof ToolError && caught.code === "jupyter_not_installed")) setError(message(caught));
    } finally {
      setBusy(null);
      await refreshState();
    }
  };
  const start = (useUv = false) => run(useUv ? "uv" : "start", () => host.call("start_server", useUv ? { useUv: true } : {}));

  if (state.environment.state === "missing")
    return (
      <div className="shell">
        <PlainHeader title={s.title} s={s} />
        <div className="page">
          <JupyterSetup state={state} s={s} busy={busy} run={run} onUv={() => void start(true)} error={error} />
        </div>
      </div>
    );

  return (
    <div className="shell">
      <PlainHeader title={s.title} s={s} />
      <div className="page">
        <div className="setup">
          <div className="intro">
            <div className="tile lg">
              <Icon name="notebook" size={20} />
            </div>
            <h1>{s.setupTitle}</h1>
            <p className="lead">{s.setupBody}</p>
          </div>

          <Discovered state={state} s={s} busy={busy} run={run} label={s.discovered} />

          <div className="section">
            <div className="label">{discovered.length ? s.startLabelOr : s.startLabel}</div>
            <div className="card">
              <div className="row start">
                <div className="grow">
                  <div className="strong">{s.startTitle}</div>
                  <div className="sm fg2" style={{ marginTop: 2 }}>
                    {s.startDetail(state.launchPython)}
                  </div>
                </div>
                <button type="button" className="btn primary" disabled={!!busy || starting} onClick={() => void start()}>
                  {starting && <Icon name="spinner" size={14} className="spin" />}
                  {starting ? s.starting : s.start}
                </button>
              </div>
            </div>
          </div>

          <ByUrl s={s} busy={busy} run={run} label={s.byUrl} />

          {(error || failed?.error) && <pre className="error-box">{error ?? `${s.serverStopped}\n${failed?.error}`}</pre>}
          <p className="hint">{s.askAgent}</p>
        </div>
      </div>
    </div>
  );
}

/** 缺少 jupyter-server / ipykernel：要求清单、交给 Agent、自己安装，或连接已有 server。 */
function JupyterSetup({
  state,
  s,
  busy,
  run,
  onUv,
  error,
}: {
  state: SessionState;
  s: Strings;
  busy: string | null;
  run: Run;
  onUv: () => void;
  error: string | null;
}) {
  const env = state.environment;
  const python = env.python;
  const working = state.setup.handoffAt !== null;
  const where = python ? (python.venv ?? python.executable) : "";
  const rows: Requirement[] = [
    python
      ? {
          key: "python",
          glyph: "ok",
          title: python.venv ? s.reqProjectPython : s.reqPython,
          detail: `${python.executable} · ${python.uv ? s.managedByUv : python.source}`,
          side: <Tag tone="version">{python.version}</Tag>,
        }
      : { key: "python", glyph: "todo", title: s.reqPython, detail: s.noPython, side: <Tag tone="warn">{s.kit.missing}</Tag> },
    ...(["jupyter-server", "ipykernel"] as const).map((name): Requirement => {
      const version = env.packages.find((pkg) => pkg.name === name)?.version;
      if (!python) return { key: name, glyph: "wait", title: name, detail: s.checkedOncePython };
      return version
        ? { key: name, glyph: "ok", title: name, detail: s.installedIn(where), side: <Tag tone="version">{version}</Tag> }
        : { key: name, glyph: "todo", title: name, detail: s.notInstalledIn(where), side: <Tag tone="warn">{s.kit.missing}</Tag> };
    }),
  ];
  const [lead, pkg1, and, pkg2, tail] = s.missingBody;
  const message = s.setupMessage(env);
  const handoff = () => setupAction("handoff");
  return (
    <div className="setup">
      <Intro
        icon={<Icon name="notebook" size={20} />}
        title={working ? s.workingTitle : s.setupJupyterTitle}
        lead={
          working ? (
            s.workingLead
          ) : (
            <>
              {lead}
              <code>{pkg1}</code>
              {and}
              <code>{pkg2}</code>
              {tail}
            </>
          )
        }
      />
      <Discovered state={state} s={s} busy={busy} run={run} label={s.discovered} />
      <Requirements k={s.kit} rows={rows} live={working ? "watching" : null} agentWorking={working} onCheck={() => setupAction("check")} />
      {working ? <SentStrip k={s.kit} message={message} onHandoff={handoff} /> : <Handoff k={s.kit} title={s.handoffInstall} message={message} onHandoff={handoff} />}
      {(env.installCommand || env.uv) && (
        <Disclosure label={s.installYourself}>
          {env.installCommand && <Command k={s.kit} command={env.installCommand} />}
          {env.uv && (
            <>
              <div className="buttons">
                <button type="button" className="btn outline" disabled={!!busy} onClick={onUv}>
                  {busy === "uv" && <Icon name="spinner" size={14} className="spin" />}
                  {busy === "uv" ? s.starting : s.useUvSession}
                </button>
              </div>
              <p className="hint">{s.uvHint}</p>
            </>
          )}
        </Disclosure>
      )}
      <ByUrl s={s} busy={busy} run={run} label={s.byUrlLong} />
      {error && <pre className="error-box">{error}</pre>}
    </div>
  );
}

interface Entry {
  name: string;
  path: string;
  type: string;
  lastModified: string;
}

/** 浏览 server 目录，打开或新建 notebook。 */
export function NotebookPicker({
  state,
  s,
  initialCreate = false,
  onClose,
}: {
  state: SessionState;
  s: Strings;
  initialCreate?: boolean;
  onClose?: () => void;
}) {
  const ready = state.servers.filter((server) => server.status === "ready");
  const [serverId, setServerId] = useState(ready[0]?.id ?? "");
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(initialCreate);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const serverMenu = useMenu();
  const server: ServerInfo | undefined = ready.find((item) => item.id === serverId) ?? ready[0];
  const now = Date.now();

  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    setEntries(null);
    host.call<{ entries: Entry[] }>("list_notebooks", { server: server.id, path: dir }).then(
      (result) => !cancelled && setEntries(result.entries),
      (caught) => {
        if (cancelled) return;
        setEntries([]);
        setError(message(caught));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [server?.id, dir]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (entries ?? []).filter((entry) => !needle || entry.name.toLowerCase().includes(needle));
  }, [entries, query]);

  const open = async (path: string, create = false) => {
    if (!server) return;
    setBusy(true);
    setError(null);
    try {
      const result = await host.call<{ notebook: NotebookRef }>("open_notebook", { server: server.id, path, create });
      selectNotebook(result.notebook.notebookId);
      await refreshState();
      onClose?.();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  };

  const create = () => {
    let file = name.trim() || s.newPlaceholder;
    if (!file.toLowerCase().endsWith(".ipynb")) file += ".ipynb";
    void open(dir ? `${dir}/${file}` : file, true);
  };

  if (!server) return null;
  const openIds = new Map(state.notebooks.filter((nb) => nb.serverId === server.id).map((nb) => [nb.path, nb]));
  const rootLabel = server.rootDir ? server.rootDir.replace(/\/+$/, "").split("/").pop() || server.rootDir : hostOf(server.url);
  const parts = dir ? dir.split("/") : [];

  return (
    <div className="shell">
      <PlainHeader title={s.openTitle} s={s} onClose={onClose}>
        <div className="anchor" ref={serverMenu.root} style={{ position: "relative" }}>
          {ready.length > 1 ? (
            <button
              type="button"
              ref={serverMenu.anchor}
              className={`chip ${serverMenu.open ? "open" : ""}`}
              aria-haspopup="menu"
              aria-label={s.server}
              onClick={serverMenu.toggle}
            >
              <span className="lamp ok" />
              <span className="mono" style={{ fontSize: "var(--nb-text-sm)" }}>
                {server.id}
              </span>
              <Icon name="chevronDown" size={14} className="chev" />
            </button>
          ) : (
            <span className="chip" title={server.url}>
              <span className="lamp ok" />
              <span className="mono" style={{ fontSize: "var(--nb-text-sm)" }}>
                {server.id}
              </span>
            </span>
          )}
          {serverMenu.open && (
            <Menu onClose={serverMenu.close} align="right" label={s.server}>
              {ready.map((item) => (
                <MenuItem
                  key={item.id}
                  checked={item.id === server.id}
                  label={<span className="mono">{item.id}</span>}
                  onSelect={() => {
                    serverMenu.close();
                    setServerId(item.id);
                    setDir("");
                  }}
                />
              ))}
            </Menu>
          )}
        </div>
      </PlainHeader>
      <div className="page">
        <div className="picker">
          {creating ? (
            <form
              className="top"
              onSubmit={(event) => {
                event.preventDefault();
                create();
              }}
            >
              <label className="field">
                <Icon name="notebook" size={14} />
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={s.newPlaceholder}
                  spellCheck={false}
                  aria-label={s.newNotebook}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setCreating(false);
                  }}
                />
              </label>
              <button type="submit" className="btn primary size-lg" disabled={busy}>
                {s.create}
              </button>
              <button type="button" className="btn ghost quiet size-lg" onClick={() => setCreating(false)}>
                {s.cancel}
              </button>
            </form>
          ) : (
            <div className="top">
              <label className="field">
                <Icon name="search" size={14} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={s.find} aria-label={s.find} />
              </label>
              <button type="button" className="btn outline size-lg" onClick={() => setCreating(true)}>
                <Icon name="plus" size={15} />
                {s.newNotebook}
              </button>
            </div>
          )}
          <nav className="crumbs" aria-label="Path">
            <button type="button" title={server.rootDir ?? undefined} onClick={() => setDir("")}>
              {rootLabel}
            </button>
            {parts.map((part, index) => (
              <span key={index} style={{ display: "contents" }}>
                <Icon name="chevronRight" size={12} />
                <button type="button" onClick={() => setDir(parts.slice(0, index + 1).join("/"))}>
                  {part}
                </button>
              </span>
            ))}
          </nav>
          <div className="card">
            {entries === null && <div className="row compact placeholder">{s.loading}</div>}
            {entries !== null && shown.length === 0 && (
              <div className="row compact placeholder">{query.trim() ? s.noMatch : s.emptyDir}</div>
            )}
            {shown.map((entry) => {
              const isDir = entry.type === "directory";
              const openNb = openIds.get(entry.path);
              const modified = Date.parse(entry.lastModified);
              return (
                <button
                  type="button"
                  key={entry.path}
                  className="row compact file"
                  disabled={busy}
                  onClick={() => (isDir ? (setDir(entry.path), setQuery("")) : void open(entry.path))}
                >
                  <Icon name={isDir ? "folder" : "notebook"} />
                  <span className="name">{entry.name}</span>
                  {!isDir && (
                    <span className="side">
                      {openNb && <span className="lamp ok" />}
                      {[openNb ? s.openNow : null, Number.isFinite(modified) ? relativeTime(modified, now, s) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {error && <pre className="error-box">{error}</pre>}
        </div>
      </div>
    </div>
  );
}

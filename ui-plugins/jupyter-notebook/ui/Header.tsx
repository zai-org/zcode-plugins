import { useState } from "react";
import type { KernelSpecInfo, NotebookDoc, SessionState } from "#nb/contract.ts";
import { host } from "#ui/bridge.ts";
import type { Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { Menu, MenuItem, MenuLabel, MenuSeparator, useMenu } from "#ui/Menu.tsx";
import { selectNotebook } from "#ui/store.ts";
import { hostOf, keys, lampOf } from "#ui/text.ts";

export interface HeaderActions {
  runAll: () => void;
  /** 先写回草稿再调用 kernel 相关工具。 */
  kernel: (tool: string, args?: Record<string, unknown>) => void;
  restartRunAll: () => void;
  clearOutputs: () => void;
  save: () => void;
  close: (id: string) => void;
  openPicker: (mode: "open" | "new") => void;
}

/** 一行头部：notebook 切换、保存状态、全部运行、kernel 状态与菜单、更多。 */
export function Header({
  doc,
  state,
  s,
  actions,
  onError,
  progress,
}: {
  doc: NotebookDoc;
  state: SessionState;
  s: Strings;
  actions: HeaderActions;
  onError: (error: unknown) => void;
  /** 一批运行（全部运行等）的进度：头部底线随之填满，kernel 状态写成“正在运行 3 / 5”。 */
  progress: { done: number; total: number } | null;
}) {
  const switcher = useMenu();
  const kernelMenu = useMenu();
  const more = useMenu();
  const [specs, setSpecs] = useState<KernelSpecInfo[] | null>(null);
  const kernel = doc.kernel;

  const openKernelMenu = () => {
    kernelMenu.toggle();
    if (!specs)
      void host
        .call<{ kernelspecs: KernelSpecInfo[] }>("list_kernelspecs", { server: doc.serverId })
        .then((result) => setSpecs(result.kernelspecs), onError);
  };
  const pick = (menu: ReturnType<typeof useMenu>, run: () => void) => () => {
    menu.close();
    run();
  };

  return (
    <header className="hdr">
      <div className="anchor" ref={switcher.root}>
        <button
          type="button"
          ref={switcher.anchor}
          className={`title ${switcher.open ? "open" : ""}`}
          aria-haspopup="menu"
          aria-expanded={switcher.open}
          title={`${doc.path} · ${doc.serverId}`}
          onClick={switcher.toggle}
        >
          <Icon name="notebook" />
          <span className="name">{doc.name}</span>
          <Icon name="chevronDown" size={14} className="chev" />
        </button>
        {switcher.open && (
          <Menu onClose={switcher.close} width={300} label={s.openNotebooks}>
            <MenuLabel>{s.openNotebooks}</MenuLabel>
            {state.notebooks.map((nb) => (
              <div className="nb-row" key={nb.id}>
                <MenuItem
                  label={nb.name}
                  lead={
                    <span className="mi-check" aria-hidden="true">
                      <span className={`lamp ${lampOf(nb.kernelStatus)}`} />
                    </span>
                  }
                  trailing={
                    <span className="trailing meta">
                      {nb.id === doc.id ? (
                        <Icon name="check" size={14} />
                      ) : nb.kernelStatus === "none" || nb.kernelStatus === "busy" ? (
                        s.kernelStatus[nb.kernelStatus].toLowerCase()
                      ) : null}
                    </span>
                  }
                  onSelect={pick(switcher, () => selectNotebook(nb.id))}
                />
                <button
                  type="button"
                  className="row-close"
                  aria-label={`${s.closeNotebook} ${nb.name}`}
                  title={s.closeNotebook}
                  onClick={() => actions.close(nb.id)}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
            <MenuSeparator />
            <MenuItem icon="folder" label={s.openNotebook} onSelect={pick(switcher, () => actions.openPicker("open"))} />
            <MenuItem icon="plus" label={s.newNotebook} onSelect={pick(switcher, () => actions.openPicker("new"))} />
            {state.servers.length > 0 && <MenuSeparator />}
            {state.servers.map((server) => (
              <div className="kv" key={server.id} title={server.url}>
                <Icon name="server" />
                <span className="text">
                  {hostOf(server.url)}
                  {server.kind === "launched" ? ` · ${s.startedHere}` : ""}
                </span>
                <span className={`lamp ${server.status === "ready" ? "ok" : server.status === "starting" ? "busy" : "bad"}`} />
              </div>
            ))}
          </Menu>
        )}
      </div>
      <span className={`save ${doc.save.state}`} title={doc.save.error ?? undefined}>
        {s.saveState[doc.save.state]}
      </span>
      <span className="spacer" />
      <button type="button" className="btn ghost run-all" title={s.runAll} aria-label={s.runAll} onClick={actions.runAll}>
        <Icon name="runAll" size={15} />
        <span className="label-text">{s.runAll}</span>
      </button>
      <div className="anchor" ref={kernelMenu.root}>
        <button
          type="button"
          ref={kernelMenu.anchor}
          className={`chip ${kernelMenu.open ? "open" : ""}`}
          aria-haspopup="menu"
          aria-expanded={kernelMenu.open}
          aria-label={`${s.kernel}: ${kernel.displayName ?? kernel.name ?? s.noKernel}, ${s.kernelStatus[kernel.status]}`}
          onClick={openKernelMenu}
        >
          <span className={`lamp ${lampOf(kernel.status)}`} />
          <span className="kernel-name">{kernel.displayName ?? kernel.name ?? s.noKernel}</span>
          {progress ? (
            <>
              <span className="state wide">{s.runningOf(Math.min(progress.done + 1, progress.total), progress.total)}</span>
              <span className="state narrow">{s.runningOfShort(Math.min(progress.done + 1, progress.total), progress.total)}</span>
            </>
          ) : (
            <span className="state">{s.kernelStatus[kernel.status]}</span>
          )}
          <Icon name="chevronDown" size={14} className="chev" />
        </button>
        {kernelMenu.open && (
          <Menu onClose={kernelMenu.close} align="right" width={262} label={s.kernel}>
            <MenuItem
              icon="stop"
              label={s.interrupt}
              shortcut="I I"
              onSelect={pick(kernelMenu, () => actions.kernel("interrupt_kernel"))}
            />
            <MenuItem
              icon="restart"
              label={s.restart}
              shortcut="0 0"
              onSelect={pick(kernelMenu, () => actions.kernel("restart_kernel", { wait: false }))}
            />
            <MenuItem icon="runAll" label={s.restartRunAll} onSelect={pick(kernelMenu, actions.restartRunAll)} />
            <MenuItem icon="eraser" label={s.clearOutputs} onSelect={pick(kernelMenu, actions.clearOutputs)} />
            <MenuSeparator />
            <MenuLabel>{s.kernel}</MenuLabel>
            {specs === null && <div className="kv">{s.loading}</div>}
            {specs?.map((spec) => (
              <MenuItem
                key={spec.name}
                checked={spec.name === kernel.name}
                label={spec.displayName}
                onSelect={pick(kernelMenu, () => {
                  if (spec.name !== kernel.name) actions.kernel("set_kernel", { name: spec.name });
                })}
              />
            ))}
          </Menu>
        )}
      </div>
      <div className="anchor" ref={more.root}>
        <button
          type="button"
          ref={more.anchor}
          className={`btn ghost icon-only quiet ${more.open ? "open" : ""}`}
          aria-haspopup="menu"
          aria-expanded={more.open}
          aria-label={s.more}
          title={s.more}
          onClick={more.toggle}
        >
          <Icon name="more" />
        </button>
        {more.open && (
          <Menu onClose={more.close} align="right" width={264} label={s.more}>
            <MenuItem icon="save" label={s.save} shortcut={keys("⌘ S")} onSelect={pick(more, actions.save)} />
            <MenuItem icon="x" label={s.closeNotebook} onSelect={pick(more, () => actions.close(doc.id))} />
            <MenuSeparator />
            <MenuLabel>{s.shortcuts}</MenuLabel>
            {s.shortcutList.map(([label, shortcut]) => (
              <div className="kv" key={label}>
                <span className="text">{label}</span>
                <kbd className="sc">{keys(shortcut)}</kbd>
              </div>
            ))}
          </Menu>
        )}
      </div>
      {progress && (
        <div className="hdr-progress" aria-hidden="true" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
      )}
    </header>
  );
}

/** 头部下方的通知条：操作失败、保存冲突 / 失败、kernel 停止。过大的输出在 cell 内原位说明，不在这里重复。 */
export function Bars({
  doc,
  s,
  notice,
  onDismiss,
  onError,
  onRestart,
}: {
  doc: NotebookDoc;
  s: Strings;
  notice: string | null;
  onDismiss: () => void;
  onError: (error: unknown) => void;
  onRestart: () => void;
}) {
  const call = (name: string, args: Record<string, unknown>) => void host.call(name, args).catch(onError);
  return (
    <>
      {notice && (
        <div className="bar bad" role="alert">
          <Icon name="alert" size={14} />
          <span className="msg">{notice}</span>
          <button type="button" className="btn sm ghost icon-only" aria-label={s.dismiss} title={s.dismiss} onClick={onDismiss}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      {doc.save.state === "conflict" && (
        <div className="bar warn">
          <Icon name="alert" size={14} />
          <span className="msg">{s.conflictBody(doc.name)}</span>
          <span className="actions">
            <button
              type="button"
              className="btn sm outline"
              onClick={() => call("open_notebook", { server: doc.serverId, path: doc.path, reload: true })}
            >
              {s.loadTheirs}
            </button>
            <button type="button" className="btn sm outline" onClick={() => call("save_notebook", { notebook: doc.id, overwrite: true })}>
              {s.keepMine}
            </button>
          </span>
        </div>
      )}
      {doc.save.state === "error" && (
        <div className="bar bad">
          <Icon name="alert" size={14} />
          <span className="msg">{s.saveFailed(doc.save.error ?? "")}</span>
          <button type="button" className="btn sm outline" onClick={() => call("save_notebook", { notebook: doc.id })}>
            {s.tryAgain}
          </button>
        </div>
      )}
      {doc.kernel.status === "dead" && (
        <div className="bar bad">
          <Icon name="alert" size={14} />
          <span className="msg">{s.kernelDead}</span>
          <button type="button" className="btn sm outline" onClick={onRestart}>
            {s.restartKernel}
          </button>
        </div>
      )}
      {doc.kernel.status === "disconnected" && (
        <div className="bar warn">
          <Icon name="alert" size={14} />
          <span className="msg">{s.kernelDisconnected}</span>
        </div>
      )}
    </>
  );
}

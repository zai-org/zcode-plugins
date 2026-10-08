// 活动文档唯一状态机。IO 经端口注入，测试可以精确控制返回顺序。
export interface DocumentPayload {
  document?: { id: string; path: string; revision: number };
  content?: string;
  externalChange?: boolean;
  error?: { code: string; message: string };
}
export interface SessionState {
  id: string;
  path: string;
  revision: number;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
}
interface Ports {
  call: (name: string, args: Record<string, unknown>) => Promise<DocumentPayload>;
  read: (id: string) => Promise<DocumentPayload>;
  getText: () => string;
  setText: (text: string, resetHistory: boolean) => void;
  changed: (phase: "idle" | "saving" | "saved" | "conflict" | "error", message?: string) => void;
  opened: () => void;
}
export class DocumentSession {
  private pending: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private navigation = 0;
  private reading = 0;
  private applying = false;
  private composing = false;
  private acceptedText = "";
  constructor(
    readonly state: SessionState,
    private readonly port: Ports,
  ) {}
  private announce(phase: Parameters<Ports["changed"]>[0], message?: string) {
    this.port.changed(phase, message);
  }
  private cancelTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  private fail(error: unknown) {
    const payload = error as { code?: string; message?: string };
    if (payload.code === "revision_conflict") {
      this.state.conflict = true;
      this.announce("conflict");
    } else this.announce("error", payload.message ?? String(error));
  }
  private async call(name: string, args: Record<string, unknown>) {
    const payload = await this.port.call(name, args);
    if (payload.error) throw payload.error;
    if (!payload.document) throw new Error("Missing document in server response");
    return payload as DocumentPayload & { document: NonNullable<DocumentPayload["document"]> };
  }
  edited() {
    if (this.applying || !this.state.id) return;
    this.state.dirty = this.port.getText() !== this.acceptedText;
    if (!this.state.dirty && !this.state.conflict) {
      this.cancelTimer();
      this.announce("saved");
      return;
    }
    this.announce(this.state.conflict ? "conflict" : "idle");
    this.cancelTimer();
    if (!this.composing && !this.state.conflict)
      this.timer = setTimeout(() => void this.flush(), 800);
  }
  composition(active: boolean) {
    this.composing = active;
    if (active) this.cancelTimer();
    else this.edited();
  }
  flush(): Promise<boolean> {
    this.cancelTimer();
    if (this.pending) return this.pending;
    if (this.composing || this.state.conflict) return Promise.resolve(false);
    // Vditor 的 input 回调有延迟；切换和手动保存必须直接比较编辑器实际文本。
    if (this.state.id) this.state.dirty = this.port.getText() !== this.acceptedText;
    if (!this.state.dirty || !this.state.id) return Promise.resolve(true);
    this.pending = this.drain().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  private async drain() {
    this.state.saving = true;
    try {
      // 单条保存链吸收飞行中输入；第二次防抖触发不能静默丢弃。
      while (this.state.dirty && !this.composing && !this.state.conflict) {
        const id = this.state.id;
        const snapshot = this.port.getText();
        this.announce("saving");
        const payload = await this.call("commit_draft", {
          id,
          content: snapshot,
          expectedRevision: this.state.revision,
        });
        if (this.state.id !== id) return false;
        this.state.revision = payload.document.revision;
        this.acceptedText = snapshot;
        this.state.dirty = this.port.getText() !== snapshot;
      }
      this.announce(this.state.dirty ? "idle" : "saved");
      return !this.state.dirty;
    } catch (error) {
      this.fail(error);
      return false;
    } finally {
      this.state.saving = false;
    }
  }
  private install(payload: DocumentPayload, resetHistory: boolean) {
    if (!payload.document || typeof payload.content !== "string") return false;
    Object.assign(this.state, payload.document, { dirty: false, conflict: false });
    this.applying = true;
    try {
      this.port.setText(payload.content, resetHistory);
      this.acceptedText = this.port.getText();
    } finally {
      this.applying = false;
    }
    this.announce("saved");
    this.port.opened();
    return true;
  }
  async open(load: () => Promise<DocumentPayload>) {
    const request = ++this.navigation;
    if (!(await this.flush()) || request !== this.navigation) return false;
    try {
      const payload = await load();
      if (payload.error) throw payload.error;
      // 用户在打开请求期间继续输入时，再保存旧草稿后才允许替换编辑器。
      if (request !== this.navigation || !(await this.flush()) || request !== this.navigation)
        return false;
      if (payload.document?.id === this.state.id) {
        await this.refresh();
        return true;
      }
      ++this.reading;
      return this.install(payload, true);
    } catch (error) {
      if (request === this.navigation) this.fail(error);
      return false;
    }
  }
  async receive(payload: DocumentPayload) {
    if (!payload.document) return;
    if (payload.document.id !== this.state.id) {
      if (typeof payload.content === "string")
        await this.open(() => this.port.read(payload.document!.id));
    } else await this.refresh();
  }
  async refresh() {
    const id = this.state.id;
    const request = ++this.reading;
    if (!id) return;
    // 服务端会先发资源通知再返回保存结果，等待自身保存确认后再比较 revision。
    if (this.pending) await this.pending;
    if (request !== this.reading || id !== this.state.id) return;
    try {
      const payload = await this.port.read(id);
      if (request !== this.reading || id !== this.state.id || !payload.document) return;
      if (this.pending) {
        await this.refresh();
        return;
      }
      if (payload.document.revision <= this.state.revision) return;
      this.state.dirty = this.port.getText() !== this.acceptedText;
      if (this.state.dirty || this.composing) {
        this.cancelTimer();
        this.state.conflict = true;
        this.announce("conflict");
      } else this.install(payload, false);
    } catch (error) {
      if (id === this.state.id && request === this.reading) this.fail(error);
    }
  }
  async resolve(strategy: "reload" | "overwrite") {
    if (!this.state.id || this.pending || this.composing) return false;
    this.cancelTimer();
    const id = this.state.id;
    const snapshot = this.port.getText();
    const operation = async () => {
      this.state.saving = true;
      this.announce("saving");
      try {
        const payload = await this.call("resolve_conflict", { id, strategy, content: snapshot });
        if (id !== this.state.id) return false;
        this.state.revision = payload.document.revision;
        this.state.conflict = false;
        // 等待 reload 期间新输入不能丢；保留当前文本，要求再次明确决定。
        if (strategy === "reload" && this.port.getText() !== snapshot) {
          this.state.conflict = true;
          this.announce("conflict");
          return false;
        }
        if (strategy === "reload") return this.install(payload, true);
        this.acceptedText = snapshot;
        this.state.dirty = this.port.getText() !== snapshot;
        if (this.state.dirty) return await this.drain();
        this.announce("saved");
        return true;
      } catch (error) {
        this.fail(error);
        return false;
      } finally {
        this.state.saving = false;
      }
    };
    this.pending = operation().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}

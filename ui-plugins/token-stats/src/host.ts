// 仅声明 Token Stats 消费的宿主边界。运行时上下文由 ZCode 注入。
export interface Disposable {
  dispose(): void;
}

type Subscription<T> = (listener: (event: T) => void) => Disposable;

interface WorkspaceRef {
  workspacePath: string;
  workspaceIdentity?: string;
}

type CommandScope =
  | { kind: "app" }
  | { kind: "workspace"; workspace: WorkspaceRef }
  | { kind: "session"; sessionId: string };

interface GenerationSample {
  sessionId: string;
  requestId: string;
  phase: "streaming" | "final";
  model: { modelId: string };
  outputTokensPerSecond: number;
  outputTokens?: number;
  timeToFirstTokenMs?: number;
}

interface ContextSample {
  sessionId: string;
  phase: "request" | "draft-preview";
  model: { modelId: string };
  measuredAt: number;
  revision: number;
  providerInputTokens?: number;
}

export interface SlotItemPatch {
  text?: string | null;
  tooltip?: string | null;
}

interface DetailsView {
  entry: string;
  tools: Record<
    string,
    {
      inputSchema: { type: "object"; properties: Record<string, unknown>; additionalProperties: boolean };
      run(input: unknown, call: { view: { sessionId?: string } }): unknown;
    }
  >;
}

export interface ExtensionContext {
  extension: { dataPath: string };
  slots: { update(id: string, patch: SlotItemPatch, scope?: { sessionId: string }): void };
  commands: { register(id: string, run: (call: { scope: CommandScope }) => unknown): Disposable };
  views: {
    register(id: string, definition: DetailsView): Disposable;
    open(id: string, scope: "app" | { workspace: WorkspaceRef } | { sessionId: string }): Promise<void>;
  };
  workbench: { onDidChange: Subscription<{ sessions: readonly { sessionId: string }[] }> };
  env: { onDidChange: Subscription<{ locale: string }> };
  models: { onDidGenerate: Subscription<GenerationSample> };
  context: {
    onDidChange: Subscription<{ sessionId: string }>;
    get(input: { sessionId: string }): Promise<ContextSample | null>;
  };
  log: { warn(message: string): void };
}

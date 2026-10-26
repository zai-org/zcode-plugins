export function startFakeZotero(options?: { writes?: boolean; authorize?: "always" | "once" | "deny" | "hang"; apiEnabled?: boolean; version?: string; port?: number }): Promise<{
  url: string;
  storage: string;
  state: any;
  touch(key: string, patch: Record<string, unknown>): void;
  close(): Promise<void>;
}>;

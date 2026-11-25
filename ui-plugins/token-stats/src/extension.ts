import type { Disposable, ExtensionContext } from "./host.js";
import { createComposerStatus } from "./composer.js";
import { REQUEST_LIMIT, toCardMetrics, type SessionMetrics } from "./metrics.js";
import { readMetrics, writeMetrics } from "./storage.js";

let subscriptions: Disposable[] = [];
const pending = new Map<string, Promise<void>>();
const contextReads = new Set<Promise<void>>();

export function activate(ctx: ExtensionContext): void {
  const { dataPath } = ctx.extension;

  const composer = createComposerStatus(ctx.slots, (id) => update(id, (state) => state));
  function update(
    sessionId: string,
    revise: (state: SessionMetrics) => SessionMetrics,
    finalizedRequest?: string,
  ): void {
    // 两类事件共享一个快照。按会话串行读改写，避免其中一类覆盖另一类的更新。
    const previous = pending.get(sessionId) ?? Promise.resolve();
    const job = previous
      .then(async () => {
        const state = await readMetrics(dataPath, sessionId);
        const next = revise(state);
        if (next !== state) await writeMetrics(dataPath, sessionId, next);
        composer.showMeasured(sessionId, toCardMetrics(next), finalizedRequest);
      })
      .catch(() => ctx.log.warn("Token stats could not update a session snapshot"))
      .finally(() => {
        if (pending.get(sessionId) === job) pending.delete(sessionId);
      });
    pending.set(sessionId, job);
  }

  subscriptions = [
    ctx.commands.register("open-stats", ({ scope }) =>
      ctx.views.open(
        "details",
        scope.kind === "session"
          ? { sessionId: scope.sessionId }
          : scope.kind === "workspace"
            ? { workspace: scope.workspace }
            : "app",
      ),
    ),
    ctx.views.register("details", {
      entry: "./dist/details.html",
      tools: {
        snapshot: {
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          run: async (_input, { view }) => {
            const { sessionId } = view;
            if (!sessionId) return toCardMetrics({ requests: [] });
            await pending.get(sessionId);
            return toCardMetrics(await readMetrics(dataPath, sessionId));
          },
        },
      },
    }),
    ctx.workbench.onDidChange(({ sessions }) =>
      composer.showSessions(sessions.map(({ sessionId }) => sessionId)),
    ),
    ctx.env.onDidChange(({ locale }) => composer.setLocale(locale)),
    ctx.models.onDidGenerate((event) => {
      const { sessionId, requestId, outputTokens, outputTokensPerSecond } = event;
      if (event.phase === "streaming") {
        composer.showEstimate(sessionId, { requestId, outputTokensPerSecond });
        return;
      }
      if (outputTokens === undefined) return;

      update(
        sessionId,
        (state) => {
          if (state.requests.some((request) => request.requestId === requestId)) return state;
          const request = {
            requestId,
            modelId: event.model.modelId,
            outputTokens,
            outputTokensPerSecond,
            timeToFirstTokenMs: event.timeToFirstTokenMs,
          };
          return { ...state, requests: [...state.requests, request].slice(-REQUEST_LIMIT) };
        },
        requestId,
      );
    }),
    ctx.context.onDidChange(({ sessionId }) => {
      const read = ctx.context
        .get({ sessionId })
        .then((snapshot) => {
          if (snapshot?.sessionId !== sessionId || snapshot.phase !== "request") return;
          const { providerInputTokens, measuredAt, revision } = snapshot;
          if (providerInputTokens === undefined) return;
          update(sessionId, (state) => {
            const current = state.contextInput;
            // 同一毫秒内也可能收到新快照。时间用于跨进程排序，同一时间用宿主修订号比较。
            if (
              current &&
              (current.measuredAt > measuredAt ||
                (current.measuredAt === measuredAt && (current.revision ?? -1) >= revision))
            )
              return state;
            return {
              ...state,
              contextInput: {
                modelId: snapshot.model.modelId,
                inputTokens: providerInputTokens,
                measuredAt,
                revision,
              },
            };
          });
        })
        .catch(() => ctx.log.warn("Token stats could not read the current context snapshot"))
        .finally(() => {
          contextReads.delete(read);
        });
      contextReads.add(read);
    }),
  ];
}

export async function deactivate(): Promise<void> {
  for (const subscription of subscriptions.splice(0)) subscription.dispose();
  await Promise.all(contextReads);
  await Promise.all(pending.values());
}

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { REQUEST_LIMIT, type SessionMetrics } from "./metrics.js";

const count = z.number().int().nonnegative();
const snapshotSchema = z.object({
  requests: z
    .array(
      z.object({
        requestId: z.string().min(1),
        modelId: z.string(),
        outputTokens: count,
        outputTokensPerSecond: z.number().nonnegative(),
        timeToFirstTokenMs: z.number().nonnegative().optional(),
      }),
    )
    .max(REQUEST_LIMIT),
  contextInput: z
    .object({
      modelId: z.string(),
      inputTokens: count,
      measuredAt: count,
      revision: count.optional(),
    })
    .optional(),
});

function snapshotPath(dataPath: string, sessionId: string): string {
  const sessionKey = createHash("sha256").update(sessionId).digest("hex");
  return join(dataPath, "metrics-v1", `${sessionKey}.json`);
}

export async function readMetrics(dataPath: string, sessionId: string): Promise<SessionMetrics> {
  try {
    const text = await readFile(snapshotPath(dataPath, sessionId), "utf8");
    return snapshotSchema.parse(JSON.parse(text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { requests: [] };
    throw error;
  }
}

export async function writeMetrics(
  dataPath: string,
  sessionId: string,
  state: SessionMetrics,
): Promise<void> {
  await mkdir(join(dataPath, "metrics-v1"), { recursive: true, mode: 0o700 });
  const path = snapshotPath(dataPath, sessionId);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(state), { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

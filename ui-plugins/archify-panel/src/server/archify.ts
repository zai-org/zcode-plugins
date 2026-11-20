import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { archifyCli, workspaceRoot } from './paths.js';

export type DiagramType =
  | 'architecture'
  | 'workflow'
  | 'sequence'
  | 'dataflow'
  | 'lifecycle'
  | 'erd'
  | 'class'
  | 'tree'
  | 'timeline'
  | 'waterfall';

export const diagramTypes: DiagramType[] = [
  'architecture',
  'workflow',
  'sequence',
  'dataflow',
  'lifecycle',
  'erd',
  'class',
  'tree',
  'timeline',
  'waterfall',
];

export interface FinalizeGates {
  validate: string;
  deliver: string;
  check: string;
  'browser-check': string;
}

export interface FinalizeResult {
  ok: boolean;
  status: string;
  type: string;
  quality: string;
  artifactPath: string;
  artifactBytes: number;
  gates: FinalizeGates;
  diagnostics: Array<{ code: string; severity: string; message: string }>;
  visualReview: string;
  durationMs: number;
  /** 浏览器校验因缺少 Chrome 被跳过，产物仍然交付 */
  degraded: boolean;
  error?: string;
}

export interface FinalizeOptions {
  type: DiagramType;
  spec: unknown;
  dir: string;
  slug: string;
  quality: 'standard' | 'showcase';
  repoRoot?: string;
}

function slugify(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || 'diagram';
}

export function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export async function createArtifactDir(type: string, title: string): Promise<{ dir: string; slug: string }> {
  const slug = slugify(title);
  const dir = join(workspaceRoot, '.archify-panel', `${type}-${slug}-${timestamp()}`);
  await mkdir(dir, { recursive: true });
  return { dir, slug };
}

async function runCli(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [archifyCli, ...args], {
      cwd,
      env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => resolvePromise({ code: -1, stdout, stderr: String(error) }));
    child.on('close', (code) => resolvePromise({ code: code ?? 0, stdout, stderr }));
  });
}

/** 跑 finalize 交付一张图；退出码 2 表示浏览器校验被跳过，产物仍然可用 */
export async function finalizeDiagram(options: FinalizeOptions): Promise<FinalizeResult> {
  const { dir, slug } = options;
  const candidatePath = join(dir, 'candidate.json');
  const outputPath = join(dir, `${slug}.html`);
  await writeFile(candidatePath, JSON.stringify(options.spec, null, 2), 'utf8');

  const args = [
    'finalize',
    options.type,
    'candidate.json',
    `${slug}.html`,
    '--json',
    '--quality',
    options.quality,
  ];
  if (options.repoRoot) args.push('--repo-root', options.repoRoot);

  const run = await runCli(args, dir);
  let receipt: Record<string, unknown> | undefined;
  const start = run.stdout.indexOf('{');
  if (start >= 0) {
    try {
      receipt = JSON.parse(run.stdout.slice(start)) as Record<string, unknown>;
    } catch {
      receipt = undefined;
    }
  }

  const gates = (receipt?.gates ?? {}) as Partial<FinalizeGates>;
  const diagnostics = (receipt?.diagnostics ?? []) as FinalizeResult['diagnostics'];
  const artifact = receipt?.artifact as { path?: string; bytes?: number } | undefined;
  const status = String(receipt?.status ?? 'failed');
  const degraded = status === 'skipped' || gates['browser-check'] === 'skipped';

  return {
    ok: run.code === 0 || degraded,
    status,
    type: String(receipt?.type ?? options.type),
    quality: String(receipt?.quality ?? options.quality),
    artifactPath: artifact?.path ?? outputPath,
    artifactBytes: artifact?.bytes ?? 0,
    gates: {
      validate: gates.validate ?? 'not-run',
      deliver: gates.deliver ?? 'not-run',
      check: gates.check ?? 'not-run',
      'browser-check': gates['browser-check'] ?? 'not-run',
    },
    diagnostics,
    visualReview: String(receipt?.visualReview ?? 'not-requested'),
    durationMs: Number(receipt?.durationMs ?? 0),
    degraded,
    error: run.code !== 0 && !degraded ? run.stderr.trim().slice(0, 2000) || run.stdout.trim().slice(0, 2000) : undefined,
  };
}

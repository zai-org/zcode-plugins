import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataRoot } from './paths.js';
import type { FinalizeGates } from './archify.js';

export interface DiagramRecord {
  id: string;
  title: string;
  type: string;
  quality: string;
  htmlPath: string;
  bytes: number;
  createdAt: string;
  gates: FinalizeGates;
  degraded: boolean;
}

interface IndexFile {
  currentId: string | null;
  diagrams: DiagramRecord[];
}

export interface FileHandle {
  name: string;
  mimeType: string;
  bytes: Buffer;
}

const indexPath = join(dataRoot, 'index.json');
const handles = new Map<string, FileHandle>();
const MAX_HANDLES = 8;

async function readIndex(): Promise<IndexFile> {
  try {
    const raw = await readFile(indexPath, 'utf8');
    const parsed = JSON.parse(raw) as IndexFile;
    if (Array.isArray(parsed.diagrams)) return parsed;
  } catch {
    // 索引缺失或损坏时从空索引重建
  }
  return { currentId: null, diagrams: [] };
}

async function writeIndex(index: IndexFile): Promise<void> {
  await mkdir(dataRoot, { recursive: true });
  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
}

export async function addDiagram(record: Omit<DiagramRecord, 'id' | 'createdAt'>): Promise<DiagramRecord> {
  const index = await readIndex();
  const entry: DiagramRecord = {
    ...record,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  index.diagrams = [entry, ...index.diagrams.filter((item) => item.htmlPath !== entry.htmlPath)].slice(0, 50);
  index.currentId = entry.id;
  await writeIndex(index);
  return entry;
}

export async function getDiagram(id: string): Promise<DiagramRecord | undefined> {
  const index = await readIndex();
  return index.diagrams.find((item) => item.id === id);
}

export async function getCurrentDiagram(): Promise<DiagramRecord | undefined> {
  const index = await readIndex();
  if (!index.currentId) return undefined;
  return index.diagrams.find((item) => item.id === index.currentId);
}

export async function setCurrentDiagram(id: string): Promise<DiagramRecord | undefined> {
  const index = await readIndex();
  const entry = index.diagrams.find((item) => item.id === id);
  if (!entry) return undefined;
  index.currentId = id;
  await writeIndex(index);
  return entry;
}

export function putFileHandle(handle: FileHandle): string {
  const token = randomUUID();
  handles.set(token, handle);
  while (handles.size > MAX_HANDLES) {
    const oldest = handles.keys().next().value;
    if (oldest) handles.delete(oldest);
  }
  return token;
}

export function getFileHandle(token: string): FileHandle | undefined {
  return handles.get(token);
}

#!/usr/bin/env node
// Prints the official Remotion skill names recorded in
// compatibility/remotion.json — the one canonical list.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { skills } = JSON.parse(readFileSync(join(ROOT, 'compatibility', 'remotion.json'), 'utf8'));

if (process.argv.includes('--count')) {
  console.log(skills.count);
} else {
  console.log(skills.names.join(' '));
}

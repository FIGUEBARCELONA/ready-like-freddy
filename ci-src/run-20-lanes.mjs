#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LaneApparatus } from './lib-lane-apparatus.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apparatus = new LaneApparatus(ROOT);
const mode = process.argv.includes('--once') ? 'once' : 'watch';
const intervalSeconds = Number(process.env.RLF_REAPER_INTERVAL_SECONDS || 60);

async function tick() {
  const result = await apparatus.reap({ actor: 'system:20-lane-supervisor' });
  const status = result.summary || await apparatus.status();
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), mode, reaped: result.reaped, revision: status.revision, counters: status.counters }) + '\n');
}

await tick();
if (mode === 'watch') {
  setInterval(() => tick().catch((error) => console.error(JSON.stringify({ at: new Date().toISOString(), error: error.message }))), intervalSeconds * 1000).unref();
  await new Promise(() => {});
}

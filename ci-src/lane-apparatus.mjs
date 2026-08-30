#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LaneApparatus } from './lib-lane-apparatus.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apparatus = new LaneApparatus(ROOT);
const [command = 'status', ...rawArgs] = process.argv.slice(2);

function parseArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (!value.startsWith('--')) { out._.push(value); continue; }
    const key = value.slice(2).replaceAll('-', '_');
    const next = args[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(rawArgs);
const actor = String(args.actor || process.env.RLF_ACTOR || 'operator:cli');
function print(value) { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }
function parsePayload() {
  if (!args.payload) return {};
  try { return JSON.parse(String(args.payload)); }
  catch (error) { throw new Error(`Invalid --payload JSON: ${error.message}`); }
}

try {
  switch (command) {
    case 'init':
      print(await apparatus.initialize({ actor, force: Boolean(args.force), waveFile: args.wave ? path.resolve(String(args.wave)) : undefined }));
      break;
    case 'sync':
      print(await apparatus.sync({ actor, waveFile: args.wave ? path.resolve(String(args.wave)) : undefined }));
      break;
    case 'status':
      print(await apparatus.status({ include_tasks: Boolean(args.tasks) }));
      break;
    case 'check': {
      const status = await apparatus.status();
      if (!Object.values(status.invariants).every(Boolean)) process.exitCode = 2;
      print(status);
      break;
    }
    case 'claim':
      print(await apparatus.claim({ lane_id: String(args.lane || ''), actor, task_id: args.task ? String(args.task) : null, lease_seconds: args.lease_seconds ? Number(args.lease_seconds) : null }));
      break;
    case 'heartbeat':
      print(await apparatus.heartbeat({ task_id: String(args.task || ''), lease_id: String(args.lease || ''), actor, lease_seconds: args.lease_seconds ? Number(args.lease_seconds) : null }));
      break;
    case 'transition':
      print(await apparatus.transition({ task_id: String(args.task || ''), lease_id: String(args.lease || ''), actor, to_status: String(args.to || ''), payload: parsePayload() }));
      break;
    case 'release':
      print(await apparatus.release({ task_id: String(args.task || ''), lease_id: String(args.lease || ''), actor, reason: String(args.reason || 'manual_release') }));
      break;
    case 'reap':
      print(await apparatus.reap({ actor }));
      break;
    case 'events':
      print(await apparatus.events({ limit: Number(args.limit || 100), task_id: args.task ? String(args.task) : null }));
      break;
    case 'snapshot':
      print(await apparatus.snapshot({ actor }));
      break;
    case 'publish':
      await apparatus.publish();
      print({ published: true });
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, command, error: error.message }, null, 2));
  process.exitCode = 1;
}

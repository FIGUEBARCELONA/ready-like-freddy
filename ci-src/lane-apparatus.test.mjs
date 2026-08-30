import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LaneApparatus } from '../scripts/lib-lane-apparatus.mjs';

function makeWave({ duplicateDomain = false } = {}) {
  const lanes = Array.from({ length: 20 }, (_, laneIndex) => ({
    lane_id: `LANE-${String(laneIndex + 1).padStart(2, '0')}`,
    status: 'active',
    tasks: Array.from({ length: 2 }, (_, positionIndex) => {
      const n = laneIndex * 2 + positionIndex + 1;
      const domain = duplicateDomain && n === 2 ? 'supplier-1.example' : `supplier-${n}.example`;
      return {
        task_id: `task-${n}`,
        supplier_id: `supplier-${n}`,
        member_supplier_ids: [`supplier-${n}`],
        trading_name: `Supplier ${n}`,
        candidate_country: 'ES',
        countries_observed: ['ES'],
        domain,
        source_url: `https://${domain}`,
        priority_score: 100 - n,
        status: 'queued',
        current_decision: 'not_verified',
        next_gate: 'legal_identity_and_eu_country',
        unmet_gates: ['legal_identity_and_eu_country'],
        evidence_count: 0,
        network_seed: `domain:${domain}`,
        preflight_flags: [],
        position: positionIndex + 1,
      };
    }),
  }));
  return { wave_id: 'TEST-WAVE-001', lanes };
}

async function fixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rlf-lanes-'));
  await mkdir(path.join(root, 'tracker'), { recursive: true });
  await mkdir(path.join(root, 'client', 'public'), { recursive: true });
  await writeFile(path.join(root, 'tracker', 'active-wave.json'), JSON.stringify(makeWave(options), null, 2));
  return { root, apparatus: new LaneApparatus(root) };
}

test('initializes exactly 20 non-overlapping persistent lanes', async () => {
  const { apparatus } = await fixture();
  const result = await apparatus.initialize({ actor: 'test:init' });
  assert.equal(result.lane_count, 20);
  assert.equal(result.counters.total, 40);
  assert.ok(Object.values(result.invariants).every(Boolean));
  const assignments = (await readFile(apparatus.assignmentsFile, 'utf8')).trim().split('\n');
  assert.equal(assignments.length, 40);
});

test('rejects a wave with a duplicated canonical domain', async () => {
  const { apparatus } = await fixture({ duplicateDomain: true });
  await assert.rejects(() => apparatus.initialize({ actor: 'test:init' }), /duplicate (domain|network_seed)/);
});

test('20 lanes can claim concurrently without task overlap', async () => {
  const { apparatus } = await fixture();
  await apparatus.initialize({ actor: 'test:init' });
  const claims = await Promise.all(Array.from({ length: 20 }, (_, i) => apparatus.claim({
    lane_id: `LANE-${String(i + 1).padStart(2, '0')}`,
    actor: `worker:${i + 1}`,
  })));
  assert.equal(new Set(claims.map((claim) => claim.task.task_id)).size, 20);
  const status = await apparatus.status({ include_tasks: true });
  assert.equal(status.counters.leased, 20);
  assert.ok(Object.values(status.invariants).every(Boolean));
});

test('a task cannot be claimed from a different lane', async () => {
  const { apparatus } = await fixture();
  await apparatus.initialize({ actor: 'test:init' });
  await assert.rejects(
    () => apparatus.claim({ lane_id: 'LANE-02', task_id: 'task-1', actor: 'worker:wrong' }),
    /not claimable in LANE-02/,
  );
});

test('verified is fail-closed and requires all gates plus independent review', async () => {
  const { apparatus } = await fixture();
  await apparatus.initialize({ actor: 'test:init' });
  const claim = await apparatus.claim({ lane_id: 'LANE-01', task_id: 'task-1', actor: 'worker:1' });
  await assert.rejects(
    () => apparatus.transition({ task_id: 'task-1', lease_id: claim.lease_id, actor: 'worker:1', to_status: 'verified', payload: {} }),
    /missing passed gates/,
  );
  const config = await apparatus.loadConfig();
  const gate_results = Object.fromEntries(config.required_gates.map((gate) => [gate, { status: 'passed', evidence_ids: [`evidence-${gate}`] }]));
  const result = await apparatus.transition({
    task_id: 'task-1',
    lease_id: claim.lease_id,
    actor: 'worker:1',
    to_status: 'verified',
    payload: {
      gate_results,
      evidence_ids: ['evidence-independent-1', 'evidence-independent-2'],
      primary_reviewer: 'reviewer:primary',
      second_reviewer: 'reviewer:independent',
      decision_reason: 'All mandatory supplier census gates are independently supported and passed.',
      priority_signals: { similar_brands_catalogue: true },
    },
  });
  assert.equal(result.task.status, 'verified');
  assert.match(result.task.verification.decision_hash, /^[a-f0-9]{64}$/);
});

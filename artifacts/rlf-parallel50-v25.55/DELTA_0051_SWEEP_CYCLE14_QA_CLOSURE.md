# DELTA 0051 — SWEEP CYCLE 14 QA CLOSURE

Date: 2026-08-24
Run: `wrun_01M0TW6TX73T3A9TK8YT4QWB6D`
Campaign: `RLF-P50-SWEEP-V255531-20260824215314-70d29ca7`
Execution profile: `EU27_BING_PRIMARY_ZERO_FALLBACK_V16`
Execution: Vercel Workflow 4.8.4, 50 real lanes, 0 simulated workers.

## Terminal metrics

- Started: 2026-08-24T21:53:16.825Z
- Completed: 2026-08-24T21:55:48.802Z
- Lane executions: 50
- Raw candidates: 15
- Unique candidates: 14
- Unique domains: 14
- Unique identity keys: 3
- Qualified provisional: 0
- Duplicate known: 2
- Duplicate identity within sweep: 0
- Identity quarantine: 0
- Direct product provisional: 0
- Evidence incomplete: 0
- Rejected marketplaces: 0
- Rejected not PRELOVED: 12
- Rejected UK: 0
- Rejected non-EU: 0
- Fetch failed: 0
- Search errors: 46
- Zero-result lanes: 43
- Evidence records: 32

## Provider performance

### Bing RSS

- Attempts: 100
- HTTP 200: 100
- Relevant links: 33
- Challenges: 1
- Transport errors: 0
- Aggregate duration: 14,874 ms

### Yahoo fallback

- Attempts: 92
- HTTP 200: 13
- Relevant links: 0
- Challenges: 0
- Transport errors: 0
- Aggregate duration: 13,555 ms

## QA decision

No domain required manual supplier adjudication:

- There were no `QUALIFIED_PROVISIONAL` candidates.
- There were no `EVIDENCE_INCOMPLETE` candidates.
- The two duplicates were already materialized canonical suppliers: `96casual.de` and the Sellpy alias `sellpy.se`.
- The remaining twelve candidates were new-retail or previously rejected non-PRELOVED noise.

No supplier was added and no canonical count was changed.

## Efficiency comparison against cycle 13

Cycle 13 baseline:

- Raw candidates: 52
- Unique candidates: 46
- Unique domains: 45
- Search errors: 48
- Zero-result lanes: 35
- Fetch failures: 2
- Evidence records: 123
- Yahoo attempts/relevant links: 100 / 7

Cycle 14 V16:

- Raw candidates: 15
- Unique candidates: 14
- Unique domains: 14
- Search errors: 46
- Zero-result lanes: 43
- Fetch failures: 0
- Evidence records: 32
- Yahoo attempts/relevant links: 92 / 0

Interpretation:

- Fetch stability improved from 2 failures to 0.
- Search errors decreased slightly from 48 to 46.
- Blind Yahoo use decreased by 8 attempts, but the fallback still produced zero useful links and consumed 13,555 ms aggregate provider time.
- Candidate volume and coverage decreased materially; therefore V16 is not accepted as the final search strategy.
- The next profile must remove zero-result Yahoo fallback and replace it with contextual Bing recovery queries that preserve EU-27 and PRELOVED constraints.

## Canonical state after cycle 14

- Qualified supplier identities: 154
- Materialized supplier domains: 99
- Materialized alias domains: 8
- Materialized identity keys: 22
- Identity quarantine domains: 3
- Ready to merge: 12
- Projected qualified after idempotent merge: 166
- Remaining to 10,000: 9,834
- Accepted product pool: 0
- Live products: 0
- Reserves: 0

No product has been promoted to the 4,000-product accepted pool. Replacement source remains fail-closed as `ACCEPTED_4K_ONLY`.

## Capability closure

- Controller version: `25.55.31`
- Controller QA run: `32781680729`
- Controller artifact: `9539994589`
- Controller digest: `sha256:a6a95f3f9bf4362c6a8129d8198ddee97497369d92502da9d6d92d358d89c463`
- Closure version: `25.55.32`
- Closure commit: `14da676b18d6c2f4b2dc5850cc01ca898fbdb352`
- Closure QA run: `32781900092`
- Closure artifact: `9540070030`
- Closure digest: `sha256:0194d49b7ea65624984465a41c1d960241f55949c3a179e22c54d6ac61647064`
- Production deployment: `dpl_CmD7neTvzqqC2akMEYfQeNLppCBw`
- `/api/health`: version `25.55.32`, `CLOSED/CLOSED`, audit 0.
- Exact retired one-shot capability: HTTP 404.

PR #19 remains unmerged and QA-only.

# DELTA 0051 — SWEEP CYCLE 13 QA CLOSURE

Date: 2026-08-24
Run: `wrun_01M0TSFKWKW1MV4RMYBTSVBC3N`
Campaign: `RLF-P50-SWEEP-V255527R1-20260824210536-8fb47440`
Execution: Vercel Workflow 4.8.4, 50 real lanes, 0 simulated workers.

## Terminal metrics

- Lane executions: 50
- Raw candidates: 52
- Unique candidates: 46
- Unique domains: 45
- Unique identity keys: 4
- Qualified provisional: 0
- Duplicate known: 8
- Duplicate identity within sweep: 0
- Identity quarantine: 0
- Direct product provisional: 0
- Evidence incomplete: 3
- Rejected marketplaces: 0
- Rejected not PRELOVED: 30
- Rejected UK: 3
- Rejected non-EU: 0
- Fetch failed: 2
- Search errors: 48
- Zero-result lanes: 35
- Evidence records: 123

## Manual adjudication

### Accepted supplier

`megasecondhand.cz`

- EU-27 country: Czechia.
- Professional second-hand operator and proprietary e-commerce store.
- Fred Perry evidence: individual FredPerry item listing in the men's second-hand catalogue.
- Direct commerce evidence: proprietary item URLs, basket and checkout instructions.
- Legal identity: Šárka Kejzlarová, Jaselská 821, Jičín 506 01, IČO `75203529`.
- Canonical identity key: `CZ-ICO:75203529`.
- Master and repository exact-key search returned no prior match.
- Decision: `QUALIFIED_MANUAL`, added to canonical registry.

Evidence:
- https://www.megasecondhand.cz/pansky-second-hand/tricka
- https://www.megasecondhand.cz/o-nas
- https://www.megasecondhand.cz/obchodni-podminky

### Rejected domains

`deblauwezebra.be`

- Retail fashion shop advertising current brand collections including Fred Perry.
- No evidence of a professional second-hand or PRELOVED operating model.
- Decision: `REJECT_NOT_PRELOVED`.

Evidence: https://deblauwezebra.be/

`skroutz.gr`

- General marketplace / price-comparison commerce with multiple third-party shops.
- Fred Perry results are new authorised-retailer products, not a proprietary professional PRELOVED source.
- Decision: `REJECT_MARKETPLACE_OR_NEW_RETAIL` and added to permanent rejection registry.

Evidence: https://www.skroutz.gr/

## Canonical state after adjudication

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

- Closure version: `25.55.28`
- Closure commit: `a9e9b26d0a24cb801ba328d0ea6f1b54193bf3ad`
- Closure QA run: `32777637870`
- Closure artifact: `9538596257`
- Artifact digest: `sha256:59e092e43cf08ae9c23fba128de760ecd2977788ed4bbb6df35a7a3b92437d95`
- Production deployment: `dpl_ELJv6nVghCQf8tkXowQAnnfzQiwK`
- Deployment state: `READY`
- `/api/health`: version `25.55.28`, `CLOSED/CLOSED`, audit 0.
- Retired `/api/one-shot/*` route verification: HTTP 404.

PR #19 remains unmerged and is QA-only.

# DELTA 0051 — SWEEP CYCLE 20 QA CLOSURE

Date: 2026-08-25
Campaign: `RLF-P50-TARGETED-V255554-20260825143831-26244749`
Run: `wrun_01M0WNQJGG05RZQE3GR7MXG368`
Profile executed: `EU27_TARGETED_DIRECT_BRAND_VERIFICATION_V23`
Production closure: `25.55.55 CLOSED/CLOSED`

## Execution integrity

- Parallel lanes: 50 real lanes
- Simulated lanes: 0
- Lane executions: 50
- Raw candidates: 50
- Unique candidates: 50
- Unique domains: 50
- Evidence records: 310
- Unique identity keys extracted: 7
- Zero-result lanes: 0
- Qualified provisional: 0
- Direct product provisional: 0
- Promoted suppliers: 0
- Promoted products: 0

## Transport and adapter telemetry

- Home probes: 50 attempts, 42 HTTP 200
- Site-search probes: 50 attempts, 6 HTTP 200
- WooCommerce Store API probes: 24 attempts, 9 HTTP 200, 2 parsed brand links
- WordPress Search API probes: 24 attempts, 24 HTTP 200, 1 parsed brand link
- Robots probes: 50 attempts, 39 HTTP 200
- Generic site-query probes: 25 attempts, 17 HTTP 200
- Sitemap probes: 25 attempts, 13 HTTP 200
- Shopify suggest/products probes: 1 attempt each, both HTTP 200

## Mandatory QA quarantine

The run output exposed a classification defect before any promotion. Only three links were parsed as direct same-domain Fred Perry links in provider telemetry, while the derived candidate field `fredPerryEvidence` was set to true broadly.

Root causes:

1. `homeBrand` treated any Fred Perry string in a fetched home page as direct supplier evidence.
2. The targeted adapter generated a synthetic candidate title containing `Fred Perry` when the derived flag was true.
3. The general assessor could therefore reconsume the injected brand phrase instead of relying exclusively on a captured same-domain product or inventory URL.

Consequences:

- All 50 cycle-20 candidates remain `EVIDENCE_INCOMPLETE`.
- No supplier is added to the canonical count.
- No product is added to the pool.
- The reported per-candidate `fredPerryEvidence` values from V23 are quarantined and must not be used for acceptance.
- The only currently visible direct product URL is `yesterdaysbread.gr/product/fred-perry-light-down-womens-jacket`; it still fails the professional PRELOVED and other acceptance gates and is not promoted.

## Required correction

V23R1 must:

- activate Fred Perry evidence only from one or more captured same-domain brand/product URLs;
- remove `homeBrand` as an acceptance signal;
- never inject the brand into a synthetic title or snippet;
- overwrite the assessor result with a fail-closed direct-brand gate;
- cap non-direct candidates as `EVIDENCE_INCOMPLETE`;
- preserve all probe URLs, status codes and SHA-256 evidence;
- expose a compact direct-brand review view for manual adjudication.

## Funnel after closure

- Qualified suppliers: 154
- READY_TO_MERGE: 12
- Projected qualified: 166
- Remaining to 10,000: 9,834
- Accepted product pool: 0
- Live selection: 0
- Reserves: 0

No canonical count has been inflated.

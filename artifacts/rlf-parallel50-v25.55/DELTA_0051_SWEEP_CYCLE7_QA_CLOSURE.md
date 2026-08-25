# Delta 0051 — SWEEP50 cycle 7 QA closure

Date: 2026-08-24
Runtime run: `wrun_01M0TAPQKVJYY9QKZPKZ5PPTM5`
Campaign: `RLF-P50-SWEEP-V25559-20260824164721-bdc285c2`
Search profile executed: `EU27_STRICT_IDENTITY_V8`

## Execution evidence

- Parallelism: 50 real lanes.
- Simulated workers: 0.
- Lane executions: 50.
- Raw candidates: 39.
- Unique candidates: 34.
- Unique domains: 34.
- Extracted identity keys: 4.
- Evidence records: 92.
- Completed: 2026-08-24T16:49:01.576Z.

## Classification

- QUALIFIED_PROVISIONAL: 0.
- DUPLICATE_KNOWN: 3.
- DUPLICATE_IDENTITY_IN_SWEEP: 0.
- QUARANTINE_IDENTITY: 0.
- DIRECT_PRODUCT_PROVISIONAL: 0.
- EVIDENCE_INCOMPLETE: 15.
- REJECT_NOT_PRELOVED: 8.
- REJECT_UK: 5.
- REJECT_NON_EU: 0.
- FETCH_FAILED: 3.
- Zero-result lanes: 38.
- Search errors: 55.

## QA findings

No candidate reached provisional supplier status and no manual promotion was possible.

The sweep identified four residual parser-quality issues that did not alter the canonical count but required correction before cycle 8:

1. An unlabelled phrase was parsed as `DE-REG:LITYIN2020WITHTH`.
2. A UK retail page produced `NON_EU-REG:11116145VATNUMBER`.
3. A French directory page inherited `EU-VAT:RO888207859` from embedded third-party text.
4. Contractual arbitration text generated a synthetic `NAME-ADDRESS` identity.

Additional deduplication and source-policy findings:

- Sellpy country storefronts are aliases of the canonical `sellpy.com` operator and must never increment supplier identity counts.
- Pappers, Le Figaro Entreprises, Annuaire des Entreprises and Pages Jaunes are directories, not RLF suppliers.
- KuantoKusta and KurPirkt are comparison/aggregation services, not suppliers.
- Stockmann, LUC, Sportus, El Corte Inglés, La Redoute, RIHU and SAROS are first-hand retail in the observed evidence.
- UK determination must require a UK domain, explicit legal declaration or a postcode inside a contextual address field. A bare postcode-shaped string is insufficient.

## Canonical result

- Accepted additions to Delta 0051: **0**.
- Canonical qualified suppliers remain: **151**.
- READY_TO_MERGE remains: **12**.
- Projected count after a future real idempotent merge remains: **163**.
- Remaining to 10,000 remains: **9,837**.
- ACCEPTED_4K / live / reserves remain: **0 / 0 / 0**.

## Cycle 8 prerequisite

Runtime `v25.55.11`, profile `EU27_CONTEXTUAL_COUNTRY_IDENTITY_V9`, must pass all regression fixtures, TypeScript, Next production build, Workflow manifest `6 steps, 2 workflows`, and dependency audit before cycle 8 can be armed.

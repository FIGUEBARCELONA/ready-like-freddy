# Delta 0051 — SWEEP50 cycle 6 QA closure

Date: 2026-08-24
Runtime run: `wrun_01M0T9ZY5Y14T9QJPY984YS38P`
Campaign: `RLF-P50-SWEEP-V25556-20260824163454-cf6391b7`
Search profile executed: `EU27_IDENTITY_DEDUP_QUARANTINE_V7`

## Execution evidence

- Parallelism: 50 real lanes.
- Simulated workers: 0.
- Lane executions: 50.
- Raw candidates: 47.
- Unique candidates: 37.
- Unique domains: 36.
- Extracted identity keys: 18.
- Evidence records: 110.
- Completed: 2026-08-24T16:35:22.681Z.

## Automated classification

- QUALIFIED_PROVISIONAL: 1.
- DUPLICATE_KNOWN: 7.
- DUPLICATE_IDENTITY_IN_SWEEP: 5.
- EVIDENCE_INCOMPLETE: 11.
- REJECT_NOT_PRELOVED: 6.
- REJECT_UK: 7.
- REJECT_MARKETPLACE: 0 in the executed V7 policy.
- Direct product provisional: 0.

## Manual AAA adjudication

The only provisional candidate was `one4all.mt` at `https://one4all.mt/directories/fred-perry`.

Decision: **REJECT — NOT A PROFESSIONAL PRELOVED SUPPLIER**.

Grounds:

1. The target is a Fred Perry listing in a gift-voucher directory, not a curated second-hand/preloved operator.
2. It exposes no unique preloved product inventory and no direct qualifying product page.
3. `availableProductSignals` was 0 and `productEvidence` was `SUPPLIER_EVIDENCE_ONLY`.
4. The extracted identity `EU-VAT:SKIPTOCONTENT` / `vatId=SKIPTOCONTENT` was a parser false positive caused by interpreting the `SK` prefix of ordinary page text as Slovakia.
5. The evidence page itself contained a plausible Malta number (`MT 1724-3326`), but a valid legal identity does not convert a voucher directory into a qualifying RLF supplier.

Target evidence SHA-256: `7691d257cdc6d5b7085fc104f11d1347463330547783bae91cd936804f175191`.

## Canonical result

- Accepted additions to Delta 0051: **0**.
- Canonical qualified suppliers remain: **151**.
- READY_TO_MERGE remains: **12**.
- Projected count after a future real idempotent merge remains: **163**.
- Remaining to 10,000 remains: **9,837**.
- ACCEPTED_4K / live / reserves remain: **0 / 0 / 0**.

No product was promoted and no canonical count was incremented.

## Corrective action for cycle 7

Runtime `v25.55.8` / profile `EU27_STRICT_IDENTITY_V8` must pass before any subsequent sweep. It:

- replaces broad prefix-based VAT extraction with country-format-specific VAT patterns;
- requires labelled registration identifiers with minimum numeric content;
- emits canonical local identity prefixes such as `PL-NIP`, `FR-SIRET`, `CZ-ICO`, `RO-CUI`, `IT-PIVA`, `NL-KVK` and `ES/PT-NIF`;
- rejects `one4all.mt` as a non-supplier directory;
- rejects `vendora.bg` and `bazar.bg` as generalist marketplaces;
- keeps public bootstrap and one-shot controller CLOSED.

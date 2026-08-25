# Delta 0051 — SWEEP50 cycle 9 QA closure

Date: 2026-08-24
Runtime run: `wrun_01M0TD28K4G1QP7BSPY7A3Z9TF`
Campaign: `RLF-P50-SWEEP-V255515-20260824173047-379eb5c2`
Search profile executed: `EU27_FAIL_CLOSED_IDENTITY_V10`

## Execution evidence

- Parallelism: 50 real lanes.
- Simulated workers: 0.
- Lane executions: 50.
- Raw candidates: 73.
- Unique candidates: 50.
- Unique domains: 47.
- Extracted identity keys: 2.
- Evidence records: 142.
- Started: 2026-08-24T17:30:49.032Z.
- Completed: 2026-08-24T17:31:31.935Z.

## Automated classification

- QUALIFIED_PROVISIONAL: 2.
- DUPLICATE_KNOWN: 9.
- DUPLICATE_IDENTITY_IN_SWEEP: 0.
- QUARANTINE_IDENTITY: 0.
- DIRECT_PRODUCT_PROVISIONAL: 2.
- EVIDENCE_INCOMPLETE: 16.
- REJECT_MARKETPLACE: 2.
- REJECT_NOT_PRELOVED: 13.
- REJECT_UK: 8.
- REJECT_NON_EU: 0.
- FETCH_FAILED: 0.
- Zero-result lanes: 31.
- Search errors: 50.

## Manual AAA adjudication

### `weighnpay.ie`

Automated result: `QUALIFIED_PROVISIONAL`.

Manual decision: **DUPLICATE — ALREADY QUALIFIED IN THE CANONICAL SOURCE DATA**.

Grounds:

1. `suppliers_batch_d.csv` already contains `supplier-weighnpay-ie-v1`, Weigh N Pay Clothing, country IE, status QUALIFIED, professional/preloved/Fred Perry evidence all true.
2. `products_batch_d.csv` already contains direct active Fred Perry product records for the operator.
3. The official terms identify Cliché Vintage Limited, Irish company number `599102`, VAT `IE9331506J`, and a Dublin address.
4. Current official product pages expose unique vintage Fred Perry items, price, condition/measurements, SKU and add-to-cart.
5. The cycle-9 identity `IE-REG:599102ANDOUR` was an extraction defect. The canonical registration is now typed as `IE-CRO:599102`; the VAT key is `EU-VAT:IE9331506J`.

No supplier count is incremented.

### `ladc.be`

Automated result: `QUALIFIED_PROVISIONAL`.

Manual decision: **REJECT — FIRST-HAND MULTIBRAND RETAIL, NOT PROFESSIONAL PRELOVED**.

Grounds:

1. LADC is a Belgian clothing retailer legally identified as LADC SRL, VAT `BE0671531592`.
2. Its official site describes recurring new arrivals and a conventional multi-brand prêt-à-porter catalogue.
3. `April Vintage` is a commercial fashion brand/collection sold by LADC, not evidence of second-hand or preloved operations.
4. The Fred Perry item observed is presented inside the site's `Nouvelle collection`/discount retail catalogue; no used condition, prior ownership, consignment, intake or second-hand operating model is evidenced.
5. A valid legal identity and direct checkout are insufficient when the PRELOVED gate fails.

The domain is added to the first-hand/non-preloved rejection registry. No supplier or product is promoted.

## Canonical result

- Accepted additions to Delta 0051: **0**.
- Canonical qualified suppliers remain: **151**.
- READY_TO_MERGE remains: **12**.
- Projected count after a future real idempotent merge remains: **163**.
- Remaining to 10,000 remains: **9,837**.
- ACCEPTED_4K / live / reserves remain: **0 / 0 / 0**.

## Corrective action for cycle 10

- Materialize `weighnpay.ie` as a known canonical domain without changing the canonical count.
- Materialize `IE-CRO:599102` and `EU-VAT:IE9331506J` as known identity keys.
- Add an Irish CRO-specific registration parser.
- Prevent generic company-number extraction from absorbing adjacent prose such as `ANDOUR`.
- Add `ladc.be` to the non-preloved/first-hand rejection registry.
- Require the expanded regression suite, TypeScript, Workflow manifest `6 steps, 2 workflows`, and dependency audit before any cycle 10 execution.

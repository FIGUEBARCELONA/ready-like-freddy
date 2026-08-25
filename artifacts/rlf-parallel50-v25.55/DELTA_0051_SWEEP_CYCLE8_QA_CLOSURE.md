# Delta 0051 — SWEEP50 cycle 8 QA closure

Date: 2026-08-24
Runtime run: `wrun_01M0TCH7KDYYZCGYHEV43Y5C8F`
Campaign: `RLF-P50-SWEEP-V255512-20260824171918-a90643cb`
Search profile executed: `EU27_CONTEXTUAL_COUNTRY_IDENTITY_V9`

## Execution evidence

- Parallelism: 50 real lanes.
- Simulated workers: 0.
- Lane executions: 50.
- Raw candidates: 37.
- Unique candidates: 32.
- Unique domains: 29.
- Extracted identity keys: 3.
- Evidence records: 89.
- Started: 2026-08-24T17:19:20.499Z.
- Completed: 2026-08-24T17:19:51.947Z.

## Classification

- QUALIFIED_PROVISIONAL: 0.
- DUPLICATE_KNOWN: 8.
- DUPLICATE_IDENTITY_IN_SWEEP: 0.
- QUARANTINE_IDENTITY: 0.
- DIRECT_PRODUCT_PROVISIONAL: 0.
- EVIDENCE_INCOMPLETE: 8.
- REJECT_NOT_PRELOVED: 10.
- REJECT_UK: 6.
- REJECT_NON_EU: 0.
- FETCH_FAILED: 0.
- Zero-result lanes: 39.
- Search errors: 50.

## AAA adjudication

No candidate reached provisional supplier status and no canonical promotion was made.

Two potentially relevant operators remain outside the canonical count pending independent legal and commercial evidence review:

1. `vintagie.com`: Fred Perry vintage collection and a detected Netherlands registration `NL-KVK:85882623`, but professional/direct-product evidence was incomplete in this sweep.
2. `vintagewholesalespain.com`: professional vintage wholesale evidence and an address in Valencia, Spain, but V9 misclassified it as UK because generic shipping text contained United Kingdom. It is not accepted or rejected canonically from this run.

The following findings were converted into V10 controls:

- UK classification requires a UK domain, a strong company-incorporation declaration, or a contextual UK registered/business-office postcode. Shipping-country lists do not establish contracting jurisdiction.
- EU country-code domains remain EU unless a strong UK company declaration proves otherwise.
- Automatic identity keys are now restricted to validated EU VAT or labelled registration identifiers.
- `NAME_ADDRESS` no longer produces an automatic canonical identity.
- Sellpy national storefronts remained correctly deduplicated as aliases.
- First-hand retail noise observed from Care of Carl, JD Sports, Sokos, Spartoo, Kastner & Öhler and Peek & Cloppenburg is explicitly excluded.
- Joli Closet and Linktree are excluded as marketplace/directory sources.

## Canonical result

- Accepted additions to Delta 0051: **0**.
- Canonical qualified suppliers remain: **151**.
- READY_TO_MERGE remains: **12**.
- Projected count after a future real idempotent merge remains: **163**.
- Remaining to 10,000 remains: **9,837**.
- ACCEPTED_4K / live / reserves remain: **0 / 0 / 0**.

## Cycle 9 prerequisite

Runtime `v25.55.14`, profile `EU27_FAIL_CLOSED_IDENTITY_V10`, must pass the complete regression suite, TypeScript, Next production build, Workflow manifest `6 steps, 2 workflows`, and dependency audit before any cycle 9 controller may be armed.

# DELTA 0051 — SWEEP50 CYCLE 10 QA CLOSURE

## Authority
- Policy: APPEND_ONLY_FAIL_CLOSED
- Run ID: `wrun_01M0TK4XS95SRCRRSG3HFJE162`
- Campaign: `RLF-P50-SWEEP-V255518-20260824191454-b876befc`
- Started: `2026-08-24T19:14:56.999Z`
- Completed: `2026-08-24T19:16:24.166Z`
- Parallelism: 50 real lanes
- Simulated workers: 0
- Terminal state: completed

## Terminal metrics
- Lane executions: 50
- Raw candidates: 95
- Unique candidates: 82
- Unique domains: 78
- Unique identity keys: 7
- Qualified provisional: 0
- Direct product provisional: 0
- Duplicate known: 12
- Duplicate identity within sweep: 0
- Identity quarantine: 0
- Evidence incomplete: 33
- Rejected marketplaces: 0
- Rejected not PRELOVED: 22
- Rejected UK: 12
- Rejected non-EU: 1
- Fetch failed: 2
- Search errors: 48
- Zero-result lanes: 28
- Evidence records: 228

## Search-provider telemetry
### Bing RSS
- Attempts: 100
- HTTP 200: 100
- Relevant links: 100
- Errors: 0

### Yahoo
- Attempts: 100
- HTTP 200: 62
- Relevant links: 112
- Errors: 0

## Canonical adjudication
- Accepted new suppliers: **0**
- Promoted products: **0**
- Canonical qualified supplier count remains: **151**
- READY_TO_MERGE remains: **12**
- Projected count after a real idempotent merge remains: **163**
- Remaining to 10,000 remains: **9,837**
- ACCEPTED_4K / live / reserves remain: **0 / 0 / 0**

No candidate was promoted because the sweep produced zero `QUALIFIED_PROVISIONAL` records. No count was inferred from incomplete evidence.

## Defects discovered and closed in V12
1. External legal-page contamination: links such as `judge.me/terms`, LinkedIn and unrelated CDN resources could be selected as operator legal evidence.
2. Invalid legal MIME: CSS and other non-legal resource types could satisfy URL-based heuristics.
3. Generic registration overcapture: unlabelled `company number` or `registration number` strings could create `${country}-REG` identities.
4. Search-result noise: commerce and PRELOVED signals could be influenced by snippets rather than only by first-party store pages.
5. Known cycle-10 marketplace, directory and first-hand retail noise was materialized into deterministic exclusion policy without changing the canonical supplier count.

## V12 fail-closed controls
- Legal evidence must remain on the same registrable domain before and after redirects.
- Legal evidence content type must be HTML, XHTML or plain text.
- External Judge.me, LinkedIn, CDN and redirect targets cannot establish identity.
- Automatic registration identity requires a supported country-specific label: NIP, SIRET/SIREN, IČO, CUI, Partita IVA, KVK, Organisationsnummer, German register label, Irish CRO when country is already IE, or NIF/CIF where supported.
- Generic `${country}-REG` creation is removed.
- PRELOVED, professional and purchase signals are evaluated from first-party target/home/Shopify content, not search snippets or external legal text.

## Integrity statement
This closure does not promote a supplier or product, does not merge the draft PR, does not alter the canonical count and does not activate the replacement engine. All future additions remain subject to complete master deduplication and manual legal QA.

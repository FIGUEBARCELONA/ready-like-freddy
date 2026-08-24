# DELTA 0051 — SWEEP CYCLE 15 — QA CLOSURE

## Truth boundary

- Production runtime before adjudication: `25.55.35`.
- Search profile executed: `EU27_CONTEXTUAL_BING_RECOVERY_V17`.
- Durable run: `wrun_01M0TXHJT5XYPBXQSSBBW25XN7`.
- Campaign: `RLF-P50-SWEEP-V255534R1-20260824221635-4ef2c8ed`.
- Started: `2026-08-24T22:16:37.551Z`.
- Completed: `2026-08-24T22:16:43.848Z`.
- Parallelism: 50 real lanes.
- Simulated workers: 0.
- One-shot controller: invoked exactly once and removed.
- Exact retired capability: verified HTTP 404 after closure.
- PR #19 remains draft and unmerged.

## Terminal metrics

| Metric | Value |
|---|---:|
| lane executions | 50 |
| raw candidates | 1 |
| unique candidates | 1 |
| unique domains | 1 |
| unique identity keys | 0 |
| qualified provisional | 0 |
| direct-product provisional | 0 |
| evidence incomplete | 0 |
| duplicate known | 0 |
| marketplace rejects | 0 |
| not-preloved rejects produced automatically | 0 |
| UK rejects | 0 |
| non-EU rejects | 0 |
| fetch failed | 1 |
| zero-result lanes | 49 |
| search error records | 50 |
| evidence records | 1 |

## Search provider telemetry

| Provider | Attempts | HTTP 200 | Relevant links | Challenges | Transport errors | Aggregate duration ms |
|---|---:|---:|---:|---:|---:|---:|
| Bing RSS | 149 | 149 | 1 | 1 | 0 | 20,642 |

## Candidate adjudication

### `hof.sk` — REJECT_NOT_PRELOVED / NEW_RETAIL

- Discovered URL: `https://www.hof.sk/kolekcie/fredperry`.
- Automated status: `FETCH_FAILED`; this status did not qualify or count the domain.
- Manual official-site review found a normal Fred Perry retail collection, sale pricing, cart and checkout controls, physical retail locations and a legally identified operator.
- Contracting operator: British Classics s.r.o.
- IČO: `35883189`.
- DIČ / VAT signal: `SK2021845221`.
- The site presents current/new retail and outlet merchandise. No professional second-hand, preloved or vintage-resale operating model was evidenced.
- Canonical decision: add `hof.sk` to `KNOWN_REJECTED_DOMAINS` and `NEW_RETAIL`.
- Supplier count change: 0.
- Product pool promotions: 0.

## Canonical funnel after cycle 15

| Funnel stage | Count |
|---|---:|
| qualified suppliers | 154 |
| ready to merge | 12 |
| projected qualified after idempotent merge | 166 |
| remaining to 10,000 | 9,834 |
| accepted product pool | 0 |
| live selection | 0 |
| reserves | 0 |

## Performance diagnosis

V17 is closed as low-yield. Its contextual recovery generated 49 additional searches after empty primary/identity paths, yet the complete 149-attempt campaign produced only one eligible domain and that domain was new retail. Repeating the same profile would waste search capacity and concentrate the 50-lane dashboard on saturated result pages.

## V18 corrective action

Profile `EU27_ADAPTIVE_DIRECT_COMMERCE_V18`:

1. Remove the separate search-engine legal query. Legal identity is still collected from the candidate domain by the evidence bundle.
2. Use one country-localized direct-commerce query per lane.
3. Use one alternative country-localized query only when the primary query yields zero eligible domains.
4. Cap search attempts at two per lane rather than three.
5. Preserve all marketplace, new-retail, known-supplier, staged-supplier and known-rejection prefetch filters.
6. Keep all acceptance decisions manual and fail closed.
7. Keep 50 real parallel lanes and zero simulated workers.

No supplier or product has been promoted by this closure artifact.

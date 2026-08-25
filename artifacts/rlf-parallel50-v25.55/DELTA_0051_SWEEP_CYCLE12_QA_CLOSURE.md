# Delta 0051 — SWEEP50 cycle 12 QA closure

## Immutable run record

- Run ID: `wrun_01M0TRHJGFS4GHR8M8HM8PM3N2`
- Campaign: `RLF-P50-SWEEP-V255524-20260824204912-5da86981`
- Search profile: `EU27_CONTEXTUAL_LEGAL_V13`
- Started: `2026-08-24T20:49:14.246Z`
- Completed: `2026-08-24T20:51:16.606Z`
- Parallelism: 50 real lanes
- Simulated workers: 0

## Terminal metrics

| Metric | Value |
|---|---:|
| Lane executions | 50 |
| Raw candidates | 32 |
| Unique candidates | 31 |
| Unique domains | 29 |
| Unique identity keys | 4 |
| Qualified provisional by automation | 0 |
| Duplicate known | 1 |
| Duplicate identity within sweep | 0 |
| Identity quarantine | 0 |
| Direct product provisional | 0 |
| Evidence incomplete | 5 |
| Rejected marketplaces | 0 |
| Rejected not PRELOVED | 17 |
| Rejected UK | 7 |
| Rejected non-EU | 1 |
| Fetch failed | 0 |
| Search errors | 51 |
| Zero-result lanes | 40 |
| Evidence records | 84 |

Provider telemetry:

- Bing RSS: 100 attempts, 100 HTTP 200, 54 relevant links, 0 provider errors.
- Yahoo: 100 attempts, 9 HTTP 200, 0 relevant links, 0 provider errors.

## Manual adjudication of the five incomplete domains

### 1. `96casual.de` — QUALIFIED_NEW

- Professional German own-domain ecommerce.
- Official storefront has extensive one-off vintage inventory and multiple individual Fred Perry product pages with sizes, prices, imagery and cart paths.
- Legal evidence captured by the run identifies VAT `DE452397519`.
- Exact master searches found no canonical domain, alias or identity collision.
- Canonical key: `domain:96casual.de`.
- Identity key: `EU-VAT:DE452397519`.
- Counts toward the 10,000-provider objective: **yes**.
- Product-pool promotion: **none**. Every product remains subject to the complete model, MSRP, discount, comparable, cost and net-profit gates.

### 2. `rodekorsgenbrug.dk` — QUALIFIED_NEW

- Røde Kors Genbrug operates an own-domain professional second-hand webshop and Click & Collect network.
- The official site states that clothing is used, sorted and quality checked, with unique item pages, own payment, shipping and returns.
- Official legal identity: Røde Kors, Blegdamsvej 27, 2100 København, CVR `20700211`.
- The sweep fixed a Fred Perry direct product path on the operator domain.
- Exact master searches found no canonical domain or CVR collision.
- Canonical key: `domain:rodekorsgenbrug.dk`.
- Identity key: `DK-CVR:20700211`.
- Counts toward the 10,000-provider objective: **yes**.
- Product-pool promotion: **none**.

### 3. `myrorna.se` — REJECT_MARKETPLACE_DEPENDENT

- Myrorna is a professional second-hand operator and has Fred Perry catalogue evidence.
- Its official purchase flow states that all webshop goods are sold and paid through Tradera.
- Tradera is a prohibited general marketplace under the RLF source canon.
- The operator therefore does not qualify as a direct own-domain supplier source.
- Count increment: **0**.

### 4. `toms-paderborn.de` — REJECT_NOT_PRELOVED

- Official storefront is a conventional streetwear and sneaker retailer presenting current-season/new Fred Perry assortments.
- Legal identity and VAT are valid, but the operating model is not second-hand or PRELOVED.
- Count increment: **0**.

### 5. `prm.com` — REJECT_NOT_PRELOVED

- PRM is a conventional multibrand retailer of new collections, launches and sale inventory.
- Fred Perry stock is first-hand retail, not professional PRELOVED.
- Count increment: **0**.

## Canonical count transition

| State | Before cycle 12 closure | After cycle 12 closure |
|---|---:|---:|
| Qualified canonical suppliers | 151 | 153 |
| READY_TO_MERGE | 12 | 12 |
| Projected after idempotent merge | 163 | 165 |
| Remaining to 10,000 | 9,837 | 9,835 |
| ACCEPTED_4K products | 0 | 0 |
| Live selection | 0 | 0 |
| Reserves | 0 | 0 |

## Controls applied

- EU-27 only.
- UK and non-EU fail closed.
- General marketplaces and marketplace-dependent purchase flows excluded.
- Full-domain and legal-identity deduplication against the available canonical master and materialized runtime registry.
- No supplier accepted solely from a search snippet.
- No product promoted and no economic gate opened.
- New Danish CVR parsing is restricted to explicitly labelled eight-digit identifiers.

## Closure decision

Cycle 12 is **CLOSED_AUDITED** with exactly two net new qualified suppliers. The next sweep must run only after the updated registry, DK-CVR regression suite, closed runtime metadata and CI artifact are all green in production.

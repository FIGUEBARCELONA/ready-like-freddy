# DELTA 0051 — SWEEP CYCLE 19 QA CLOSURE

## Canonical status

- Runtime profile: `EU27_OSM_OVERPASS_BBOX_TILES_V22R2`
- Controller version: `25.55.49`
- Closed production version: `25.55.50`
- Campaign: `RLF-P50-SWEEP-V255549-20260825052232-e1679979`
- Run ID: `wrun_01M0VNXGKMTSAG484467ET9PQY`
- Started: `2026-08-25T05:22:34.317Z`
- Completed: `2026-08-25T05:25:37.529Z`
- Execution: 50 real lanes, 0 simulated workers
- One-shot capability: invoked exactly once, retired, exact retired path verified HTTP 404
- Production after closure: `25.55.50`, `CLOSED/CLOSED`, 5 lambdas, dependency audit 0

## Sweep metrics

| Metric | Result |
|---|---:|
| Lane executions | 50 |
| Raw candidates | 75 |
| Unique candidates | 72 |
| Unique domains | 70 |
| Unique identity keys | 11 |
| Qualified provisional | 0 |
| Direct product provisional | 0 |
| Evidence incomplete | 62 |
| Fetch failed | 10 |
| Search errors | 44 |
| Zero-result lanes | 33 |
| Evidence records | 136 |
| Known duplicates | 0 |
| In-sweep identity duplicates | 0 |
| Identity quarantines | 0 |
| Marketplace rejections after assessment | 0 |
| Non-EU rejections after assessment | 0 |
| UK rejections | 0 |

## Provider telemetry

### `overpass-json:z.overpass-api.de`

- Attempts: 39
- HTTP 200: 12
- Relevant website seeds: 68
- Challenges/runtime remarks: 21
- Transport errors: 10
- Aggregate duration: 352,616 ms
- Status distribution: 200 × 12; 429 × 8; 504 × 9; null × 10

### `overpass-json:overpass-api.de`

- Attempts: 44
- HTTP 200: 23
- Relevant website seeds: 89
- Challenges/runtime remarks: 19
- Transport errors: 9
- Aggregate duration: 445,902 ms
- Status distribution: 200 × 23; 429 × 10; 504 × 2; null × 9

## QA decision

No supplier and no product is promoted.

The source family is technically validated because it produced independent professional second-hand website seeds after the previous search-engine families had become exhausted or blocked. It is not an acceptance source. OpenStreetMap and Overpass are used only to discover candidate websites. Every supplier still requires direct evidence from its own domain proving all applicable canonical conditions.

The 70 unique domains produced zero direct Fred Perry evidence in this cycle. Therefore:

- Canonical qualified supplier count remains 154.
- `READY_TO_MERGE` remains 12.
- Projected qualified count remains 166.
- Remaining to 10,000 remains 9,834.
- Product pool/live/reserves remain 0 / 0 / 0.

## High-value follow-up queue

The following candidates merit direct, domain-specific Fred Perry verification because they showed comparatively stronger professional or commerce signals. Inclusion here is not qualification.

| Domain | Country signal | Cycle-19 signal | Required next proof |
|---|---|---|---|
| `planetretro.ie` | IE | professional PRELOVED, direct purchase, score 56 | direct/historical Fred Perry inventory and legal identity |
| `rebelshop.fi` | FI | second-hand commerce signal | direct Fred Perry inventory and legal identity |
| `cetorisecondhand.fi` | FI | dedicated second-hand operator | Fred Perry inventory, ecommerce and legal evidence |
| `secondfirst.se` | SE | professional second-hand operator | Fred Perry inventory and legal evidence |
| `rezke.sk` | SK | second-hand operator, VAT signal | direct Fred Perry inventory and commerce evidence |
| `textilehouse.sk` | SK | established professional second-hand operator | Fred Perry evidence and store/product URL evidence |
| `yesterdaysbread.gr` | GR | vintage operator | direct/historical Fred Perry inventory and legal identity |
| `ropalavada.gr` | GR | vintage/second-hand retail signal | Fred Perry inventory and legal evidence |
| `fashionplanet.bg` | BG | second-hand retail signal | direct Fred Perry inventory and legal evidence |
| `magia.bg` | BG | second-hand retail signal | direct Fred Perry inventory and legal evidence |
| `faktory.ee` | EE | reuse operator, VAT `EE100403138` | clothing specificity, Fred Perry evidence and ecommerce |
| `maniastores.bg` | BG | candidate fetch failed | recover site, Fred Perry evidence and legal identity |
| `90scloset-skg.com` | GR candidate | candidate fetch failed | recover site and prove EU operator/Fred Perry stock |

## Noise and false-positive findings

The cycle demonstrated several source-quality defects that must be corrected before another broad OSM sweep:

1. Cross-border leakage from coarse country bounding boxes, including Swedish domains in Danish lanes, Russian domains in Finnish lanes, Italian municipal content in a Croatian lane and Dutch domains in Belgian lanes.
2. General charity, municipal, food-bank, furniture and reuse-centre websites without clothing ecommerce relevance.
3. General marketplace leakage, including `yaga.ee`, which cannot qualify under the RLF marketplace exclusion canon.
4. OSM website tags pointing to obsolete paths, social or generic organizational pages rather than a current professional clothing storefront.
5. High public Overpass contention, producing HTTP 429, HTTP 504 and runtime remarks.

## Mandatory next stage — V23 targeted brand verification

V23 must not repeat a broad OSM sweep. It must operate on reviewed Cycle-19 domains and perform bounded direct-site Fred Perry verification using, where technically applicable:

- site-native search pages;
- Shopify predictive search/product endpoints;
- WooCommerce Store API or site search;
- direct sitemap and product-feed inspection;
- bounded Common Crawl corroboration for the exact candidate domain or exact URL;
- direct legal/contact pages and EU identity evidence.

Before fetching a candidate, V23 must apply:

- professional clothing relevance gate;
- marketplace/generalist/C2C exclusion;
- EU-country or legal-country gate;
- cross-border lane correction;
- known-domain and identity deduplication;
- direct domain evidence requirement.

No candidate may enter the canonical supplier count without direct Fred Perry PRELOVED evidence and full manual master deduplication. No product may enter the 4,000 pool without satisfying all product economic and evidentiary gates.

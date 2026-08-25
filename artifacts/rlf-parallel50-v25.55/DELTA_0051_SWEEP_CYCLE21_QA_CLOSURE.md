# RLF Delta 0051 — SWEEP50 Cycle 21 QA Closure

Date: 2026-08-25
Run: `wrun_01M0WPR5BNZG7Y9Y52SWQAM7FF`
Campaign: `RLF-P50-TARGETED-V23R1-20260825145619-e788327a`
Runtime closed: `25.55.58`
Profile: `EU27_TARGETED_DIRECT_INVENTORY_V23R1`
Workflow: `4.8.4_PINNED`
State: `CLOSED/CLOSED`

## 1. Purpose

Cycle 21 reprocessed the immutable 50-domain Cycle 20 queue with the corrected strict direct-inventory gate. The correction removed two false-positive paths: homepage text mentions and synthetic Fred Perry titles. A supplier can now receive Fred Perry evidence only from a captured same-domain internal inventory URL such as a product, item or collection URL.

No supplier or product was promoted automatically.

## 2. Durable execution

- Started: `2026-08-25T14:56:23.242Z`
- Completed: `2026-08-25T15:02:23.217Z`
- Parallelism: 50
- Real lane executions: 50
- Simulated lanes: 0
- Cycles: 1
- Raw candidates: 50
- Unique candidates: 50
- Unique domains: 50
- Unique identity keys: 7
- Evidence records: 310
- Qualified provisional: 0
- Direct product provisional: 0
- Evidence incomplete: 50
- Pool promotions: 0
- `ACCEPTED_4K`: 0
- Live: 0
- Reserves: 0

`searchErrors=164` contains fail-closed negative-verification events, expected 404 probes, challenge signals and bounded transport failures. It must not be interpreted as 164 provider transport outages.

## 3. Correction result

- 49 domains: `fredPerryEvidence=false` after the strict gate.
- 1 domain: direct same-domain Fred Perry inventory URL retained.
- Retained domain: `yesterdaysbread.gr`
- Retained product URL: `https://yesterdaysbread.gr/product/fred-perry-light-down-womens-jacket`
- Automated state: `EVIDENCE_INCOMPLETE`
- Automated product state: supplier evidence only; no commercial promotion.

The retained page proves brand handling but does not open any product gate. Current stock, exact product assets, condition, style code, country label, exact MSRP, cheapest professional PRELOVED comparable, complete landed costs, net profit and QC remain unproven.

## 4. Manual supplier adjudication — Yesterday's Bread

Decision: `READY_TO_MERGE_QUALIFIED`
Candidate ID: `D51-C013`
Canonical key: `domain:yesterdaysbread.gr`
Country: Greece (`GR`, EU-27)
Channel: `CURATED_SECOND_HAND_VINTAGE_RETAIL`
Operator: `BILOLMAS EFSTRATIOS`
Trading name: `Yesterday's Bread`
Address: `Kallidromiou 87-89, 10683 Athens, Greece`
Phone: `+30 210 881 1233`
Email: `yesterdaysbreadathens@gmail.com`

Qualification basis:

1. Own-domain direct Fred Perry product URL captured by the strict verifier.
2. Official shop and terms material identify a professional second-hand/vintage operation and the contracting operator.
3. Official contact material fixes address, telephone and email.
4. Independent local editorial coverage corroborates a long-running curated second-hand/vintage shop.
5. The current site maintenance state does not invalidate historical supplier qualification, but blocks all current product promotion.

## 5. Deduplication audit

Accessible canonical sets checked:

- `RLF_MASTER_PROVEIDORS_PRODUCTES_v24_DELTA_0044_PARALLEL50_2026-08-23.xlsx`
- cumulative Delta 0045–0050 intake and deduplication records
- repository registry, staged records and artifacts

Normalized dimensions searched independently:

| Dimension | Normalized value | Master matches | Cumulative matches | Result | Audit SHA256 |
|---|---|---:|---:|---|---|
| Canonical key | `domain:yesterdaysbread.gr` | 0 | 0 | PASS | `0d5c2cf60affb5bfee2da39a0386ad1fe2c8dc9c517507fd7949302c2493029d` |
| Domain | `yesterdaysbread.gr` | 0 | 0 | PASS | `ab660b65948006a5aa90ba50033ae8d330a448e327ac028a3b2a85e9b008fd97` |
| Legal name | `BILOLMAS EFSTRATIOS` | 0 | 0 | PASS | `1ebe03907b5a5f0725527f4e238f1aa3751bfa2a377edea573c8e7bbe0031e63` |
| Address | `Kallidromiou 87-89, 10683 Athens, Greece` | 0 | 0 | PASS | `b623096ea2f7fb6e4551cb0446a54ace813b6ffeaa95db6551a58e7d90919af7` |
| Phone | `+30 210 881 1233` | 0 | 0 | PASS | `2bf55144a03b22173d31a993e16c3b7d6003253243c8cd2f6a0d9546c6a5ca3b` |
| Email | `yesterdaysbreadathens@gmail.com` | 0 | 0 | PASS | `29403efeafee3674d45e5f64abd4cd0bc50d0da2671329a1c3ed676b638d3f81` |

Candidate record SHA256: `6a694aac88bcdd3e0ee7fa2863cc5c3b78f2fec4c1b292711558087c3a858479`

The accessible exact-term indexes returned no match in any dimension. The XLSX bytes were not materialized in the execution filesystem for a separate local `openpyxl` pass; therefore the safe operational decision is staging, not direct canonical mutation.

## 6. Funnel impact

- Canonical qualified suppliers: 154 — unchanged.
- Existing READY_TO_MERGE: 12.
- New staged READY_TO_MERGE: 1.
- READY_TO_MERGE projected: 13.
- Projected qualified after controlled merge: 167.
- Remaining to 10,000 after controlled merge: 9,833.
- Product pool/live/reserves: `0 / 0 / 0`.

## 7. Security and deployment closure

- Armed runtime: `25.55.57`
- Armed CI run: `32862359505`
- Armed artifact: `9568726880`
- Armed artifact digest: `sha256:2592452f3545cf2684e15328dc5db33df90456d333892eae9a61b79ef6a32356`
- Closure runtime: `25.55.58`
- Closure commit: `2d0852488c200d2718a1300769e15224d2573832`
- Closure CI run: `32862710291`
- Closure artifact: `9568865537`
- Closure artifact digest: `sha256:065716462a63deb8c34d45d54b951fba3c0d33adf90a0e44095ed7ef481884ea`
- Closure deployment: `dpl_C8TvKCTqFjHFGvQ4b8KfVgKjTcAE`
- Lambda count: 5
- Dependency audit: 0 moderate / 0 high / 0 critical
- Exact consumed capability after closure: HTTP 404

## 8. Next strict block

1. Preserve `yesterdaysbread.gr` as staged, idempotent `READY_TO_MERGE_QUALIFIED` until the editable master bytes are available.
2. Build a fresh 50-domain queue from a new source family; do not repeat the Cycle 19/20 OSM queue.
3. Prioritize independent professional fashion/vintage domains and historical direct Fred Perry inventory URLs.
4. Apply V23R1 direct-inventory verification, legal identity, EU-27, PRELOVED model and full master/cumulative dedup.
5. Keep every product gate closed unless all economic, evidence and QC conditions pass simultaneously.

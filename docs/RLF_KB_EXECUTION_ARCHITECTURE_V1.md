# RLF KB — Execution architecture v1

Canonical date: 2026-08-26  
Coverage target: all evidenced Fred Perry production variants from the 1940s through 2026-08-31.  
Planning capacity: 20,000 production variants; not a hard cap.  
Policy: `APPEND_ONLY_FAIL_CLOSED`, no fabricated data, no fabricated images, no automatic promotion.

## Decision

The efficient sequence is schema-first and execution-immediate:

1. lock the identity and evidence schema;
2. ingest all existing URL and label evidence without excluding discontinued products;
3. generate provisional identities and candidate links;
4. execute non-overlapping research waves of 50 lanes;
5. review conflicts and promote only evidence-backed production variants.

Scaling collection before fixing identity would multiply retailer, locale, size, colour and historical duplicates. Delaying collection until the schema is perfect would waste available sources. Both therefore proceed in parallel, but ingestion is constrained by the canonical schema.

## Principal census unit

The main census count is `fp_production_variant_id`:

`commercial variant + factory/manufacturer + country + material/composition + label/construction system + bounded production period`

URLs, sellers, owners, sizes and repeated photographs are evidence instances, not products.

## Pipeline stages

### S0 — Raw preservation

Preserve source bytes and metadata exactly as acquired:

- URL or archive locator;
- referring page;
- capture timestamp;
- MIME type;
- original byte hash;
- HTTP/result status;
- runner and lane identity.

Nothing is silently overwritten or discarded.

### S1 — Evidence extraction

Extract only explicit observations:

- product/model/style codes;
- colour names and codes;
- date/season statements;
- country and manufacturer text;
- composition text;
- care instructions;
- label and construction observations;
- image URLs and image metadata.

Unknown fields remain unknown. Listing dates are not manufacturing dates.

### S2 — Candidate identity

Create provisional fingerprints for:

- model family;
- commercial variant;
- production variant;
- evidence instance.

Fingerprints are based on normalized evidenced values, not guessed values. Missing factory or date information produces a provisional identity rather than a forced merge.

### S3 — Cross-source linking

Link evidence across retailers, archives and physical garments using weighted features:

1. exact style + colour code;
2. exact model + official colour + season;
3. matching care label, country and composition;
4. matching label system and construction;
5. image perceptual similarity as supporting evidence only.

No fuzzy match alone may create a canonical merge.

### S4 — Image acquisition and role assignment

Target per production variant:

- four generic views;
- five or six forensic macro views.

Store untouched originals plus normalized derivatives. Near-duplicates remain linked but do not satisfy multiple image roles.

### S5 — Historical and manufacturing enrichment

Resolve:

- exact or bounded period;
- factory/manufacturer attribution;
- material/composition variant;
- regional/licensed line;
- label-system chronology;
- construction changes.

Every claim is stored as an assertion linked to evidence.

### S6 — Human/controlled review

Review queues are prioritized by:

1. likely duplicate production variants;
2. factory or country conflicts;
3. date conflicts;
4. composition conflicts;
5. insufficient forensic images;
6. high-impact model families with many unresolved variants.

### S7 — Promotion

Promotion states:

- `URL_ONLY`
- `IDENTITY_PARTIAL`
- `GENERIC_IMAGE_SET`
- `FORENSIC_PARTIAL`
- `FORENSIC_COMPLETE`
- `KB_COMPLETE_A`
- `KB_COMPLETE_B`

Promotion is never automatic. Eligibility views may flag candidates, but a controlled review records the decision.

## 50-lane operating model

Each wave has 50 exclusive lanes. A lane owns a unique source/vector/period/objective tuple. A query, source document, sitemap, archive collection, factory record or evidence object claimed by one lane cannot be claimed by another lane in the same or later wave unless explicitly marked as a follow-up review.

Each lane must emit:

- lane manifest;
- source list;
- raw evidence hashes;
- extracted observations;
- identity candidates;
- conflicts;
- rejected candidates and reason;
- completion status.

## Initial execution order

### Wave 001 — bootstrap and high-yield corpus

- current and archived official product/catalogue sources;
- high-volume retailer product corpora, including discontinued URLs;
- existing RLF sewn-label evidence;
- historical catalogue and advertising discovery;
- manufacturer/factory registry discovery;
- collaboration and regional-line indexes;
- image-role acquisition;
- deduplication and QA lanes.

### Wave 002 — chronology and factory bridges

Prioritize objects with visible codes and labels, then build exact bridges between:

- style/colour;
- label system;
- country;
- legal manufacturer;
- physical plant;
- bounded period.

### Wave 003 onward — gap-driven research

Rank gaps by expected information gain, not raw URL count. A lane that can resolve factory, date and composition for 30 variants outranks a lane that finds 500 duplicate retailer pages.

## Efficiency rules

- Crawl once, parse many times.
- Preserve raw bytes so extraction logic can improve without re-downloading.
- Hash before downloading a duplicate image when metadata permits.
- Resolve identities before expensive forensic enrichment.
- Prioritize sources containing multiple decisive fields.
- Use current retail sources for image and code discovery, not as the historical universe.
- Treat model, colour, season, factory and composition as independent dimensions until evidence justifies a merge.
- Maintain separate KB and commercial-pool schemas and rules.

## Success metrics

Raw volume is secondary. Primary metrics are:

- production variants with exact style code;
- production variants with evidenced colour;
- production variants with bounded date;
- production variants with country evidence;
- production variants with factory/manufacturer bridge;
- production variants with verified composition;
- production variants with 4 generic images;
- production variants with 5/6 forensic macros;
- duplicate-collapse accuracy;
- unresolved conflict count and age.

The final total is evidence-led and may exceed 20,000. It must never be inflated to meet a target.

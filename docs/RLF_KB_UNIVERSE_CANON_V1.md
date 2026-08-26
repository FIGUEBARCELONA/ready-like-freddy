# RLF KB — Canonical universe of Fred Perry products v1

Canonical date: 2026-08-26
Coverage end date: 2026-08-31

## 1. Absolute scope

The RLF Fred Perry knowledge base must seek to identify, document and classify every unique product manufactured or commissioned under the Fred Perry brand from the earliest 1940s products through 31 August 2026.

The scope includes:

- every product category, not only clothing or menswear;
- men, women, children, baby, unisex and non-gendered lines;
- apparel, footwear, bags, accessories, sports products, equipment, special objects and licensed product categories;
- core lines, seasonal lines, regional lines, collaborations, capsules, uniforms, promotional products and documented samples;
- every colourway and materially distinct product variant;
- every historical and current country, manufacturer and production plant for which evidence exists;
- discontinued, sold-out, archived, recalled, cancelled or historically documented products;
- products with no surviving current retail page, provided that documentary or physical evidence exists.

Commercial availability, resale value, discount, margin, supplier geography and PRELOVED-pool eligibility are irrelevant to KB inclusion.

## 2. Planning size

- Initial expected universe: 10,000–15,000 unique identities.
- Expanded planning capacity: 20,000 unique identities.
- The figure of 20,000 is not a hard cap.
- The final total is evidence-led. New identities are admitted when they pass deduplication and evidence controls.
- No target may be reached by splitting URLs, language versions, sizes or duplicate observations into false products.

At 20,000 production variants and a target of 9–10 images each, the image system must support approximately 180,000–200,000 classified images, plus untouched originals, normalized derivatives and rejected/duplicate evidence.

## 3. Four-level identity model

### Level A — Model family

Stable design or historically recognized model family.

Examples of discriminating evidence:

- official model name;
- stable style lineage;
- construction pattern;
- historical catalogue identity.

A model family is not sufficiently precise for the final production-variant census.

### Level B — Commercial variant

A sellable or catalogued variant of a model:

`model/style + colourway + period/season + market/line when materially relevant`

Different colours and seasonally changed official variants are not collapsed when the sources distinguish them.

### Level C — Production variant

The principal census unit for the complete KB:

`commercial variant + factory/manufacturer + country + material/composition + label/construction system + bounded production period`

A commercial SKU produced in demonstrably different factories, compositions, countries or label systems creates linked production variants rather than being overwritten by a single value.

### Level D — Evidence instance

One observed physical garment/object, product page, catalogue record, advertisement, archive entry, photograph set or manufacturing document.

Many evidence instances may support one production variant. Evidence instances are never counted as additional products merely because their URLs, owners, sizes or photographs differ.

## 4. Canonical identifiers

- `fp_model_id`
- `fp_commercial_variant_id`
- `fp_production_variant_id`
- `fp_evidence_instance_id`

Relationships:

- one model has one or more commercial variants;
- one commercial variant has one or more production variants;
- one production variant has one or more evidence instances;
- uncertain relationships remain provisional and are not force-merged.

## 5. Distinction rules

Create separate commercial or production variants when reliable evidence establishes one or more of the following:

- different official colour name or colour code;
- different style code or style-code revision;
- different season or bounded historical period with a documented construction change;
- different factory or legal manufacturer;
- different country of manufacture;
- different fibre composition or materially different construction;
- different main label, care-label or licensing system tied to a production period or manufacturer;
- materially different product specification, pattern, fit, trim, closure, embroidery, sole or hardware;
- regional or licensed version with distinct manufacturing or product identity.

Do not create a new product solely because of:

- size;
- retailer;
- seller;
- current owner;
- URL parameters;
- country/language copy of the same page;
- repeated image;
- listing date;
- price or discount;
- stock status;
- minor wear or post-production alteration.

## 6. Temporal coverage

The chronology starts with the earliest documented Fred Perry-branded products in the 1940s and ends on 31 August 2026.

Each production variant must use one of:

- exact year and season;
- exact year;
- bounded `year_from` / `year_to` range;
- decade-level provisional range;
- `unknown`, with an explicit open research task.

A web-listing date must never be used as a manufacturing date.

## 7. Factory and manufacturing coverage

The KB must maintain a separate factory/manufacturer registry covering historical and current production sites worldwide.

Required factory entities and links:

- legal manufacturer;
- plant/facility name;
- physical location;
- country and historical country designation where relevant;
- operating period;
- role in the supply chain;
- Fred Perry production period;
- product categories or style families linked by evidence;
- source documents and confidence grade;
- exact bridge from plant/manufacturer to production variant.

`Made in <country>` supports a country attribution only. It does not by itself identify a factory.

## 8. Required production-variant fields

Every production variant record must seek to resolve:

- model name and model family;
- exact style code and revisions;
- exact colour name and colour code;
- exact or bounded year/season;
- factory, manufacturer and country;
- complete material/composition fields;
- product category and specification;
- main label system;
- care/composition label system;
- size-label and code-label system;
- licensing/distributor data;
- all known source URLs and archival references;
- four generic product images;
- five or six forensic macro images;
- evidence grade and unresolved conflicts.

## 9. Image corpus target

Per production variant:

### Four generic views

1. front/full principal view;
2. rear/full secondary view;
3. side/interior/construction view;
4. identifying product detail.

### Five or six forensic macros

1. main brand label front;
2. main label reverse/attachment/stitching;
3. care/composition label front;
4. care/composition label reverse or additional leaf;
5. style/size/colour/season/lot code;
6. factory/manufacturer/country or diagnostic construction evidence.

Images must be real source evidence. Generated images, invented reconstructions and placeholders are prohibited.

## 10. Completion definition

The project is not complete when a numerical target is reached. It is complete only when:

- the known historical and current source universe has been systematically covered;
- every candidate has been deduplicated or linked;
- every accepted identity has traceable evidence;
- open conflicts and missing fields are explicitly registered;
- factory, chronology, materials and image evidence have been investigated under the canonical rules;
- the residual discovery rate has fallen to a documented closure threshold across repeated independent sweeps.

The KB remains append-only and fail-closed: uncertain data is retained as a candidate or unresolved claim, never promoted as fact.

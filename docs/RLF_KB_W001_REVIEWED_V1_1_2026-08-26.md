# RLF KB — W001 reviewed V1.1

Date: 2026-08-26
Policy: `APPEND_ONLY_FAIL_CLOSED`
Branch: `automation/fred-perry-product-map-20260826`

## Scope

The wave processed 50 Fred Perry style-colour candidates. It is a KB enrichment wave, not a commercial pool operation.

## Audited results

- 50 candidates processed.
- 107 source observations.
- 30 successful page fetches covering 24 candidates.
- 77 failed or blocked source observations placed in a retry queue.
- 638 raw field assertions preserved.
- 156 image files downloaded and inspected.
- 24 images visually accepted as `GEN_FRONT_FULL`, one per recovered candidate.
- 132 files rejected as duplicates, unreadable assets, retailer banners, unrelated lifestyle images or imagery for another product.
- 23 candidates have an exact retailer colour string.
- 21 candidates have an explicit retailer material/composition statement.
- 0 candidates have evidenced manufacture country in this wave.
- 0 candidates have evidenced factory or legal manufacturer in this wave.
- 0 candidates have evidenced production year or season in this wave.
- 0 candidates were promoted into canonical production variants.

## Normalization corrections

- JSON-LD `brand=Fred Perry` is stored as brand evidence and is not treated as the legal manufacturer or factory.
- Broad retailer colours such as `green`, `pink` or `anthracite` are stored as retailer visual families.
- Longer code-linked colour strings are retained as retailer exact strings, not as official Fred Perry colour names until a primary source confirms them.
- Empty headings such as `Composition:` are rejected rather than treated as material data.

## W002

W002 contains 50 mutually exclusive candidate lanes:

- 24 lanes for reverse/side/detail images, six forensic macros, materials, origin and factory evidence.
- 26 lanes for blocked or missing source recovery and initial image acquisition.

No lane may create a canonical identity without supporting evidence and review.

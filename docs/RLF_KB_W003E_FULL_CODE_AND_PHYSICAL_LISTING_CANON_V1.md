# RLF KB — W003E full-code and physical-listing canon v1

Canonical date: 2026-08-26  
Policy: `APPEND_ONLY_FAIL_CLOSED`

## Full observed code

A string such as:

- `M3600/U98/1950/418`
- `M3600/350/1950/419`
- `M3600/350/1950/396`

is stored as an immutable `observed_full_code` when an exact physical resale or inventory record associates it with the garment.

The components after style and colour remain uninterpreted unless a primary coding key or a controlled repeated series proves their semantics. In particular, `1950`, `418`, `419` and `396` must not automatically become a year, season, factory, size, batch or market code.

## Multiple full codes under one style-colour

Different full-code strings under the same style-colour create separate `PRODUCTION_INSTANCE_CANDIDATE` records for review. They do not automatically create or promote separate canonical production variants.

A split requires additional differentiating evidence such as:

- sewn-label system;
- care-label content;
- material/composition;
- country or exact facility;
- construction details;
- bounded production chronology;
- documented market or licence distinction.

## Text evidence versus image macro

An exact full code present in a product title or description is textual identity evidence. It does not satisfy a forensic image role.

A physical hero/front image of the same listing may be retained as an evidence-instance image, but does not satisfy:

- brand-label macro;
- care-label macro;
- style/colour-code macro;
- factory/construction macro.

A forensic macro is promoted only when the required text or construction detail is visibly legible in the image or is linked through an immutable single-item gallery with sufficient visual proof.

## Access and expiry

HTTP 401, 403, 404, expired CDN URLs, invalid bytes and missing gallery images are recorded as transport outcomes and negative memory. They are not evidence that the physical image never existed.

A failed route is retried only after a material change: authorized access, a new archive copy, a new exact listing or a directly recoverable original image URL.

## Site and factory status

W003E does not change the factory-attribution ceiling without new industrial evidence:

- Winzen Zhongshan exact operating site remains open;
- L7255-81A / GTIN 5063460129686 exact link to Shilla Glovis remains open;
- legal-entity and style-level facility evidence from V2.7 remains valid.

## Promotion

Full-code evidence and physical resale images enrich the candidate and may open production-instance review records. They do not alone promote a canonical production variant.

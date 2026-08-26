# RLF KB — W002 reviewed V2.2

Date: 2026-08-26  
Policy: `APPEND_ONLY_FAIL_CLOSED`  
Branch: `automation/fred-perry-product-map-20260826`

## Scope

Official Fred Perry image recovery for the 50 controlled W001 style-colour candidates. This is KB evidence acquisition and is independent of the PRELOVED commercial pool.

## Audited output

- 50 controlled candidates.
- 49 candidates matched to an official Fred Perry sitemap product entry.
- 1 unresolved official candidate: `M2475-129`.
- 489 official image files downloaded.
- 124,094,610 original image bytes preserved.
- 489/489 files passed image decoding and SHA-256 verification.
- 0 byte-identical duplicates detected across the downloaded set.
- 49 candidates have reviewed front evidence.
- 49 candidates have reviewed side/interior evidence.
- 49 candidates have reviewed back/rear evidence.
- 8 candidates have a reviewed context/detail image.
- 8 candidates therefore have the complete four-image generic set.
- 0 forensic macro sets complete.
- 0 candidates promoted to canonical production variants.

## Deterministic role evidence

Official filename tokens were accepted only when the style code and colour code also matched the candidate:

- `MOD1_FRONT` → `GEN_FRONT_FULL`
- `MOD2_SIDE` → `GEN_SIDE_OR_INTERIOR`
- `MOD3_BACK` → `GEN_BACK_FULL`
- `FLATFRONT` → alternate front evidence
- `FLATBACK` → alternate back evidence
- `SWATCH` → colour reference only

`ED1`–`ED8` remain editorial candidates unless visually reviewed. They do not automatically satisfy `GEN_CONTEXT_DETAIL`.

## Manual visual review

- `FLATSQUARE` was accepted as `GEN_CONTEXT_DETAIL` for seven M3600 style-colour candidates.
- The `L7255-81A` barrel bag received product-type-equivalent role mapping after visual inspection: front, angled side, rear/end, interior evidence and a construction/logo detail.
- All standard product images remain ineligible for forensic macro roles unless they actually show physical labels, codes, stitching or manufacturing evidence at usable resolution.

## Open revision conflict

`M3600-U98` has two separate official source-asset sets:

- `Q124`: 8 images
- `Q326`: 8 images

Both are preserved. The tokens are not treated as dates or seasons. The relationship must be investigated as an asset refresh, commercial revision or production revision before any merge or split.

## W003 handoff

W003 contains 50 exclusive lanes, one per exact `style_code + colour_code`. Each lane is responsible for:

- one missing generic context/detail role where needed;
- six forensic macro roles;
- exact composition evidence;
- country and factory/manufacturer evidence;
- bounded date/season evidence;
- label-system and construction evidence;
- hashes and source provenance.

No other W003 lane may research or promote the same exact style-colour scope key.

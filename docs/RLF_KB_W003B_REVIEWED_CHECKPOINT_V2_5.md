# RLF KB — W003B reviewed checkpoint V2.5

Canonical date: 2026-08-26  
Branch: `automation/fred-perry-product-map-20260826`  
Policy: `APPEND_ONLY_FAIL_CLOSED`

## Result

- 8 fast-track style-colour candidates.
- 10 exact-source pages processed by optimized collector V2.
- 181 asset rows.
- 48 images reached visual review.
- 44 unique binary SHA-256 hashes.
- 20 reviewed assets retained, including one V1-only U98 contextual image and one model-level M3600/S07 sewn-label reference.
- 29 downloaded images rejected as visual noise or lower-resolution derivatives.
- 133 transport, byte-size, decode or dimension rejections.
- 1 exact-variant forensic role promoted:
  - `M3600::350` → `MACRO_STYLE_SIZE_COLOUR_CODE`.
- 5 Japanese regional commercial product instances retained separately from production chronology.
- 24 exact-query negative-memory records.
- 10 method-level negative-memory records.
- 55 fast-track tasks remain open.
- 0 exact factories resolved.
- 0 complete six-macro forensic sets.
- 0 canonical production variants promoted.

## Exact M3600-350 hangtag observation

Visible fields:

- STYLE: `M3600`
- COL: `350`
- COL. DESC: `BLACK`
- PRODUCT: `TWIN TIPPED FRED PERRY SHIRT`
- SIZE: `M`
- barcode: `5034606050065`

The hangtag proves only the visible commercial identity fields. It does not prove country, factory, composition, care instructions, sewn-label system or production date.

## Model-level reference

The real interior label reading `MADE IN CHINA | M3600/S07/1950/409` is retained as `MODEL_LEVEL_REFERENCE`. It cannot be assigned to `04C`, `85B`, `87B`, `T50`, `T60`, `U98`, `350` or any other colour without an exact link.

## Deliverables

- `RLF_KB_TRACKER_V2_5_2026-08-26.xlsx`
  - SHA-256: `9364a569f4190be03228852167aadc5403dd6d5dd351b77884e4762db167195c`
- `RLF_KB_W003B_REVIEWED_V2_5_2026-08-26.zip`
  - SHA-256: `c0112f56090535c9ac0e9188b6354c6f172621d1c8f87078650fd20561392f0c`
- `RLF_KB_CHECKPOINT_V2_5_2026-08-26.zip`
  - SHA-256: `45d2a0a17f2cbaf3f9048cf13aceac4645aa35c224a004bed10ee7fa0b9e0971`

Collector V2 Actions artifact digest:

`sha256:16440087c16bb4de01a6da094fe03e1996b1e91f8571db7e5a2bbca7d56b8f9b`

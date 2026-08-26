# RLF KB — W003F full-code semantics canon v1

Canonical date: 2026-08-26  
Policy: `APPEND_ONLY_FAIL_CLOSED`

## Scope

This canon governs observed physical/resale full-code strings such as:

`M3600 / colour / middle-token / final-token`

It does not assume that every Fred Perry label uses four components.

## Supported fields

For the controlled M3600 corpus:

1. component 1 is the style/model code (`M3600`);
2. component 2 is the colour code (`U98`, `350`, `Q46`, `J74`, etc.);
3. the semantics of component 3 (`1950`, `01885`) remain unresolved;
4. the semantics of component 4 (`418`, `419`, `396`, `435`, `387`, `409`, `395`) remain unresolved.

## Negative semantic findings

### `1950` is not a size code

The token `1950` occurs in controlled records with tag sizes M, L and XL, including multiple colour codes. Therefore it cannot be interpreted as the garment size.

### `1950` is not the colour code

The same token occurs after distinct colour components including `U98`, `350`, `Q46` and `J74`. The colour is already represented by component 2.

### `419` is not a size code

The identical full code `M3600/350/1950/419` is recorded on at least two separate physical resale records with tag sizes L and XL. This rules out an interpretation of `419` as the garment size.

### `409` is not a unique colour identifier

The final token `409` occurs in model-level physical labels with different colour components (`S07` and `S31`) and different middle tokens (`1950` and `01885`). It cannot be treated as the unique colour code.

These are exclusion findings only. They do not assign a positive meaning to the tokens.

## Open semantics

No controlled evidence currently proves whether component 3 or component 4 represents any of the following:

- factory or supplier;
- production line;
- pattern or construction revision;
- market;
- season or chronology;
- batch or lot;
- fit block;
- label-system revision;
- another internal classification.

Numeric appearance alone is not evidence.

## Production-instance rule

A distinct observed full code may create an unpromoted `PRODUCTION_INSTANCE_CANDIDATE` under an existing commercial variant. It does not create a canonical production variant unless additional evidence supports a meaningful production distinction such as factory, bounded production period, material, construction or label system.

For `M3600::350`, the observed codes `.../419` and `.../396` remain in multi-full-code review. They must not be automatically split or merged.

## Separate identifier namespaces

Official commercial SKU/GTIN identifiers, Japanese `品番2`, seller management numbers and physical full-code strings are separate namespaces unless an explicit evidence bridge connects them.

A GTIN or size-specific commercial SKU does not decode component 3 or component 4 of a sewn-label/full-code string by itself.

## Evidence threshold

Positive token semantics require one of:

1. a primary Fred Perry or manufacturing coding key;
2. a production or supplier document defining the field;
3. repeated controlled physical evidence where one variable changes and the token relationship is unambiguous;
4. an authoritative system export that explicitly names the field.

## Promotion

No result in W003F automatically promotes a canonical production variant or an exact forensic image role.

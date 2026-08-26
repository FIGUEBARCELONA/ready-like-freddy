# RLF KB — W003G exact gallery evidence canon v1

Canonical date: 2026-08-26  
Policy: `APPEND_ONLY_FAIL_CLOSED`

## Exact physical-gallery bundle

Two or more photographs may jointly satisfy a forensic role only when they are demonstrably part of one exact, traceable physical-item gallery.

A sewn full-code image and a size-bearing brand-label image from the same stable listing may jointly support:

`style + colour + size + physical evidence instance`

The evidence bundle must preserve every source URL, image URL, original binary SHA-256 and review decision.

## Role decisions

A complete Fred Perry neck-label close-up may satisfy `MACRO_BRAND_LABEL_FRONT`.

A sewn full-code label plus size in the same exact gallery may satisfy `MACRO_STYLE_SIZE_COLOUR_CODE`.

A partly visible care label is retained as `PARTIAL_NOT_ROLE_COMPLETE`; it does not close either care-label role.

Visible overlock stitching or label attachment without an authoritative construction mapping does not close `MACRO_FACTORY_OR_CONSTRUCTION`.

Country, legal entity and factory cluster evidence do not identify the exact production facility for an observed item.

## W003G exact labels

### M3600::U98

The exact Mercari gallery supplies:

- Fred Perry neck label, size S;
- sewn label `M3600/U98/1950/418`;
- `MADE IN CHINA`;
- a partial Japanese importer/care-label reverse.

Promoted roles:

- `MACRO_BRAND_LABEL_FRONT`;
- `MACRO_STYLE_SIZE_COLOUR_CODE`.

The partial care label remains open.

### M3600::350

The exact Mercari gallery supplies:

- Fred Perry neck label, size M;
- sewn label `M3600/350/1950/421`;
- `MADE IN CHINA`.

Promoted role:

- `MACRO_BRAND_LABEL_FRONT`.

The existing `MACRO_STYLE_SIZE_COLOUR_CODE` role is reinforced with sewn-label evidence and a new full-code record. It is not counted as a second promotion of the same role.

## Component-4 size finding

Controlled evidence now shows:

- `M3600/U98/1950/418` in sizes S and XL;
- `M3600/350/1950/419` in sizes L and XL;
- size M with both `M3600/350/1950/396` and `M3600/350/1950/421`.

Therefore component 4 is not a one-to-one garment-size identifier.

This is an exclusion finding only. No positive meaning is assigned to `418`, `419`, `396` or `421`.

## T50 partial code

`M3600/T50/1950` is retained as a physical-resale seller MPN associated with size XXL, China and cotton.

It remains `PARTIAL_OR_THREE_COMPONENT_CODE` until a physical label proves whether:

- it is a complete three-component format; or
- a fourth component was omitted by the seller.

No forensic role or production instance is promoted from this record alone.

## Production-instance rule

The new exact code `M3600/350/1950/421` creates an unpromoted production-instance candidate under commercial variant `M3600::350`.

Distinct codes `396`, `419` and `421` must not be automatically split or merged. Positive production meaning still requires factory, bounded chronology, material, construction or label-system evidence.

## Promotion rule

W003G performs no automatic canonical production-variant promotion, exact-factory attribution, code split or code merge.

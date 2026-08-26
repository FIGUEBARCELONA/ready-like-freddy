# RLF KB — Canonical checkpoint V3.0

Canonical date: 2026-08-26  
Block: `W003G_REVIEWED`  
Policy: `APPEND_ONLY_FAIL_CLOSED`

## Base

Previous canonical checkpoint: `V2.9`.

## Collector

- GitHub Actions run: `32981057995`
- Artifact: `RLF_KB_W003G_EXACT_PHYSICAL_GALLERIES_V1`
- Artifact digest: `sha256:dcc71f6156505952aff7ec740cd5f774cbd13d97a50c40398d2af094b364e7ee`
- Targets: 8
- HTTP-200 pages: 6
- Asset attempts: 242
- Unique binary images reviewed: 36

## Reviewed result

- Retained images: 29
- Rejected images: 7
  - 2 unrelated payment/navigation images
  - 5 lower-resolution visual derivatives
- New exact forensic-role promotions: 3
- Existing role reinforcements: 1
- Partial macro records retained without closure: 3
- Original forensic tasks remaining open or partial: 52
- Canonical production variants promoted: 0

## Exact role promotions

### M3600::U98

- `MACRO_BRAND_LABEL_FRONT`
- `MACRO_STYLE_SIZE_COLOUR_CODE`

Exact gallery evidence:

- neck label size S;
- `M3600/U98/1950/418`;
- `MADE IN CHINA`.

The partial importer/care-label reverse remains below role-complete status.

### M3600::350

- `MACRO_BRAND_LABEL_FRONT`

The existing code role is reinforced by a sewn label:

- neck label size M;
- `M3600/350/1950/421`;
- `MADE IN CHINA`.

## Full-code state

Fast-track exact codes:

1. `M3600/U98/1950/418`
2. `M3600/350/1950/396`
3. `M3600/350/1950/419`
4. `M3600/350/1950/421`

Partial or possible three-component code:

- `M3600/T50/1950`

Production-instance candidates: 4. All remain unpromoted.

## Controlled semantic finding

Component 4 is not a one-to-one garment-size identifier because:

- U98/418 occurs in sizes S and XL;
- 350/419 occurs in sizes L and XL;
- size M occurs with both 350/396 and 350/421.

No positive meaning has been assigned to component 3 or component 4.

## Remaining priority colourways without any recovered code

- `M3600::04C`
- `M3600::85B`
- `M3600::87B`
- `M3600::T60`

## Industrial bridges still open

- Exact Winzen Zhongshan operating site/address: open.
- Exact item-to-Winzen facility bridge: open.
- Exact `L7255-81A` / GTIN `5063460129686` to Shilla Glovis Cho Moi bridge: open.

## Deliverables

- Tracker: `RLF_KB_TRACKER_V3_0_2026-08-26.xlsx`
  - SHA-256: `a5238f7cd650d860f99f533ee332a7e0ac628c68832560753e51cebb6622eca3`
- Delta: `RLF_KB_W003G_REVIEWED_V3_0_2026-08-26.zip`
  - SHA-256: `55fbaca116bd50783993d5c1b2a774050453f439e642211f81bbc9e2be1a6399`
- Self-contained checkpoint: `RLF_KB_CHECKPOINT_V3_0_2026-08-26.zip`
  - SHA-256: `da4382d9f5b861364eb8e405912ac1c17e7f98145155306d5cb85fe8d0350c5b`

## Repository commits

- Collector: `81f58ed9f59cd1b3a502e7a4e5da08fdf0c60106`
- Workflow: `3bd2ab9a49b21b605009f11593b75500bfc37125`
- Evidence canon: `cd81c100866d36ab63a38a8c87f46c1264353988`
- Review configuration: `9d5933dc610c4f92825a103e0e5aa77b0b50105d`

## Next strict block

`W003H`:

1. recover complete care-label front/reverse for U98 and the three 350 code instances;
2. confirm whether `M3600/T50/1950` is complete or truncated;
3. recover exact codes for 04C, 85B, 87B and T60;
4. resolve the 396/419/421 relationship without numeric guessing;
5. continue exact Winzen-site and L7255-81A–Shilla item bridges.

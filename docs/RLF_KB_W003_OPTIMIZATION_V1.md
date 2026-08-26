# RLF KB — W003 Optimization Canon v1

Canonical date: 2026-08-26  
Branch: `automation/fred-perry-product-map-20260826`  
Policy: `APPEND_ONLY_FAIL_CLOSED`

## Purpose

W003 is optimized to maximize new evidence per request while preventing overlap, duplicate downloads, forced merges and false production dating.

## Execution tiers

### Tier 1 — forensic fast track

Eight style-colour candidates already have all four reviewed generic image roles. Their lanes must not repeat generic commercial-image acquisition. They search only for:

- `MACRO_BRAND_LABEL_FRONT`;
- `MACRO_BRAND_LABEL_BACK_OR_STITCHING`;
- `MACRO_CARE_LABEL_FRONT`;
- `MACRO_CARE_LABEL_REVERSE`;
- `MACRO_STYLE_SIZE_COLOUR_CODE`;
- `MACRO_FACTORY_OR_CONSTRUCTION`;
- exact factory or manufacturer attribution;
- label-system and bounded production-period evidence.

### Tier 2 — standard completion

The remaining forty-two candidates first resolve missing generic detail, then proceed to the same forensic, material, origin, dating and factory tasks.

## Lane exclusivity

Each lane owns exactly one canonical scope key:

`STYLE_CODE::COLOUR_CODE`

No other lane may research, download or assert evidence for the same scope key during the same wave.

## Deduplication and negative memory

Before accepting work, check this composite evidence key:

`candidate + canonical URL + binary SHA-256 + image role + normalized assertion`

A previously inspected source that produced no new acceptable evidence is written to negative memory with the rejection reason. Rejected or exhausted sources must not be retried unless the source content, access method or acceptance target changes materially.

## Chronology semantics

- `Product Quarter` and `New-in` belong to commercial chronology.
- They are not manufacturing dates.
- A seller season or manufacturing disclosure is an evidence-instance observation.
- Repeated exact style-colour combinations across different documented periods open a production-period split review.
- They are not forcibly merged and are not automatically promoted as separate production variants.

## Candidate-ID reconciliation

When UUIDs conflict but the evidence resolves to the same exact style and colour code, reconciliation uses the canonical scope key. The conflict is logged; a second product record is not created merely because identifiers differ.

## W003A controlled result

The first optimized fast-track pass established:

- 8/8 exact commercial colour descriptions;
- 8/8 material/composition statements;
- 8/8 official commercial Product Quarters;
- 8/8 countries of manufacture from exact-SKU evidence;
- 3 explicit manufacturing months;
- 2 production-period split reviews: `M3600::T50` and `M3600::350`;
- 1 candidate-ID reconciliation: `L7255::81A`;
- 56 open fast-track tasks: six forensic macros plus exact factory for each candidate;
- 0 exact factories;
- 0 complete forensic macro sets;
- 0 canonical production-variant promotions.

## Promotion gate

Automatic promotion is prohibited. A production variant can be promoted only after controlled review establishes a defensible identity boundary using the relevant factory/manufacturer, country, composition, label/construction system and bounded production period.

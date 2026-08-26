# RLF KB — Identity cluster bootstrap V2.1

Canonical date: 2026-08-26
Branch: `automation/fred-perry-product-map-20260826`
Policy: `APPEND_ONLY_FAIL_CLOSED`

## Purpose

Conservatively transform the URL-only evidence stage into provisional identity clusters without auto-creating canonical products.

## Results

- Input explicit-code evidence rows: 1,145.
- Explicit colour tokens recovered from captured URLs: 560.
- Model/code candidates: 418.
- Standard-like Fred Perry style-code candidates: 413.
- External or nonstandard code clusters requiring a documented bridge: 5.
- Explicit standard style + colour commercial-variant candidates: 790.
- External code + variant-token clusters: 17.
- Standard-style evidence still lacking an explicit colour: 192.
- Identity review items: 220.
- Non-overlapping research tasks assigned across 50 lanes: 5,265.
- Candidate-level image requirements: 7,900 (10 roles for each of 790 style-colour candidates).

## Identity safeguards

1. No canonical model, commercial variant or production variant is automatically created.
2. A commercial-variant candidate requires a standard-like style code and an explicit colour token.
3. Colour tokens such as `02B`, `08C`, `T50`, `V11`, `Z50` and three-digit codes are admitted only when explicitly present in the captured product URL structure.
4. Long retailer identifiers such as Zalando codes are retained in a separate external-code table and cannot become Fred Perry model identities without a documented bridge.
5. Evidence without explicit colour remains linked at model-candidate level and is not collapsed into a false colour variant.
6. Preferred names are provisional. They may remain blank when available titles or slugs are not sufficiently descriptive.
7. Year, factory, manufacturer, country, material, label system and image completeness remain unresolved until supported by evidence.

## 50-lane routing

- W01–W05: model-name validation.
- W06–W10: unresolved colour recovery.
- W11–W20: year and production-period resolution.
- W21–W30: factory and manufacturer attribution.
- W31–W35: material and composition resolution.
- W36–W40: label-system resolution.
- W41–W45: four-view generic image acquisition.
- W46–W50: five/six forensic macro acquisition.

Each task has one deterministic lane. Task types do not overlap between lane groups.

## Principal files in the auditable package

- `kb_model_candidate_stage.csv`
- `kb_commercial_variant_candidate_stage.csv`
- `kb_external_code_cluster_stage.csv`
- `kb_candidate_evidence_link_stage.csv`
- `kb_colour_unresolved_evidence_queue.csv`
- `kb_identity_conflict_review_queue.csv`
- `kb_research_task_queue_w001.csv`
- `kb_candidate_image_role_rollup.csv`
- `manifest.json`
- `SHA256SUMS.txt`

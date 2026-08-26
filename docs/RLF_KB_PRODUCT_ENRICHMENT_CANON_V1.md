# RLF KB — Canonical product enrichment and forensic image requirements v1

Date: 2026-08-26
Scope: Fred Perry knowledge base, historical and current products.
Separation rule: this dataset is the KB corpus. It is not the commercial PRELOVED pool and it must not apply pool filters such as current availability, discount, margin, geography or resale suitability.

## 1. Unit of record

One record represents one unique product identity at the most precise evidenced level available:

`model/style + colourway + period/season + factory/production origin + material/composition variant`

Different colours, factories, periods, material compositions or label systems must not be collapsed when the evidence shows they are distinct.

## 2. Mandatory core fields

- `kb_product_id`: stable RLF identifier.
- `brand`: always Fred Perry when verified.
- `model_name_normalized`: official or historically evidenced model name.
- `style_code`: exact manufacturer/retailer style code when visible.
- `colour_name_official`: official colour name exactly as sourced.
- `colour_code`: exact colour code when visible.
- `colour_visual_normalized`: controlled visual colour family, separate from the official name.
- `year_exact`: only when directly evidenced.
- `season`: exact season code/name when directly evidenced.
- `year_from` / `year_to`: bounded range when exact dating is not possible.
- `dating_basis`: catalogue, dated advertisement, retailer archive, label chronology, provenance, manufacturing record or other explicit evidence.
- `factory_name`: exact factory or production site only when evidenced.
- `factory_country`: country of manufacture exactly as shown on product/label or primary documentation.
- `manufacturer_legal_entity`: manufacturing company when evidenced.
- `material_outer`: full outer composition.
- `material_lining`: full lining composition where applicable.
- `material_trim`: trims/rib/collar/secondary composition where applicable.
- `care_instructions_raw`: exact care text or symbols.
- `product_category`: controlled RLF category.
- `gender_marketing`: men, women, kids, unisex or unknown; this is descriptive only.
- `source_url`: every observed product URL, active or inactive.
- `source_status`: active, out_of_stock, archived, sitemap_only, removed, blocked or unknown.
- `evidence_grade`: A primary/direct, B strong independent, C provisional, X rejected.
- `captured_at_utc`.

No field may be filled by guesswork. Unknown values remain explicitly unknown with a reason.

## 3. Image requirement per unique product

Target: 9–10 useful images per unique product.

### 3.1 Four generic product images

1. `GEN_FRONT_FULL` — complete front view.
2. `GEN_BACK_FULL` — complete back view.
3. `GEN_SIDE_OR_INTERIOR` — side, open/interior or construction view appropriate to product type.
4. `GEN_CONTEXT_DETAIL` — collar, placket, embroidery, sole, hardware, pattern or another identifying construction detail.

For accessories or footwear, equivalent views are used: front/top, rear/sole, side/interior, construction/detail.

### 3.2 Five or six forensic macro images

1. `MACRO_BRAND_LABEL_FRONT` — full front face of neck/main brand label.
2. `MACRO_BRAND_LABEL_BACK_OR_STITCHING` — reverse, fold, attachment and stitch construction.
3. `MACRO_CARE_LABEL_FRONT` — first face of wash/care/composition label.
4. `MACRO_CARE_LABEL_REVERSE` — reverse/additional leaf with composition, country, warnings or distributor data.
5. `MACRO_STYLE_SIZE_COLOUR_CODE` — style, size, colour, barcode, season, lot or production code.
6. `MACRO_FACTORY_OR_CONSTRUCTION` — country/factory evidence, manufacturer line, RN/CA/company code, seam, zipper, buttons, embroidery reverse, sole stamp or another diagnostic manufacturing feature.

The sixth macro is mandatory whenever the fifth image does not independently show production origin or manufacturing evidence.

## 4. Image evidence rules

- Images must be downloaded from the actual source or supplied garment evidence; never generated, reconstructed or visually invented.
- Preserve original bytes when legally and technically accessible.
- Store source URL, referring page, capture date, MIME type, dimensions, SHA-256 and perceptual hash.
- Keep an untouched original and a normalized derivative.
- Normalized derivatives may correct orientation, crop empty borders and standardize canvas; they must not alter label content, colour, stitching or defects.
- A macro must contain enough native resolution for letters, symbols, weave or stitching to be inspected. Upscaling alone does not convert a low-resolution image into forensic evidence.
- Near-duplicates are linked but not counted as separate required views.
- Watermarked images remain watermarked; no watermark removal.

## 5. Dating policy

Priority order:

1. Dated primary catalogue, line sheet, advertisement or manufacturing document.
2. Exact season/style code tied to an authoritative source.
3. Same garment with dated provenance and matching physical labels/construction.
4. Independent contemporary retailer or press archive.
5. Label chronology and construction comparison, expressed only as a range.

Never convert a marketplace listing date into a manufacturing year.

## 6. Factory attribution policy

Factory attribution requires at least one of:

- explicit manufacturer/factory text on a label;
- traceable factory/company code;
- primary supply/manufacturing document;
- independently verified bridge between legal manufacturer, plant and the exact label/product family.

`Made in <country>` is country evidence, not automatically a factory identity.

## 7. Material policy

Priority order:

1. physical care/composition label;
2. official product page or line sheet for the exact style/colour/period;
3. authoritative retailer data matching the exact style code;
4. secondary source, retained as provisional.

Generic assumptions such as “cotton polo” are prohibited.

## 8. Completeness states

- `URL_ONLY`: product URL captured; no identity promotion.
- `IDENTITY_PARTIAL`: model/style or colour evidenced, but key fields missing.
- `GENERIC_IMAGE_SET`: four generic views complete.
- `FORENSIC_PARTIAL`: one to four forensic macros.
- `FORENSIC_COMPLETE`: five/six required forensic macros complete.
- `KB_COMPLETE_A`: core fields and image set complete with grade-A evidence.
- `KB_COMPLETE_B`: complete with at least strong grade-B evidence and explicit limitations.

No automatic promotion. Every promotion must pass schema validation and evidence checks.

## 9. Immediate pipeline implication

All discovered product URLs are retained irrespective of sale status. The next processing stages are:

1. identity extraction and cross-store deduplication;
2. model/style/colour normalization;
3. image acquisition and role classification;
4. label/care-code transcription;
5. year/season investigation;
6. factory/manufacturer attribution;
7. material verification;
8. evidence grading and KB promotion.

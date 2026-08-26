# RLF KB — Market-instance and image-evidence canon v1

Canonical date: 2026-08-26  
Policy: `APPEND_ONLY_FAIL_CLOSED`

## 1. Commercial chronology is not production chronology

The following observations belong to a regional commercial evidence instance unless a primary source explicitly states otherwise:

- `Product Quarter`;
- `New-in` date;
- regional release date;
- retailer season classification;
- web publication or sitemap modification date.

They may bound research but must never be written automatically into `production_year_exact`, `production_year_from`, `production_year_to` or factory chronology.

The same `style_code + colour_code` may have several linked regional market instances and several production instances. This does not create additional model families or commercial variants by itself.

## 2. Exact-variant image evidence

An image may satisfy a role for a commercial or production variant only when at least one of these anchors is present:

1. the exact style and colour code are visible in the image;
2. the source page is uniquely bound to the exact style-colour and the image is part of that exact product gallery;
3. another immutable evidence key links the image to the exact variant.

Visual similarity alone is insufficient.

## 3. Model-level references

A real label image that visibly identifies a model/style but a different colour or unknown production period is retained as `MODEL_LEVEL_REFERENCE`.

It may support:

- discovery of label-system families;
- vocabulary and code-pattern research;
- generation of targeted follow-up tasks.

It may not satisfy any forensic image role for another colourway or production variant.

## 4. Hangtags versus sewn labels

A retail hangtag and an interior sewn label are different evidence types.

A hangtag may satisfy `MACRO_STYLE_SIZE_COLOUR_CODE` when the exact variant code is legible. It does not prove:

- country of manufacture;
- factory or manufacturer;
- garment composition;
- care instructions;
- sewn-label system;
- production date.

Those claims require their own evidence.

## 5. Derivative and duplicate images

Different resolutions, crops or CDN transformations of the same photograph are one evidence image for role-completeness purposes. Preserve all original locators when useful, but promote only the best evidenced/usable representative.

## 6. Negative-memory rule

A failed query/source/method is recorded with:

- exact scope key;
- query or locator;
- method;
- result class;
- timestamp.

It is not repeated unless the source changes materially, a new exact anchor becomes available or a different authorized access method is used.

## 7. W003B controlled result

For the W003B fast-track set:

- `M3600::350` has one exact hangtag macro eligible for `MACRO_STYLE_SIZE_COLOUR_CODE`;
- `M3600/S07` has one model-level interior label reference and is not transferable to the eight fast-track colourways;
- no exact factory is resolved;
- no exact care-label set is complete;
- no production variant is promoted automatically.

# RLF KB — Factory attribution and GTIN evidence canon v1

Canonical date: 2026-08-26  
Policy: `APPEND_ONLY_FAIL_CLOSED`

## Purpose

This canon separates a supported industrial bridge from an exact legal factory identity and prevents GTIN/EAN records from inflating the product census.

## Factory-attribution levels

1. `COUNTRY_SUPPORTED`
   - Evidence supports only the country of manufacture.
2. `FACTORY_CLUSTER_SUPPORTED`
   - A primary or authoritative source links a model, country and bounded period to a named factory or industrial cluster.
3. `LEGAL_ENTITY_SUPPORTED`
   - Evidence identifies the legal manufacturing entity, but not necessarily the exact plant that made the observed item.
4. `STREET_LEVEL_FACILITY_SUPPORTED`
   - Evidence identifies the exact production facility and address.
5. `EXACT_ITEM_FACTORY_SUPPORTED`
   - The observed item's physical label, factory code, production document or equivalent evidence links that exact evidence instance to the facility.

A higher level may not be inferred from a lower one.

## Winzen bridge

Fred Perry's official factory article states that remaining Fred Perry Shirt styles including M3600, G3600 and M6000 have been made in China since 2015 by Winzen, a factory in the Zhongshan area.

For an M3600 evidence instance that independently supports:

- style `M3600`;
- country `China`;
- a production or commercial period no earlier than 2015;

RLF may assign:

- `factory_cluster_id = WINZEN_ZHONGSHAN`;
- `factory_attribution_level = FACTORY_CLUSTER_SUPPORTED`;
- `factory_attribution_scope = MODEL_COUNTRY_PERIOD`.

This does **not** prove:

- the exact legal company that invoiced or exported the item;
- a street address;
- a particular building or production line;
- that every M3600 evidence instance in every market was made at the same plant;
- an exact production date.

The exact item remains below `EXACT_ITEM_FACTORY_SUPPORTED` until physical or documentary item-level evidence closes the bridge.

## Legal entities and facilities

Corporate references such as Winzen International Limited, Winzen Knitwear Limited or Chinese-language Winzen entities must remain separate records unless authoritative evidence proves that they are the same legal entity or exact production facility.

A registered office, export office or historical corporate address is not automatically a manufacturing plant.

## GTIN / EAN

A GTIN/EAN is an evidence identifier for a specific commercial SKU, normally:

`style + colour + size + market/packaging context`

It may support:

- style code;
- colour code;
- size;
- commercial SKU identity;
- cross-source deduplication.

It may not independently prove:

- factory;
- country of manufacture;
- material;
- production period;
- sewn-label system;
- authenticity of an unrelated physical garment.

Different sizes of the same style-colour legitimately have different GTINs. They remain size-level identifiers under one commercial variant and do not create separate production variants by themselves.

## Trade records

Customs and shipment records may support model/style, material class, exporting country and bounded shipment chronology. A redacted shipper or consignee does not resolve an exact manufacturer.

A trade date is a shipment date, not a manufacturing date.

## Open Supply Hub access failures

An HTTP `401` or other authorization failure is stored as `AUTH_REQUIRED`.

It must never be interpreted as:

- zero facilities;
- an empty Tier One list;
- proof that a factory is absent;
- permission to fabricate a replacement list.

## Promotion rule

Factory-cluster evidence, GTIN evidence or trade evidence may enrich a candidate, but none of them alone promotes a canonical production variant. Promotion still requires controlled identity review and sufficient evidence for the production-variant fingerprint.

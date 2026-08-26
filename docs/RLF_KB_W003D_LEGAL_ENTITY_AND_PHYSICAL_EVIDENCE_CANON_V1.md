# RLF KB — W003D legal entity and physical evidence canon v1

Canonical date: 2026-08-26  
Policy: `APPEND_ONLY_FAIL_CLOSED`

## 1. Legal-entity bridge versus exact plant

A legal entity may be linked to a factory cluster when the following chain is complete:

1. a primary brand source identifies the factory name or exact bilingual name;
2. a corporate, regulatory or certification source identifies the same legal name;
3. the legal entity's product scope is compatible with the observed product;
4. no contradictory entity with the same name remains unresolved.

This supports `LEGAL_ENTITY_SUPPORTED` for the industrial cluster. It does not automatically support the exact production site, a complete postal address or the exact item-to-factory link.

## 2. Winzen

Fred Perry identifies its Chinese factory as Winzen and, on the Japanese official site, as `永生針織有限公司`. Hong Kong registry and regulatory sources identify the bilingual legal entity as:

- English: `WINZEN INTERNATIONAL LIMITED`
- Chinese: `永生針織有限公司`
- Hong Kong registration number: `2870887`
- business registration number: `71143376`
- registered office: `Flat D, 9/F, Phase 5, Hong Kong Spinners Industrial Building, 760 Cheung Sha Wan Road, Kowloon, Hong Kong`

The legal entity is also listed by regenagri under certificate `CU-1075663` for dyed fabrics, men's apparel, babies' apparel and worn accessories.

For the seven fast-track M3600 candidates, the maximum supported level becomes:

`LEGAL_ENTITY_SUPPORTED`

with entity `WINZEN_INTERNATIONAL_LIMITED_2870887` and factory cluster `WINZEN_ZHONGSHAN`.

The Hong Kong address is a registered/corporate office and must not be represented as the Zhongshan production building. The exact Zhongshan site/address and exact item-to-plant bridge remain open.

## 3. Shilla Glovis Vietnam and L7255

Trade records identify `SHILLA GLOVIS VIETNAM COMPANY LIMITED` as exporter/manufacturer of Fred Perry `L7255 CLASSIC BARREL BAG` records from Vietnam. The Vietnamese legal entity is:

- legal name: `SHILLA GLOVIS VIETNAM COMPANY LIMITED`
- Vietnamese name: `CÔNG TY TNHH SHILLA GLOVIS VIỆT NAM`
- tax/registration number: `1201560444`
- principal activity: manufacture of suitcases, bags and similar products
- facility locality: Cho Moi Quarter, Go Cong Ward, Vietnam

The company's own location page identifies the Shilla Glovis International Vietnam factory at Cho Moi Quarter.

This supports:

- `LEGAL_ENTITY_SUPPORTED` at style level `L7255`;
- `FACILITY_SITE_SUPPORTED` at style level `L7255`;
- Vietnam as production country for the exact `L7255-81A` commercial candidate.

`FACILITY_SITE_SUPPORTED` means that the named operating site/locality is supported. It does not imply a complete street-number postal address.

It does **not** support `EXACT_ITEM_FACTORY_SUPPORTED` for colour `81A` until a trade record, production document, label or physical evidence explicitly connects `81A`, GTIN `5063460129686`, or the observed evidence instance to that facility.

## 4. GTIN for L7255-81A

Exact commercial identifier:

- style-colour: `L7255-81A`
- GTIN/EAN: `5063460129686`
- country of origin: Vietnam

The GTIN supports exact commercial identity and cross-source linking. It does not independently prove the factory.

## 5. Model-level sewn-label references

Physical labels for other M3600 colourways may be preserved as model-level references. They may support:

- label layout;
- order of fields;
- existence of `MADE IN CHINA`;
- style/colour/auxiliary code syntax;
- Fred Perry corporate-address variants.

They may not satisfy a forensic macro role for another colourway.

Examples recovered for the model corpus:

- `M3600/S31/01885/409`
- `M3600/E36/01885/395`
- previously retained `M3600/S07/1950/409`

The numeric suffixes remain uninterpreted until a primary coding key or repeated controlled evidence resolves their semantics.

## 6. Physical-image promotion

An image is promoted to an exact forensic role only when one of these anchors is visible or immutable:

1. exact style and colour code in the image;
2. exact GTIN mapped to the style-colour-size;
3. exact unique listing whose complete gallery is demonstrably one physical item;
4. primary production or catalogue document linking the image to the exact variant.

Visual similarity alone is insufficient.

## 7. Promotion rule

`LEGAL_ENTITY_SUPPORTED`, `FACILITY_SITE_SUPPORTED` at model/style level, GTIN evidence and model-level labels enrich the candidate but do not alone promote a canonical production variant.

# RLF Parallel50 v25.55.3 — Delta 0051 QA closure

Date: 2026-08-24  
Truth boundary: canonical suppliers remain **151**. READY_TO_MERGE remains **12**. Projected after an actual idempotent merge remains **163**.

## Purpose

Delta 0051 does not create artificial supplier growth. It closes the legal-identity review of the three unresolved Delta 0050 candidates and converts that review into a persistent runtime quarantine so the same domains do not consume repeated provisional QA.

## Resolved identities

| Domain | Decision | Reason |
|---|---|---|
| vintagegyvulys.com | QUARANTINE_IDENTITY | Professional Lithuanian vintage operation and Fred Perry evidence are plausible, but no contracting owner, company/individual registration code, VAT identifier or legal address is published. |
| vintagecloset.gr | QUARANTINE_IDENTITY | Professional Greek vintage shop, but the terms identify only the trade name; fiscal identity is absent and official pages expose conflicting Thessaloniki addresses. |
| vintagebulgariashop.com | QUARANTINE_IDENTITY | Professional Bulgarian vintage ecommerce, but only a trade name, email and Instagram account are published; no UIC/VAT, contracting owner or legal address is fixed. |

`vintager2.de` was confirmed as the existing canonical supplier `SUP-M-0102`, qualified in Delta 0041. It remains a duplicate and must never create a new row.

`loopi.com` remains permanently rejected because the operator is UK-based and therefore outside the mandatory EU-27 scope.

## Runtime changes

- New status: `QUARANTINE_IDENTITY`.
- New metric: `quarantinedIdentity`.
- Persistent `KNOWN_IDENTITY_QUARANTINE_DOMAINS` registry.
- Quarantined domains cannot become `QUALIFIED_PROVISIONAL` until the registry is deliberately revised with primary legal evidence.
- Profile advanced to `EU27_IDENTITY_DEDUP_QUARANTINE_V7`.
- Next authenticated sweep is cycle 5.
- Bootstrap remains closed.
- Product gates remain fail-closed: ACCEPTED_4K = 0, live = 0, reserves = 0.

## Re-entry rule

A quarantined identity can be released only when all of the following are fixed from primary evidence:

1. Contracting legal person or natural-person trader.
2. National registration, fiscal or VAT identifier.
3. Canonical legal/registered address.
4. Exact relation between that identity and the ecommerce domain.
5. Complete multi-key deduplication against domain, fiscal ID, legal name, address, email and phone.

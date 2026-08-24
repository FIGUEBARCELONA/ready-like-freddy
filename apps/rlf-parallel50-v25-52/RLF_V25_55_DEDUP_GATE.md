# RLF v25.55 — Identity deduplication gate

Status: code-complete, fail-closed preparation for Delta 0051.

## Truth boundary

- Canonical qualified suppliers: 151.
- READY_TO_MERGE accumulated: 12.
- Projected only after a real idempotent merge: 163.
- ACCEPTED_4K / live / reserves: 0 / 0 / 0.
- No count is modified by this implementation.

## Changes

1. Discovery pairs one product-oriented query with one country-specific legal-identity query per lane.
2. Candidate records expose VAT/registration identity, contracting name, address signal, country basis and lane-country agreement.
3. Deduplication runs by domain, known identity key and identity collision inside the same sweep.
4. The runtime publishes canonical-registry coverage. The static runtime registry is not represented as the complete 151-row master; therefore every promotion remains subject to manual deduplication against the editable Delta 0044 master.
5. Product promotion and replacement remain restricted to ACCEPTED_4K, currently empty.

## Acceptance rule

`QUALIFIED_PROVISIONAL` means ready for manual legal review only. It never increments the canonical 10K count. Delta 0051 may contain a new READY_TO_MERGE identity only after exact master comparison by canonical key, legal identifier, domain, operator name, address, email and telephone.

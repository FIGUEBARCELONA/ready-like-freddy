# RLF KB — Reviewed checkpoint V2.9

Date: 2026-08-26  
Wave: `W003F_CODE_SEMANTICS`  
Policy: `APPEND_ONLY_FAIL_CLOSED`

## Controlled result

- 10 controlled M3600 full-code comparison records.
- Component 1 is the style/model code.
- Component 2 is the colour code.
- `1950` is ruled out as garment size and colour.
- `419` is ruled out as a direct garment-size code: the identical `M3600/350/1950/419` code is recorded on tag sizes L and XL.
- `409` is ruled out as a unique colour identifier.
- Positive semantics of `1950`, `01885`, `418`, `419`, `396`, `435`, `387`, `409` and `395` remain unresolved.
- `M3600::350` remains in multi-full-code review; no automatic split or merge.
- 3 unpromoted production-instance candidates remain staged.
- 5 priority M3600 colourways still lack an exact full code: 04C, 85B, 87B, T50 and T60.
- 0 new exact forensic macro roles.
- 55 original forensic tasks remain open or partially resolved.
- Exact Winzen Zhongshan operating site remains open.
- Exact `L7255-81A` / GTIN `5063460129686` to Shilla Glovis item-level link remains open.
- 0 canonical production variants promoted.

## Artifact digests

- Tracker `RLF_KB_TRACKER_V2_9_2026-08-26.xlsx`  
  SHA-256: `4d4137004e1b796bb3e736c075cfdc6a5f4e5d8fcd16cfc54e293e104cb99c66`

- Delta `RLF_KB_W003F_CODE_SEMANTICS_V2_9_2026-08-26.zip`  
  SHA-256: `3e64295e9434888dc0b83ab24ebf2d89d379f7894187c32560ff3461f7208c7b`

- Self-contained checkpoint `RLF_KB_CHECKPOINT_V2_9_2026-08-26.zip`  
  SHA-256: `2f48d5e2352c7d78f3a982f5374a18c2cd168dd95b5f4f7dc522d8c732338c27`

## Runtime-base note

The active runtime did not contain the V2.8 binary checkpoint. V2.9 is self-contained through:

- the V2.7 self-contained checkpoint;
- both immutable W003E raw collector artifacts;
- the canonical V2.8 checkpoint reference and digests;
- cumulative V2.9 tables and tracker.

## Next strict block

W003G must acquire legible same-item labels for U98 and both 350 full-code candidates, recover exact full codes for 04C/85B/87B/T50/T60, and seek a primary or controlled positive coding key for components 3 and 4. Winzen-site and L7255–Shilla exact-item bridges remain independent open lanes.

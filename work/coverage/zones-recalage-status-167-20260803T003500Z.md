# Statut recalage B-prime 167

Contrat : `zones-recalage-status-167/v1`. Source overlap : `5ec1d919815e0c2b98e10587c69fdb0e439fd16e` (work/coverage/overlap-bprime167-vs-geo-20260802.json).
Provenance : radar@800ee90 (PREVIEW non ratifie; merge PR #436 a venir).

Règle fermée : `proof_live_verifiable` est `deja_v2_servi` seulement en matrice `v2` et `recale_ok` seulement en `acceptable`/`candidate`; les autres états ne prouvent pas une géométrie vivante et restent `recale_missing`. `proof_v1_dead` reprend strictement la discovery (`NEEDS_RECALAGE_PDF` → `recale_missing`, `UNRESOLVED` → `unresolved`). `no_proof_url_signal` est `recale_missing` par défaut, sauf `v2`. Toute absence de ligne matrice est mesurée comme absence de géométrie servie et reste `recale_missing`.

Total : **167** (attendu 167); somme des statuts : 167.
Répartition : recale_ok=2, recale_missing=147, unresolved=1, deja_v2_servi=17, hors_scope=0.
Exception : aucune.

Recalcul : `npx tsx acquisition/src/zones-recalage-status-run.ts --out=work/coverage/zones-recalage-status-167-20260803T003500Z.json --markdown=work/coverage/zones-recalage-status-167-20260803T003500Z.md`.

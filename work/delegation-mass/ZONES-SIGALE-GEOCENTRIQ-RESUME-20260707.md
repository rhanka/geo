# ZONES SIGALE / Geocentriq resume - 2026-07-07

Scope: reprendre les plateformes SIGALE et Geocentriq pour le residu zones non servi,
chercher les couches non encore presentes sur S3, garder le gate strict.

## Actions

- Lu les runners `acquisition/src/zones-sigale-run.ts` et `acquisition/src/zones-geocentriq-run.ts`.
- Lu les rapports existants SIGALE/Geocentriq sous `work/delegation-mass/` et `work/coverage/`.
- Scanne le catalogue Altus SIGALE public: 12 dossiers `MRC###`.
- Re-probe SIGALE sur les dossiers non reportes dans cette reprise: `060`, `220`, `330`.
- Inspecte les dossiers Altus atypiques `070`, `250`, `340`.
- Scanne les nodes Geocentriq `gs200..gs230`.
- Re-probe Geocentriq `temiscamingue` et `bellechasse`.
- Scanne statiquement les 343 slugs `zones!=done` avec detection explicite `sigale` / `geocentriq`.

## Resultats SIGALE

- `MRC060`: 11 couches valides, 11 deja servies sur S3, 0 nouvelle.
- `MRC220`: 9 couches valides, 9 deja servies sur S3, 0 nouvelle.
- `MRC330`: 18 couches valides, 18 deja servies sur S3, 0 nouvelle.
- `MRC070`: uniquement `Image_Aerienne_2015`, pas de service zonage `<code>_Publique`.
- `MRC250`: uniquement imagerie 2018/2021/2024, pas de service zonage `<code>_Publique`.
- `MRC340`: aucun service publie.

Les rapports existants couvrent aussi `030`, `050`, `200`, `380`, `410`, `980`; aucun `wasServed=false` exploitable n'y etait present.

## Resultats Geocentriq

- Scan nodes `gs200..gs230`: seuls `gs201` et `gs202` exposent des FeatureTypes zonage.
- `gs201` / Bellechasse: 6 couches valides, 6 deja servies sur S3, 0 nouvelle; 14 munis sans FeatureType zonage.
- `gs202` / Temiscamingue: 16 couches valides, 16 deja servies sur S3, 0 nouvelle; 3 rejets stricts `zone-invalid`.

## Residuel statique

- Lot scanne: 343 slugs `zones!=done`.
- Rapport: `byPlatform.none=343`; aucun marqueur `sigale` ni `geocentriq`.
- Limite constatee: beaucoup de sites municipaux repondent en `fetch-fail`, donc cette sonde complete le scan catalogue mais ne le remplace pas.

## Decision gate

Aucun depot zones n'a ete lance: tous les candidats qui passent le gate strict sont deja servis sur S3 (`wasServed=true`), et les autres sont soit absents, soit imagerie, soit rejetes par le gate anti-invention. Aucun lot-zone/lots-enriched n'a ete relance, puisqu'aucun nouveau zonage n'a ete depose.

## Artefacts

- `work/delegation-mass/zones-platform-sigale-altus-catalog-20260707.json`
- `work/delegation-mass/zones-platform-probe-sigale-060-20260707.json`
- `work/delegation-mass/zones-platform-probe-sigale-220-20260707.json`
- `work/delegation-mass/zones-platform-probe-sigale-330-20260707.json`
- `work/delegation-mass/zones-platform-geocentriq-node-scan-20260707.json`
- `work/delegation-mass/zones-platform-probe-geocentriq-temiscamingue-20260707.json`
- `work/delegation-mass/zones-platform-probe-geocentriq-bellechasse-20260707.json`
- `work/delegation-mass/zones-platform-residual-slugs-20260707.txt`
- `work/delegation-mass/zones-platform-residual-probe-20260707.json`

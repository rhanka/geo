# Re-fold palier 167 — état au 2026-08-08

Palier 1 : 10 candidats lus dans `work/coverage/_refold-167-candidates.txt`, après exclusion des 7 villes déjà re-foldées de `refold-immo-002-20260807.json`. Le contrôle S3 HEAD/report confirme que 4 géométries zonage sont servies et que 6 sont absentes. Les 5 lignes `recovered-prior` proviennent du journal local préexistant et sont conservées comme preuve de travail déjà déposé ; elles ne sont pas rejouées.

| muni | col-12 avant→après | col-13 avant→après | état | coverage-gap restant | backup / miroir / stamp |
|---|---:|---:|---|---|---|
| ange-gardien | 1318→1318 | 40→40 | au-plafond | 237 non assignés ; 1515 normes absentes | oui / flat-only / `2026-08-03T210326698ZZ` |
| baie-durfe | — | — | skip | `qc-zonage non servi` | aucun |
| beaconsfield | — | — | skip | `qc-zonage non servi` | aucun |
| beauharnois | — | — | skip | `qc-zonage non servi` | aucun |
| blainville | — | — | skip | `qc-zonage non servi` | aucun |
| bois-des-filion | — | — | skip | `qc-zonage non servi` | aucun |
| boisbriand | 9965→9965 | 1399→1399 | au-plafond | 4 non assignés ; 8570 normes absentes | oui / flat-only / `2026-08-03T210434921ZZ` |
| boucherville | 16242→16242 | 3530→3530 | au-plafond | 27 non assignés ; 12739 normes absentes | oui / flat-only / `2026-08-03T210609624ZZ` |
| brossard | 24793→24793 | 366→366 | au-plafond | 30 non assignés ; 24457 normes absentes | oui / flat-only / `2026-08-03T213504887ZZ` |
| calixa-lavallee | — | — | skip | `qc-zonage non servi` | aucun |

## Totaux du palier

- 10 traitées ; 96 candidates restent après ce palier (les 7 exclues ne sont pas recomptées).
- Déposées : 4 ; au-plafond : 4 ; skip coverage-gap : 6.
- Gain réel : col-12 **+0 assigné**, col-13 **+0 norme**.
- Gaps quantifiés sur géométrie servie : col-12 **298** lots non assignés ; col-13 **47 281** normes absentes. Les 6 villes sans zonage servi restent non mesurées et inchangées.
- Escalade zones : baie-durfe, beaconsfield, beauharnois, blainville, bois-des-filion, calixa-lavallee.
- Aucun objet S3 n’est committé ; le fichier JSON porte l’état et les stamps de backup/mirror.

## Travail récupéré avant ce palier

`candiac`, `carignan`, `chambly`, `chateauguay` sont au-plafond (dépôt antérieur, gain nul). `charlemagne` reste skip `geometry-suspect` (21 lots hors de toute zone servie), sans backup ni dépôt. Ces entrées sont dans le JSON pour rendre la reprise idempotente, sans les fabriquer ni les rejouer.

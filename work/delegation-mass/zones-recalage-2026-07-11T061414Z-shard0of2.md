# Recalage PDF zones — shard 0/2 — 2026-07-11T061414Z

Règle appliquée : uniquement les slugs dont l'index dans la liste complète triée est
pair (`index % 2 == 0`). Aucun harvest AGOL owner, aucun traitement Python, aucun GCP,
code ou label inventé.

## Résultat

- L'audit précédent couvrait déjà 151/151 slugs pairs non-done par dépôt ou preuve :
  `zones-recalage-2026-07-11T040131Z-shard0of2-audit.{md,json}`.
- Le seul blocage rejouable après reset fournisseur, `sainte-henedine`, a été repris.
- Nouveau dépôt net : 1 (`sainte-henedine`).
- Scoreboard zones : 816 → 817.
- Résidu pair actuel : 150 slugs, dont 142 buckets PDF; ils ont tous une disposition
  dans l'audit précédent. Aucun slug pair sans preuve ne reste.

## Sainte-Hénédine — T1 GeoPDF multi-feuillets + Claude Vision

Sources officielles locales :

- `work/pdf-cache/sainte-henedine-plan-agricole.pdf`;
- `work/pdf-cache/sainte-henedine-plan-urbain.pdf`.

Le premier essai a révélé que l'ancien dictionnaire de 18 codes était incomplet et
contenait des familles absentes des plans. Il n'a pas été servi. Le dictionnaire final
`work/zonage-norms/sainte-henedine-official-plans-codes.json` contient 52 codes réels,
verbatim et visibles sur les deux plans officiels (`A-*`, `I-*`, `M-*`, `P-*`, `RA-*`,
`RB-*`, `VIL-*`).

Claude Vision a été exécuté avec `claude-sonnet-4-6`, effort `xhigh`, sans fallback
Mistral : 24 lectures agricoles et 42 lectures urbaines, 66/66 validées exactement
contre le dictionnaire, 0 rejet. Les deux géoréférencements embarqués sont
`NAD_1983_MTM_7`, avec résidus de 0,079 m et 0,274 m.

Gates finaux : 52 codes distincts, centroïde labels/cadastre à 1,054 km, aucun code
séquentiel ou d'affectation, 51 entités servies, 1083/1106 lots assignés (97,92 %) et
96,43 % de surface cadastrale couverte. Dépôt :
`normalized/ca-qc-zonage/qc-zonage-sainte-henedine.geojson`.

## Inline immobilier

- `lot-zone-join-run` : vérifié et déposé, 1106 lignes, 97,92 % assignées.
- `lots-enriched-run` : déposé, `zone_code=97,92 %`, `surface=100 %`,
  `code_postal=100 %`, `adresse=90,24 %`.
- Warning normes : 0 % de correspondance, car le dépôt normes existant ne contient
  que `RA`; il est incomplet et n'a pas servi de dictionnaire pour ce dépôt.

## Conclusion

Le changement d'état externe (quota Claude rétabli) a débloqué le dernier cas
rejouable du shard pair. Les 150 slugs encore non-done restent couverts par les preuves
et dispositions de l'audit précédent; aucune nouvelle tentative ne serait honnêtement
productive sans nouvelle source officielle ou changement technique externe.

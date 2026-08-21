# Backlog acquisition — 236 gaps zonage route-B — 2026-08-21

READ-ONLY. Classification des **236** munis route-B (zonage non servi) pour le cutover immo.
**236 = 220 gate-slugs + 16 data-gaps i-arch** (post-reconciliation, UN SEUL record cohérent : dans les 236,
« `qc-zonage-<slug>` non servi = gap de couverture », dimensions uniformes).
Source des 220 : `work/coverage/zones-bareslug-alias-worklist-20260821.json` (f2459f44) ; 16 data-gaps : ajout i-arch. Croisé avec la worklist recalage
`work/coverage/zones-pdf-recalage-worklist-incohort-20260811.json` (2b9a5de2) pour les 236.

## Contrat N-A (i-arch — CONTRAT_ATTESTATION_ABSENCE_SOURCE)

Un candidat un-zonable **N'EST PAS N-A**. Absence de source ≠ absence de zonage. Sans **attestation d'absence
rejouable** (source + requête + résultat-absence + date), l'état reste **UNKNOWN/source-gap**. Aucune attestation
n'a été produite ici → les **3 classes sont TOUTES UNKNOWN/source-gap et NOT-N-A**.

## Résumé (partitions fermées, 236 = 6 + 216 + 14)

| Classe | Nombre | coverage_state | na_status |
|--------|--------|----------------|-----------|
| already-in-recalage-worklist | 6 | UNKNOWN/source-gap | NOT-N-A |
| new-gap | 216 | UNKNOWN/source-gap | NOT-N-A |
| candidate-un-zonable | 14 | UNKNOWN/source-gap | NOT-N-A (absence-proof=TODO) |

- **origine** : 220-gate-slug = 220, 16-data-gap i-arch = 16
- **already-in-recalage-worklist** — répartition par tier : T3=6
- **overlap worklist ∩ un-zonable** : aucun
- **sans qc-lots servi non plus (i-arch)** : austin

## ALREADY-IN-RECALAGE-WORKLIST (6) — capability-gated recalage

| slug | origine | tier | coverage_state | na_status |
|------|---------|------|----------------|-----------|
| beloeil | 220 | T3 | UNKNOWN/source-gap | NOT-N-A |
| pointe-calumet | 220 | T3 | UNKNOWN/source-gap | NOT-N-A |
| saint-placide | 220 | T3 | UNKNOWN/source-gap | NOT-N-A |
| sainte-anne-de-bellevue | 220 | T3 | UNKNOWN/source-gap | NOT-N-A |
| sainte-anne-des-plaines | 220 | T3 | UNKNOWN/source-gap | NOT-N-A |
| sainte-therese | 220 | T3 | UNKNOWN/source-gap | NOT-N-A |

## CANDIDATE-UN-ZONABLE (14) — UNKNOWN, PAS N-A (heuristique routage)

| slug | origine | tier | coverage_state | na_status |
|------|---------|------|----------------|-----------|
| baie-johan-beetz | 220 | — | UNKNOWN/source-gap | NOT-N-A (absence-proof=TODO) |
| blanc-sablon | 220 | — | UNKNOWN/source-gap | NOT-N-A (absence-proof=TODO) |
| bonne-esperance | 220 | — | UNKNOWN/source-gap | NOT-N-A (absence-proof=TODO) |
| gros-mecatina | 220 | — | UNKNOWN/source-gap | NOT-N-A (absence-proof=TODO) |
| longue-pointe-de-mingan | 220 | — | UNKNOWN/source-gap | NOT-N-A (absence-proof=TODO) |
| matagami | 220 | — | UNKNOWN/source-gap | NOT-N-A (absence-proof=TODO) |
| natashquan | 220 | — | UNKNOWN/source-gap | NOT-N-A (absence-proof=TODO) |
| riviere-saint-jean | 220 | — | UNKNOWN/source-gap | NOT-N-A (absence-proof=TODO) |
| saint-augustin--le-golfe-du-saint-laurent | 220 | — | UNKNOWN/source-gap | NOT-N-A (absence-proof=TODO) |
| la-tuque | 16-data-gap | — | UNKNOWN/source-gap | NOT-N-A (absence-proof=TODO) |
| eeyou-istchee-james-bay | 16-data-gap | — | UNKNOWN/source-gap | NOT-N-A (absence-proof=TODO) |
| aguanish | 16-data-gap | — | UNKNOWN/source-gap | NOT-N-A (absence-proof=TODO) |
| caniapiscau | 16-data-gap | — | UNKNOWN/source-gap | NOT-N-A (absence-proof=TODO) |
| cote-nord-du-golfe-du-saint-laurent | 16-data-gap | — | UNKNOWN/source-gap | NOT-N-A (absence-proof=TODO) |

> Ces slugs sont des territoires vastes/nordiques (Basse-Côte-Nord / Minganie côtière isolée / Nord-du-Québec / Jamésie)
> où l'absence de zonage municipal est **plausible mais NON prouvée**. Aucune attestation d'absence rejouable n'existe →
> ils restent **UNKNOWN/source-gap**, **NOT-N-A**. Routés vers un futur travail d'attestation d'absence.

## NEW-GAP (216) — source-assessment requise

| slug | origine | tier | coverage_state | na_status |
|------|---------|------|----------------|-----------|
| alleyn-et-cawood | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| aumond | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| baie-durfe | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| beaconsfield | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| beauharnois | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| begin | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| blainville | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| bois-des-filion | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| bois-franc | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| bouchette | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| brome | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| bryson | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| cacouna | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| calixa-lavallee | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| campbells-bay | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| cap-chat | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| cayamant | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| chapais | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| chartierville | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| chibougamau | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| chichester | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| clarendon | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| colombier | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| deleage | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| desbiens | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| dolbeau-mistassini | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| eastman | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| egan-sud | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| gracefield | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| grande-vallee | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| hampden | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| hebertville | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| henryville | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| kazabazua | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| kipawa | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| la-dore | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| la-martre | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| la-morandiere-rochebaucourt | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| la-patrie | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| labelle | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| lac-aux-sables | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| lac-bouchette | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| lac-edouard | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| lac-poulin | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| laforce | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| lamarche | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| lanse-saint-jean | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| larouche | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| lascension-de-notre-seigneur | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| laurierville | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| lebel-sur-quevillon | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| lery | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| les-mechins | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| lile-perrot | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| lisle-aux-allumettes | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| lisle-verte | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| litchfield | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| lochaber | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| lochaber-partie-ouest | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| longue-rive | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| lorraine | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| malartic | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| maniwaki | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| mansfield-et-pontefract | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| marieville | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| marsoui | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| mascouche | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| massueville | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| mcmasterville | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| mercier | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| messines | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| metabetchouan-lac-a-la-croix | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| mont-saint-gregoire | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| mont-saint-pierre | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| montcerf-lytton | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| napierville | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| newport | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| north-hatley | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| notre-dame-de-ham | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| notre-dame-de-la-salette | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| notre-dame-de-lorette | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| notre-dame-de-montauban | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| notre-dame-des-sept-douleurs | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| noyan | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| otter-lake | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| petite-vallee | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| pike-river | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| pincourt | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| pointe-des-cascades | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| port-cartier | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| portage-du-fort | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| portneuf-sur-mer | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| rapides-des-joachims | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| richelieu | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| riviere-a-claude | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| riviere-eternite | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| riviere-heva | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| roxton | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-adalbert | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-adelme | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-alexis-des-monts | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-andre-du-lac-saint-jean | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-arsene | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-augustin--maria-chapdelaine | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-barnabe | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-bernard | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-blaise-sur-richelieu | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-cesaire | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-charles-de-bourget | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-clement | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-cyprien--riviere-du-loup | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-cyprien-de-napierville | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-damase-de-lislet | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-edouard | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-edouard-de-maskinonge | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-eugene-dargentenay | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-eugene-de-guigues | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-francois-de-sales | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-francois-xavier-de-viger | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-fulgence | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-gerard-majella | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-henri-de-taillon | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-honore-de-shenley | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-isidore--la-nouvelle-beauce | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-isidore--roussillon | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-isidore-de-clifton | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-jacques-le-mineur | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-jean-de-cherbourg | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-jean-port-joli | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-jean-sur-richelieu | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-joseph-du-lac | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-lambert-de-lauzon | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-leon-le-grand--maskinonge | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-leonard-de-portneuf | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-louis-de-gonzague--beauharnois-salaberry | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-ludger-de-milot | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-marc-sur-richelieu | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-mathieu-de-rioux | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-modeste | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-nazaire | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-nazaire-dacton | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-norbert | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-norbert-darthabaska | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-omer | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-paul-dabbotsford | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-paul-de-la-croix | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-paul-de-lile-aux-noix | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-philibert | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-prime | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-remi | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-robert | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-roch-de-lachigan | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-roch-de-mekinac | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-roch-de-richelieu | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-samuel | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-sebastien--le-haut-richelieu | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-severe | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-severin--mekinac | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-simeon--bonaventure | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-urbain-premier | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-valentin | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saint-zenon | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-agathe-des-monts | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-angele-de-monnoir | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-angele-de-premont | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-christine | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-felicite--lislet | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-hedwidge | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-helene-de-chester | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-jeanne-darc--maria-chapdelaine | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-louise | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-madeleine-de-la-riviere-madeleine | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-marguerite | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-marie | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-marthe | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-marthe-sur-le-lac | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-martine | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-perpetue--lislet | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-rita | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-rose-du-nord | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-sabine--brome-missisquoi | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-sophie-dhalifax | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-thecle | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-ursule | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saints-anges | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| saints-martyrs-canadiens | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| senneterre--la-vallee-de-lor--2 | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| senneville | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| shawville | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| sheenboro | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| stanbridge-station | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| stanstead--memphremagog--2 | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| tadoussac | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| terrasse-vaudreuil | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| terrebonne | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| thorne | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| tourville | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| trois-rives | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| upton | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| vallee-jonction | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| vaudreuil-sur-le-lac | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| villeroy | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| waltham | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| weedon | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| yamachiche | 220 | — | UNKNOWN/source-gap | NOT-N-A |
| lile-dorval | 16-data-gap | — | UNKNOWN/source-gap | NOT-N-A |
| lile-cadieux | 16-data-gap | — | UNKNOWN/source-gap | NOT-N-A |
| austin | 16-data-gap | — | UNKNOWN/source-gap | NOT-N-A |
| saint-benoit-du-lac | 16-data-gap | — | UNKNOWN/source-gap | NOT-N-A |
| notre-dame-des-anges | 16-data-gap | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-anne-de-la-pocatiere | 16-data-gap | — | UNKNOWN/source-gap | NOT-N-A |
| saint-onesime-dixworth | 16-data-gap | — | UNKNOWN/source-gap | NOT-N-A |
| hebertville-station | 16-data-gap | — | UNKNOWN/source-gap | NOT-N-A |
| saint-bruno | 16-data-gap | — | UNKNOWN/source-gap | NOT-N-A |
| saint-guy | 16-data-gap | — | UNKNOWN/source-gap | NOT-N-A |
| sainte-jeanne-darc--la-mitis | 16-data-gap | — | UNKNOWN/source-gap | NOT-N-A |

## Méthode (anti-invention)

1. Lecture verbatim des 220 gate-slugs (work/coverage/zones-bareslug-alias-worklist-20260821.json) + 16 data-gaps i-arch → 236 (partition fermée, 0 doublon vérifié).
2. Join EXACT-slug sur la worklist recalage (2b9a5de2) → ALREADY-IN-RECALAGE-WORKLIST + tier porté.
3. Set un-zonable = heuristique géographique CURÉE (routage), jamais une assertion d'absence.
4. Reste = NEW-GAP. Partitions fermées, 236 total. Aucun slug deviné ; aucune N-A fabriquée.

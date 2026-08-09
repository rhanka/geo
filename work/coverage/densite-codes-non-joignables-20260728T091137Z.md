# Diagnostic nominatif — densités non joignables

- Généré : 2026-07-28T09:11:37.364Z ; branche : feat/cadre-acquisition ; mode : lecture seule.
- Comparaison : exacte, chaîne zone_code contre code imprimé; aucune normalisation, aucun préfixe/startsWith, aucun rapprochement.
- Artefact JSON : /home/antoinefa/src/geo/work/coverage/densite-codes-non-joignables-20260728T091137Z.json

## Chiffrage

- 6 codes distincts non joignables dans 8 lignes document publiables, soit 10 observations de code; 0 polygone porte exactement l'un de ces codes servis.
- Plafond honnête des polygones potentiellement concernés par ces six cas : 1304 (toutes les géométries des quatre collections; impact exact indéterminable sans règle autorisée).
- Les quatre lectures numériques secondaires représentent 5 énoncés dans 4 collections, plafond 229 polygones; elles ne sont pas ajoutées aux six codes absents.

## Partition fermée

| Catégorie | Effectif des cas | Plafond polygones par collections distinctes |
|---|---:|---:|
| ZONE_REELLEMENT_ABSENTE | 6 | 1304 |
| AUTRE | 3 | 195 |
| GRANULARITE_DIFFERENTE | 1 | 34 |
| FORME_DIFFERENTE | 0 | 0 |
| MILLESIME_DIFFERENT | 0 | 0 |

## Codes document / codes SIG servis

### champlain — 215 — ZONE_REELLEMENT_ABSENTE
- Documents : champlain-file-18281 (2020-05-04); champlain-file-18292 (2018-08-06); champlain-wayback-original-2009 (2009-04-06); champlain-wayback-reglement-2017-02 (2017-05-01); champlain-file-18291 (2018-07-09).
- Preuve densité champlain-file-18281 : page 192, logements/batiment, valeurs 2|6, « Nombre maximum de logements 2 Largeur minimale de la façade 6m ».
- Preuve densité champlain-file-18292 : page 182, logements/batiment, valeurs 2|6, « Nombre maximum de logements 2 Largeur minimale de la façade 6m ».
- Preuve densité champlain-wayback-original-2009 : page 179, logements/batiment, valeurs 2|6, « Nombre maximum de logements 2 Largeur minimale de la façade 6m ».
- Preuve densité champlain-wayback-reglement-2017-02 : page 182, logements/batiment, valeurs 2|6, « Nombre maximum de logements 2 Largeur minimale de la façade 6m ».
- Preuve densité champlain-file-18291 : page 203, logements/batiment, valeurs 2|6, « Nombre maximum de logements 2 Largeur minimale de la façade 6m ».
- Document verbatim : 215; SIG servis verbatim (contexte exact) : C-215, I-215.
- Échantillon SIG début : A-202, A-203, A-204, A-205, A-208, A-209, A-213, A-214, A-219, A-221, A-223, A-224, A-225, A-230, A-231, A-233, AF-201, AF-206, AF-210, AF-211, AF-217, AF-226, AF-228, C-107; fin : R-117, R-118, R-121, R-122, R-124, R-127, R-130, R-131, RU-207, RU-218, RU-232, ZR-102.
- Le document imprime 215; le SIG sert deux chaînes distinctes, C-215 et I-215. L'absence de 215 est certaine; aucune relation de forme ou de zone n'est déduite. Polygones exacts : 0; plafond collection : 65.

### clermont--charlevoix-est — 147.1-Hb — ZONE_REELLEMENT_ABSENTE
- Documents : clermont-grilles-2025-06-25 (2025-06-25).
- Preuve densité clermont-grilles-2025-06-25 : Le rapport d'ingestion conserve ce code dans missingInSig mais aucun passage/page/valeur codé n'est disponible dans les rapports locaux; aucune valeur n'est inventée..
- Document verbatim : 147.1-Hb; SIG servis verbatim (contexte exact) : 147-Ha, 148-Ha, 151-Hb.
- Échantillon SIG début : 001-F, 002-Up, 003-Af, 004-F, 005-Af, 006-Rec, 007-Af, 008-Af, 009-F, 010-Af, 011-Cn, 012-Af, 012.1-Af, 013-F, 014-Af, 015-Cn, 016-I, 017-A, 018-Af, 019-Af, 020-Rec, 022-Aad, 023-Af, 024-A; fin : 145-Ha, 146-Ha, 147-Ha, 148-Ha, 149-Ha, 150-Ha, 151-Hb, 152-Hb, 153-Ha, 154-Ha, 155-Hb, 156-Ha.
- Aucun code servi n'est cette chaîne exacte; les formes voisines servent d'autres codes et ne sont pas rapprochées. Polygones exacts : 0; plafond collection : 109.

### mont-tremblant — CA-466-1 — ZONE_REELLEMENT_ABSENTE
- Documents : mont-tremblant-annexe-a-400 (2025-08-25).
- Preuve densité mont-tremblant-annexe-a-400 : page 99, logements/batiment, valeurs 6, « (8) Le nombre maximal de logements par bâtiment est fixé à 6. ».
- Document verbatim : CA-466-1; SIG servis verbatim (contexte exact) : CA-466, CA-467, CA-467-1.
- Échantillon SIG début : AF-1013, AF-1014, AF-1018-1, AF-1030-1, AG-1014-1, AG-1014-2, AG-1015, AG-1018, AG-1026, AG-1027, AG-1028, AG-1029, AG-1030, CA-300, CA-301, CA-303, CA-304, CA-305, CA-309, CA-329, CA-421, CA-426, CA-431, CA-460; fin : VR-1010, VR-1010-1, VR-1011, VR-1012, VR-1016, VR-1017, VR-1021, VR-1022, VR-1023, VR-1024, VR-1031, VR-1032.
- Le document imprime CA-466-1; le SIG sert CA-466 et CA-467-1, entre autres, mais pas CA-466-1. Aucun lien parent/enfant ou de forme n'est déduit. Polygones exacts : 0; plafond collection : 628.

### saint-jerome — MMFD-757 — ZONE_REELLEMENT_ABSENTE
- Documents : saint-jerome-0351-000-annexe-2-2026-07-14 (2026-07-14).
- Preuve densité saint-jerome-0351-000-annexe-2-2026-07-14 : page 815, unité absente, valeurs —, preuve « 70 Coefficient d'occupation du sol (COS) min./max. 0,5 / - ».
- Document verbatim : MMFD-757; SIG servis verbatim (contexte exact) : —.
- Échantillon SIG début : CA-158, CA-159, CMD-400, CMD-407, CMD-416, CMD-417, CMD-419, CMD-420, CMD-438, CMD-440, CMD-442, CMD-443, CMD-444, CMD-451, CMD-459, CMD-460, CMD-461, CMD-462, CMD-463, CMD-464, CMD-484, CMD-485, CMD-486, CMD-487; fin : RR-123, RR-124, RR-127, RR-152, RR-160, RR-168, VM-115, VM-120, VM-121, VM-122, VR-114, VR-117.
- Aucun code servi n'est cette chaîne exacte; les autres codes MMFD ne sont pas traités comme des correspondances. Polygones exacts : 0; plafond collection : 502.

### saint-jerome — MMFD-766 — ZONE_REELLEMENT_ABSENTE
- Documents : saint-jerome-0351-000-annexe-2-2026-07-14 (2026-07-14).
- Preuve densité saint-jerome-0351-000-annexe-2-2026-07-14 : page 818, unité absente, valeurs —, preuve « 70 Coefficient d'occupation du sol (COS) min./max. 0,5 / - ».
- Document verbatim : MMFD-766; SIG servis verbatim (contexte exact) : —.
- Échantillon SIG début : CA-158, CA-159, CMD-400, CMD-407, CMD-416, CMD-417, CMD-419, CMD-420, CMD-438, CMD-440, CMD-442, CMD-443, CMD-444, CMD-451, CMD-459, CMD-460, CMD-461, CMD-462, CMD-463, CMD-464, CMD-484, CMD-485, CMD-486, CMD-487; fin : RR-123, RR-124, RR-127, RR-152, RR-160, RR-168, VM-115, VM-120, VM-121, VM-122, VR-114, VR-117.
- Aucun code servi n'est cette chaîne exacte; les autres codes MMFD ne sont pas traités comme des correspondances. Polygones exacts : 0; plafond collection : 502.

### saint-jerome — MMFD-784 — ZONE_REELLEMENT_ABSENTE
- Documents : saint-jerome-0351-000-annexe-2-2026-07-14 (2026-07-14).
- Preuve densité saint-jerome-0351-000-annexe-2-2026-07-14 : Le rapport d'ingestion conserve ce code dans missingInSig mais aucun passage/page/valeur codé n'est disponible dans les rapports locaux; aucune valeur n'est inventée..
- Document verbatim : MMFD-784; SIG servis verbatim (contexte exact) : —.
- Échantillon SIG début : CA-158, CA-159, CMD-400, CMD-407, CMD-416, CMD-417, CMD-419, CMD-420, CMD-438, CMD-440, CMD-442, CMD-443, CMD-444, CMD-451, CMD-459, CMD-460, CMD-461, CMD-462, CMD-463, CMD-464, CMD-484, CMD-485, CMD-486, CMD-487; fin : RR-123, RR-124, RR-127, RR-152, RR-160, RR-168, VM-115, VM-120, VM-121, VM-122, VR-114, VR-117.
- Aucun code servi n'est cette chaîne exacte; les autres codes MMFD ne sont pas traités comme des correspondances. Polygones exacts : 0; plafond collection : 502.

## Quatre lectures numériques non pliables

### auclair — GRANULARITE_DIFFERENTE
- Source : https://municipaliteauclair.ca/media/attachments/2021/03/22/grilles-de-zonage.xls; lecture verbatim : “Dans les zones agroforestières et de réserve urbaine, les usages résidentiels doivent respecter une densité maximale de 2 logements par hectares.”.
- Document verbatim : groupe verbal zones agroforestières et de réserve urbaine (aucun code imprimé); SIG servis verbatim (contexte exact) : EAA-1, EAB-1, EAF-1, RU-1, V-1.
- La lecture vise un groupe de zones; le SIG expose des codes individuels. Aucun code groupe vers polygone n'est inventé. Plafond collection : 34 polygones.

### disraeli--les-appalaches — AUTRE
- Source : https://www.villededisraeli.ca/fichiersUpload/fichiers/20250407142337-annexe-iii-grilles-de-specifications-1-a-10.pdf; lecture verbatim : “Indice d’occupation au sol (%) 40 (zones 1-R à 8-R) et 50 (zone 10-RC).”.
- Document verbatim : 1-R à 8-R; 10-RC; SIG servis verbatim (contexte exact) : RURA 1, RURA 6, RURB 1, RUS 1.
- AUTRE — vocabulaire de codification distinct (1-R/10-RC côté document contre RURA 1/RURB 1/RUS 1 côté SIG); aucun pont autorisé. Plafond collection : 55 polygones.

### saint-frederic — AUTRE
- Source : https://www.st-frederic.com/wp-content/uploads/Grille-des-specifications_297-15_amende-5.pdf; lecture verbatim : “(20) Une subdivision de lot pour des fins résidentielles doit respecter une densité d’occupation minimale équivalente à 36 logements/hectares.”.
- Document verbatim : aucun code de zone imprimé dans l'énoncé cité; SIG servis verbatim (contexte exact) : A10, A27, I90.
- AUTRE — règle générale de densité de lotissement, sans clé de zone explicite et sans date légale verbatim. Plafond collection : 43 polygones.

### saint-raphael — AUTRE
- Source : https://www.saint-raphael.ca/fichiersUpload/fichiers/20251006101542-reglement-zonage-2022-228.pdf; lecture verbatim : “g) Le coefficient d’occupation du sol de l’ensemble des bâtiments principaux doit être égal ou inférieur à 0,3 ;”; date : “Adopté à Saint-Raphaël, le 7 novembre 2022”.
- Document verbatim : aucun code de zone imprimé dans l'énoncé cité; SIG servis verbatim (contexte exact) : A-101, AF-111, CO-140, Ha-2, I-41, M-21, V-131.
- AUTRE — COS conditionnel à l'article 121 (projet d'ensemble dans le périmètre urbain), pas une norme uniforme des 97 polygones. Plafond collection : 97 polygones.

## Exclus explicitement du décompte principal

Les corroborations historiques ne sont pas comptées : clermont--charlevoix-est/clermont-grilles-2021-06 [027-A, 124.5-Hb, 147.1-Hb]; clermont--charlevoix-est/clermont-grilles-wayback-2016 [027-A]. Elles restent une preuve d'historique, pas une source normative courante.

## Conclusion

Catégorie la plus nombreuse : ZONE_REELLEMENT_ABSENTE (6). Pour débloquer : produire et faire valider une règle de jointure écrite dans la lib, strictement limitée aux paires document/SIG prouvées par source et millésime, avec test explicite de non-appariement pour tout le reste; aucun code ne doit être rapproché dans cette passe.

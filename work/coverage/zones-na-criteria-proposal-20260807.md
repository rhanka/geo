# PROPOSITION — critères N-A zones (KPI 1, 2, 8, 9, 11) — à ratifier archi

> Statut : **PROPOSITION lane zones**, à ratifier par archi contre le gabarit
> `docs/spec/SPEC_PALIER_RESOLUTION.md` (e78c725c) §1/§3. Anti-invention : chaque
> N-A = **preuve d'absence REPRODUCTIBLE**, jamais « pas trouvé ». Un UNKNOWN
> non prouvé reste UNKNOWN.

Le spec §2 cadre déjà **KPI 10 (preuve-v2)** : N-A ssi URL morte (CDX
`matchType=domain`) **ET** 0 carte géoréf publique (recalage épuisé), tracés.
⚠ Conséquence : une muni avec un plan PDF/PNG géoréférençable est
**INCOMPLET-RECALABLE**, PAS N-A (recalage non épuisé). Ex. les 41 cas-B du
verdict `b1fca096` = quasi tous `pdf-recalage` → incomplets-recalables, **pas N-A**.

## Critères proposés (KPI geo non cadrés en §2)

| KPI | N-A PROUVÉ ssi (preuve reproductible + tracée) | Reste UNKNOWN/INCOMPLET si |
| --- | --- | --- |
| **1 Zones-complétion (servie)** | le muni n'a **aucun zonage servable** : (a) 0 source vecteur native (sonde ArcGIS/WFS/JMap/AGOL tracée = négatif) **ET** (b) 0 carte de zonage géoréférençable publique (0 plan PDF/PNG, tracé) **ET** (c) 0 règlement de zonage structurel (gisement épuisé, tracé). Typiquement TNO / micro-enclave sans zonage propre (ex. `ile-dorval`). | une carte/plan existe (→ INCOMPLET-RECALABLE) ; pas encore sondé (→ UNKNOWN). |
| **2 Cohérence lot-zone** | **0 lot cadastral** intersectant le territoire (requête rôle/cadastre re-jouable = 0). (verbatim exemple spec §3) | des lots existent mais fold non fait (→ INCOMPLET) ; géométrie zone périmée (→ re-fold). |
| **8 Provenance-jointure** | **pas de géométrie servie** (KPI 1 = N-A prouvé) → aucune jointure de provenance possible ; cite le fait KPI-1. | géométrie servie présente (→ COMPLET si jointe, sinon UNKNOWN). |
| **9 Provenance-qualité** | idem 8 : **pas de géométrie servie** → pas de qualité à mesurer. | géométrie servie présente. |
| **11 URL-source** | la source de la géométrie servie est **intrinsèquement non-URL** : rôle/cadastre, OU document (PDF plan) **sans URL stable re-téléchargeable** (absence d'URL tracée + document cité comme provenance). Distinct de KPI 10 : ici on atteste l'ABSENCE d'URL-source, pas la mort d'une URL. | une URL-source existe (→ COMPLET/UNKNOWN selon vérif) ; URL morte remplaçable (→ INCOMPLET). |

## Règle de cohérence inter-KPI (zones)
- KPI 1 N-A ⇒ KPI 8/9 N-A (rien de servi à qualifier), et KPI 2 dépend du cadastre (peut être N-A indépendamment si 0 lot).
- KPI 1 COMPLET + source PDF/rôle ⇒ KPI 11 peut être N-A (source non-URL) alors que 8/9 sont COMPLET (provenance = document tracé).
- Le résidu `pdf-recalage` (verdict b1fca096) = **INCOMPLET-RECALABLE sur KPI 1/10**, jamais N-A tant que le recalage PDF n'est pas tenté-et-épuisé.

## Handoff
archi : ratifier la FORME (preuve d'absence reproductible) ; zones fournit le FAIT métier. qa : mesurer sur la matrice 167×20 une fois ratifié.

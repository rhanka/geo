# Focus-30 IMMO — Cohérence zone↔grille — SHARD 0/6

Date : 2026-07-10 (~21:45Z)
Branche : feat/cadre-acquisition
Slugs du shard 0 (index dans la liste IMMO % 6 == 0) : **mont-tremblant** (idx0, P0), **sutton** (idx6, P1), **alma** (idx12, P3).

Gate utilisé : `zone-grille-coherence-gate.ts --slugs mont-tremblant,sutton,alma --out <scratch>` (jamais le fichier partagé).
Lots normes : `_lots-normes-pct-probe.ts`. Props servies : `_sutton-props-probe.ts`.

---

## 1) mont-tremblant (P0) — DÉJÀ COHÉRENT ✅ (aucune action requise)

La prémisse de la mission (« SIG servi = 626 codes RA-4xx… 8% communs ») est **périmée** : la couche
actuellement SERVIE n'est PAS le millésime RA-4xx. Un passage antérieur a re-acquis le zonage au
millésime de la GRILLE (série RA-1xx/TM-1xx/VA-1xx, glyph-vision Claude, secteur central plan3 / annexe-B).

- zone_key : `normalized/ca-qc-zonage/qc-zonage-mont-tremblant.geojson` — **19 features**, `zone_code`, source `t2-gcp3`.
- grille   : `registry/qc-zonage-norms/qc-zonage-norms-mont-tremblant.parquet` — 54 codes (même série RA-1xx).
- codes_zone=19, codes_grille=54, **communs=19**, **recouvrement_strict=100%** (les 19 codes servis sont tous dans la grille).
- flags=[ok], **real_zoning=true**, ni ancien-zonage ni millesime-mismatch.
- **lots_normes_pct=26.77%** (2681/10016 lots), normesStatus=done.

**Résidu (NON une incohérence)** : la couche servie = secteur CENTRAL seulement (plan3/annexe-B). La
couverture RURALE reste bloquée (cartes actuelles 102-60/RA-4xx : pas de grille, non-géoréf, GCP manuel).
C'est une décision de **millésime/couverture qui appartient à IMMO**, pas un défaut de cohérence.
La cohérence zone↔grille au périmètre servi est parfaite (100%).

PING-IMMO slug=mont-tremblant action=aucune(déjà-cohérent) codes_zone=19 codes_grille=54 communs=19 recouvrement=100% source_url=t2-gcp3 owner=ville-mont-tremblant layer=annexe-B-plan3-central champ_code=zone_code lots_normes_pct=26.77 real_zoning=true

---

## 2) sutton (P1) — INCOHÉRENT, diagnostic AFFINÉ, ré-acquisition zonage requise ⛔

**Cause racine identifiée (preuve, pas hypothèse)** : la géométrie servie est une extraction ratée
`source=geopdf-esri` / `confidence=contour-auto`. `_sutton-props-probe` : un seul champ `zone_code`,
`kind ∈ {A,C,H,P}`. Les **~200/217** features portent des codes **P-xxxx** qui NE SONT PAS des zones
mais des **parties de lot cadastrales** (ex. `P-697-113` = *partie du lot 697*, `P-1045-17`, `P-1000-33`).
La grille (registry) est propre et complète : 217 codes réels (familles A/AD/ADM/AF/AFR/C/CF/CONS/ECO/H/IND/PAM/PCI/PUB/REC/RUR).
Seuls les **17 vrais** codes A/C/H de la géométrie recoupent la grille.

- codes_zone=217 (dont ~200 P-cadastre parasites), codes_grille=217, **communs=15**, **recouvrement_strict=6.94%**.
- flags=[millesime-mismatch], **real_zoning=false**. **lots_normes_pct=0.77%** (34/4397).

**Il n'y a PAS de champ propre caché** → ce n'est pas une re-normalisation, c'est une **ré-acquisition
de géométrie**. Aucune couche ArcGIS Online publique QC (recherche = 0 résultat pour « Sutton zonage »).

**Sources EN VIGUEUR PROPRES (codes == grille, à recaler, hors budget 6 min/slug)** :
- Règlement de zonage **115** version codifiée (2019-10-28) : https://sutton.ca/wp-content/uploads/2019/10/115-10-2019-zonage-version-codifi%C3%A9e_2019-10-28.pdf
- Plan de zonage officiel **Plan A** (PDF) : https://sutton.ca/wp-content/uploads/2015/10/Annexe_1_Plan_zonage-Plan_A-36x45-2_nov_2015.pdf
- Grille des spécifications **Annexe-B millésime 2026** (déjà servie) : https://sutton.ca/wp-content/uploads/2026/05/Annexe-B-Grilles-des-specifications.pdf

**⚠ NE PAS utiliser** `cartobm.com` matrice `codemun=46058` : c'est le **cadastre (matrice graphique = numéro de lot)**
= la SOURCE MÊME de la contamination P-xxxx (la MRC Brome-Missisquoi ne publie AUCUNE couche zonage vecteur,
seulement affectation + cadastre). Vérifié via mrcbm.qc.ca/amen_geomatique.

**Recommandation** : ne PAS purger les 200 P-features isolément (ça laisserait 17 zones et baisserait la
couverture) — décision IMMO. Fix propre = **T2 auto-GCP + lane Claude vision (glyphes)** sur le Plan A pour
écraser l'extraction cadastrale. Action lourde → à planifier en passe d'acquisition dédiée.

PING-IMMO slug=sutton action=ré-acq-zonage(requise,non-faite:blocker) codes_zone=217 codes_grille=217 communs=15 recouvrement=6.94% source_url=https://sutton.ca/wp-content/uploads/2015/10/Annexe_1_Plan_zonage-Plan_A-36x45-2_nov_2015.pdf owner=ville-sutton|mrc-brome-missisquoi layer=plan-zonage-A champ_code=zone_code lots_normes_pct=0.77 real_zoning=false

---

## 3) alma (P3) — ZONAGE ABSENT, source EN VIGUEUR candidate identifiée ⛔

- Gate : flags=[zonage-absent, grille-absente], zone_features=0, **real_zoning=false**, lots_normes_pct=0%, normesStatus=to-research.
- ArcGIS Online : le seul « Alma zoning » = **Alma, Nouveau-Brunswick** (mauvaise province → rejeté par les gates, décoratif).

**Source EN VIGUEUR candidate (QC, hors budget 6 min/slug)** :
- Diffuseur cartographique municipal **JMap** (inclut le zonage) : https://geo.ville.alma.qc.ca/carte_publique/
- Règlement de zonage **199-2012** : https://www.ville.alma.qc.ca/reglementation/reglement-de-zonage-199-2012/
- Géomatique MRC Lac-Saint-Jean-Est : https://mrclacsaintjeanest.qc.ca/la-geomatique-et-la-cartographie/

**Recommandation** : acquisition dédiée. Voie 1 = reverse-eng du JMap `geo.ville.alma.qc.ca` (WMS/WFS/JMap REST)
pour récupérer la géométrie zonage + codes réels. Voie 2 (déjà tentée, bloquée) = PDF plat 199-2012 non-géoréf
→ T2 auto-GCP. Action lourde → à planifier hors budget cohérence.

PING-IMMO slug=alma action=ré-acq-zonage(requise,non-faite:blocker) codes_zone=0 codes_grille=0 communs=0 recouvrement=0% source_url=https://geo.ville.alma.qc.ca/carte_publique/ owner=ville-alma layer=zonage(JMap) champ_code=inconnu(à-acquérir) lots_normes_pct=0 real_zoning=false

---

## Bilan shard 0

| slug | priorité | real_zoning | recouvrement_strict | lots_normes_pct | statut |
|------|----------|-------------|---------------------|-----------------|--------|
| mont-tremblant | P0 | **true** | **100%** | 26.77% | ✅ cohérent (résidu = couverture rurale = décision IMMO) |
| sutton | P1 | false | 6.94% | 0.77% | ⛔ blocker affiné : géométrie servie = cadastre P-lot parasite ; ré-acq PDF/WFS requise |
| alma | P3 | false | 0% | 0% | ⛔ zonage absent ; source JMap `geo.ville.alma.qc.ca` candidate ; acquisition dédiée requise |

**Anti-invention respecté** : aucune couche agol décorative comptée comme zonage ; aucune géométrie/grille
fabriquée ; Alma-NB explicitement rejeté (mauvaise province). Les deux blockers sont consignés avec la
**cause racine prouvée** et des **sources en vigueur candidates concrètes** (progrès vs état « no-URL » antérieur),
mais la ré-acquisition (recalage PDF / extraction JMap-WFS) dépasse le budget cohérence 6 min/slug et doit être
planifiée en passe d'acquisition dédiée.

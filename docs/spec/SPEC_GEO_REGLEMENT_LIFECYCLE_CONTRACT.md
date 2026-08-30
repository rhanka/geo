# SPEC — Contrat d'émission geo du cycle de vie règlement (LOT 1, interface GELÉE)

> **Statut : PROPOSÉ (v2 — fable-revu + reglements-co-conçu ; presque freeze-ready).**
> Livrable LOT 1 = ce **CONTRAT D'ÉMISSION GELÉ (interface)**, pas l'impl (immo
> projette contre l'interface gelée ; geo build l'impl APRÈS). Périmètre WP6. Auteur :
> geo-archi. Mode (b) : geo-archi conçoit + `reglements` co-conception + fable-5 2e avis.
> Revue v1 : 4 blockers (B1–B4) + S1–S6 INTÉGRÉS ci-dessous. Décisions owner : Q3
> (document_type), Q2 (reglement_number liste), en_vigueur (geo-cond). Split GEO/IMMO
> validé i-arch, cohérent V34 + graphify 3.4. Ratification (GO LOT 1) : geo-cond→i-cond→owner.

## 0. Principe de séparation émission/dérivation (résout B2)

**geo ÉMET du VERBATIM neutre** (jamais `graph_nodes`, jamais une inférence de lien) :
par event/stage — `document_type`, `reglement_number` (liste, verbatim-ou-null),
`cible_reglement_numero` (avis), les **mentions-cibles verbatim** + **libellés-relation
verbatim** (« règlement modifiant… », « abroge et remplace… »), `zone_ref` (EXACT_GEOM
#13), `event_id`, `extrait_brut`, `provenance`. **immo DÉRIVE** (écrivain unique) : le
`lifecycle_stage`, la **corrélation cross-stage**, le **typage des relations**
(predecessor/replaces/amends), la supersession bitemporelle, la qualif « Steve ».
⟹ **geo n'émet aucun LIEN typé ni statut dérivé** ; il émet le matériau verbatim, immo
le TYPE. (Résout la contradiction §1/§3-vs-§4 de la v1.)

## 1. Champs émis par geo, PAR `document_type` (le tableau gelé — résout B2)

`document_type` (owner Q3, first-class, source-doc-tied) ∈
`{ avis_motion | projet_reglement | adoption | entree_en_vigueur | abrogation }` +
extension additive (§9). **Un event par document-source.** Par type, ce que geo émet :

| document_type | reglement_number (liste) | cible_reglement_numero | mentions/libellés verbatim |
|---|---|---|---|
| `avis_motion` | **vide** (l'avis n'a pas de corps art.1.1) | le n° **annoncé**, verbatim-ou-null | — |
| `projet_reglement` | le(s) n° du corps art.1.1 du projet, verbatim | — | — |
| `adoption` | le(s) n° du corps art.1.1, verbatim | — | libellés « modifiant `<n°>` » / « remplace/abroge `<n°>` » **verbatim** (matériau du typage relation immo) |
| `entree_en_vigueur` | le(s) n° visés, verbatim | — | — |
| `abrogation` | le(s) n° abrogé(s), verbatim | — | — |

`no_lot`/`zone_ref` : clés canoniques (cf. contrat servi). **Style : snake_case
partout** (`cible_reglement_numero`, `bylaw_numero`, `event_id` — corrige N1).

## 2. `lifecycle_stage` = DÉRIVÉ immo (PAS émis — résout S3) + l'asymétrie (résout le challenge fable)

`lifecycle_stage ∈ {avis_motion|projet|adopte|en_vigueur|abroge}` est l'**axe de
STATUT, DÉRIVÉ par immo** (pas dans le schéma émis geo). Mapping de base
`document_type→stage` (bijection sur le happy-path), MAIS **deux divergences prouvées
imposent les DEUX axes** (reglements) :
- **(a) en_vigueur PAR EFFET DE LA LOI** : bylaw en vigueur via doc d'adoption + délai
  légal, **sans doc « entrée en vigueur » distinct** → immo dérive `stage=en_vigueur`
  depuis `document_type=adoption` (+ date). **stage ≠ document_type.**
- **(b) UN doc, PLUSIEURS stages** : un PV qui adopte ET déclare en vigueur → un
  `document_type=adoption` atteste 2 stages.
⟹ le mapping n'est PAS 1:1 → **deux axes justifiés**. La cible owner « tous les EN
VIGUEUR » keye sur `lifecycle_stage` (dérivé immo), **inrépondable depuis
`document_type` seul**. Le contrat porte la **table de mapping explicite** + ces 2
divergences. Un `document_type` de **contenu** (`changement-de-zonage`, `derogation`,
`registre-referendaire`…) → **stage = null** (jamais inféré — S4d).

### 2.1 `en_vigueur` — anti-invention (geo-cond)
geo émet un event `entree_en_vigueur` **UNIQUEMENT si un document source existe**
(verbatim) ; **sinon immo DÉRIVE** `en_vigueur` de `(adoption + date)`. **immo marque le
stage dérivé COMME dérivé** (provenance : document-backed vs derived — résout S2), pour
que le census owner sépare preuve-grade d'inférence-grade.

## 3. Les 3 relations = TYPÉES PAR IMMO (geo émet le verbatim) — noms corrigés (résout B1)

⚠ **B1 — collision de nom** : `supersedes` EXISTE DÉJÀ dans le contrat gelé v2.1 avec un
sens DIFFÉRENT = **pointeur de RÉVISION d'une MÊME étape** (même `event_id`, `version++`,
ne traverse JAMAIS les étapes — `SPEC_QC_ZONING_EVENTS_V2:39-42,63`, `emit.ts:97,148-149`).
On NE le redéfinit PAS. Les relations de CYCLE portent des noms **distincts** :

| Relation (typée par IMMO) | Portée | Sémantique | Matériau verbatim (émis geo) |
|---|---|---|---|
| `supersedes` *(existant v2.1, INCHANGÉ)* | même event, même étape | révision/correction (`version++`) | — (mécanisme v2.1) |
| `lifecycle_predecessor` | INTRA-règlement (même n°) | étape antérieure du même n° (avis→projet→adopté→en_vigueur) | les n° + stages (immo reconstruit sur n°+ordre-des-stages, PAS l'ordre d'émission) |
| **`replaces`** *(nouveau ; ex-« supersedes cross » de la v1)* | CROSS-règlement | remplacement TOTAL (« abroge et remplace `<n°>` ») | libellé verbatim |
| **`amends`** *(nouveau)* | CROSS-règlement | MODIFICATION (« règlement modifiant `<n°>` ») — la base reste en vigueur, amendée | libellé verbatim |

immo TYPE la relation depuis le libellé verbatim ; **libellé peu clair → UNKNOWN, jamais
deviné** (S6). `replaces` ≠ `amends` (total ≠ modification) est **safety-critical** :
un amendement mis-typé `replaces` tuerait à tort une base vivante. **[forme de champ :
relation typée discriminée OU champs nommés = call i-arch/immo, leur supersession
bitemporelle prime.]**

## 4. Corrélation cross-stage — best-effort = business-logic IMMO (sound, inchangé)

`cible_reglement_numero` (avis, verbatim-ou-null, jamais inféré) vs `bylaw_numero`
(adoption, corps art.1.1). **immo lie** best-effort `(muni, n°)` où cible==adoption ;
divergence → **pending/UNKNOWN, jamais forcé**. geo émet les DEUX n° neutres.

## 5. `event_id` sous fan-out (résout B3) + `reglement_number` liste (Q2)

**A1 (v2.1) : `event_id = sha256(muni | source_ref | detection_anchor)` ; `bylaw_numero`
INTERDIT dans l'identité** (`emit.ts:150-153`). Sous fan-out (un PV multi-règlements → un
event/stage par n°), l'`detection_anchor` **DOIT** distinguer par règlement **sans** le
n° dans l'id : anchor = **hash du libellé-résolution verbatim par item** (jamais l'ordinal
positionnel — l'émetteur l'interdit, lever la contradiction v2.1:18) → pas de collision
d'id, pas de fuite du n° dans l'anchor. `reglement_number` = **liste** (Q2 ; refonte = N
règlements, la-minerve 765–770) ; sous fan-out, chaque event porte le sous-ensemble de n°
qu'il atteste (peut être 1) — immo matche `lifecycle_predecessor` par intersection de n°
quand des stages couvrent des sous-ensembles différents (adoption liste 765–770, seul 767
a un entree_en_vigueur).

## 6. Anti-invention + source vivante (garde fantômes)

- **Verbatim-ou-inconnu** partout (n°, mentions, libellés) — jamais corrigé/inféré.
- **Source VIVANTE exigée par event geo-émis** : placeholder (`https://non-disponible`)
  / 404 = stage FANTÔME INTERDIT ; chaque event porte `provenance` (url réelle +
  retrieved_at + sha256). ⚠ (S2) cette garde vaut pour les **events ÉMIS geo** ; un
  `en_vigueur` **dérivé immo** (sans doc) n'est PAS un event geo — il est **marqué
  derived** côté immo (pas proof-grade). Les deux ne se confondent pas.

## 7. Cas limites (co-conçus reglements + fable)

1. **avis mort** → chaîne finit à `avis_motion`, pas de Bylaw ; `en_vigueur` l'exclut.
2. **abrogation SANS remplacement** → event `abrogation`/`stage=abroge` **SI doc
   d'abrogation** (anti-invention, parallèle §2.1) ; sinon immo dérive « plus en vigueur »
   d'un `replaces`. `abroge` = transition TERMINALE depuis en_vigueur (cycle non-linéaire).
   ⚠ **cas C — abrogation SILENCIEUSE** (ni doc, ni successeur) : le bylaw reste
   `en_vigueur` À TORT = **faux-positif CONNU**. On n'invente PAS d'abroge sans preuve,
   mais on **GRAVE le caveat** (reglements) : « **en_vigueur = dernier stage attesté SANS
   preuve d'abrogation/supersession = un PLANCHER, pas une garantie contre l'abrogation
   silencieuse** ». La cible owner « tous les vrais EN VIGUEUR » porte ce caveat.
3. **amendement vs base** (saint-dominique) → `amends` (§3), l'amendement = son n°+cycle.
4. **placeholder/404** → stage fantôme interdit (§6).
5. **découverte rétroactive/hors-ordre** → predecessor sur (n°+ordre-des-stages), pas ordre d'émission.
6. **PV multi-règlements** → fan-out (§5).
7. **(S5) répétition MÊME stage** : premier/second projet de règlement (approbation
   référendaire QC) = 2 docs `projet_reglement`, même n° → « ordre des stages » ne
   départage pas INTRA-stage → immo ordonne par date/provenance ; le contrat le note.
8. **(S5) processus INTERROMPU** : `registre-referendaire`/référendum/refus-MRC tue une
   chaîne entre adoption et en_vigueur → la chaîne **s'arrête** (comme avis mort) ; ces
   docs restent **content-`type`, PAS des stages** → sinon la dérivation §2.1 fabriquerait
   un en_vigueur pour un règlement bloqué. **Grave-le.**
9. **(N4) annulation par cour** d'un règlement en vigueur = HORS-SCOPE v1 (rare).

## 8. Migration / back-compat (transform COMMITTÉ reproductible — reglements + S4)

- **LOSSLESS via table** (reglements) : l'ancien `type` conflatait document+statut →
  dé-conflater ne perd RIEN. `projet-reglement`→(document_type=projet) ;
  `entree-en-vigueur`→(document_type=entree_en_vigueur si doc, sinon l'event reste
  content + immo dérive). **FAIL-LOUD** sur tout ancien `type` hors table (jamais relabel
  silencieux — leçon anti-invention).
- **Split predecessor/replaces = MÉCANIQUE** : cible même `reglement_number` → candidat
  intra ; différent → cross. ⚠ **(B1) 3e branche OBLIGATOIRE** : même n° **ET même
  stage/type** = un `supersedes`-révision v2.1 → **garder tel quel** (ne PAS reclasser en
  predecessor — sinon fabrique une transition de stage + casse la chaîne de révision).
- **Split replaces/amends = NON mécanique** (reglements) : exige la sémantique « remplace »
  vs « modifie » → la migration laisse le cross-n° en **`replaces` (défaut CONSERVATEUR)
  + le FLAGGE pour revue**, ne devine JAMAIS `amends`.
- **(S4a) garde source-vivante ré-appliquée** : un vieux `entree-en-vigueur` migré vers
  `en_vigueur` **repasse la garde §6** OU est **tagué unverified** (pas de phantom-provenance
  promue proof-grade).
- **(S4b) bitemporel = verbatim-ou-UNKNOWN** : temps-valide (date d'adoption/entrée)
  UNIQUEMENT si le document porte la date ; sinon **null + temps-transaction seul** (jamais
  fabriqué depuis un `date_iso` ambigu doc-level).
- **(S4c) migration × révision** : réécrire des champs = une correction v2.1 (`version++`)
  ; l'interaction avec le tombstone/`serveZoningEvents` est explicitée au LOT.

## 9. Politique d'extension + attendus (résout B4 = freeze-readiness)

- **Extension additive gravée** : les consommateurs **DOIVENT tolérer un `document_type`
  inconnu** (ignorer/passer, jamais crash) ; toute ADDITION de valeur = **minor-version**
  (non-breaking). ⟹ le gel n'est pas bloqué par une énum « fermée » — il est bloqué par
  une énum **sans politique** ; la politique est gravée, donc l'ajout futur (`abroge` déjà
  in, un doc de processus-interrompu plus tard) n'est PAS breaking.
- **Prédicat owner corrigé (S1)** : « tous les VRAIS règlements EN VIGUEUR » (en force
  AUJOURD'HUI) = `lifecycle_stage==en_vigueur ∧ ¬replaced ∧ ¬abroge` (**3 clauses**, pas
  1), **évalué sur le graphe PROJETÉ immo** (après dérivation), jamais sur le flux émis geo.
  (+ le caveat cas-C §7.2.)
- **(N3)** le set `adopte`-sans-signal-en_vigueur (dérivation impossible : ni doc ni date)
  s'accumule à `adopte` — comportement anti-invention CORRECT, mais il **alimente le
  refresh-priorité §6** à côté du set pending-avis (sinon le sous-comptage est invisible).
- **Frontière §6** : le **signal pending-set** (output LOT 1) = interface consommée par le
  refresh-priorité (geo scrape cluster→S3, immo signale — frontière (b), post-LOT-1) ;
  i-arch spécifie le format exact avec LOT 1.
- **(N2)** l'ancre bitemporelle citée (`SPEC_REORIENTATION_GRAND_FILET:94`) **n'existe pas**
  dans ce repo → citation retirée ; l'exigence bitemporelle est **inline** (§8 S4b), pas
  déléguée à un fichier fantôme.
- Ratif du contrat gelé → **GO LOT 1** ; immo projette contre l'interface ; geo build
  l'impl ; i-cond aligne le §6 immo (`SPEC_EVOL_AVIS_MOTION_CYCLE_VIE.md`).

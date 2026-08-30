# SPEC — Contrat d'émission geo du cycle de vie règlement (LOT 1, interface GELÉE)

> **Statut : PROPOSÉ.** Le livrable LOT 1 = ce **CONTRAT D'ÉMISSION GELÉ (interface)**,
> PAS l'impl (immo projette contre l'interface gelée ; geo build l'impl APRÈS —
> pattern du gel §1 geo-map-engine). Périmètre WP6. Auteur : geo-archi. Design pass
> mode (b) : geo-archi conçoit + `reglements` co-conception + fable-5 2e avis
> indépendant. Décisions owner : Q3 (document_type), Q2 (reglement_number liste),
> en_vigueur (via geo-cond). Split GEO/IMMO validé i-arch, cohérent V34 + graphify 3.4.
> Conduite→ratification (GO LOT 1) : geo-cond→i-cond→owner.

## 1. Objet + frontière

Graver le **contrat d'émission neutre** du cycle de vie règlement — **avis de motion
→ projet de règlement → règlement adopté → règlement EN VIGUEUR** — tous rattachés au
**même règlement** (même n°), avec supersession. Cas déclencheur : sainte-martine (un
nœud présenté comme règlement alors que le PV source = **avis de motion** annonçant
Règl. 2026-509). Cible owner : **tous les vrais règlements EN VIGUEUR** = prédicat
trivial fiable.

**Frontière (V34 + décision immo D-A) :**
- **GEO ÉMET** (neutre, typé, jamais `graph_nodes`) : par event/stage —
  `document_type`, `reglement_number` (liste), `zone_ref` (EXACT_GEOM #13), `event_id`,
  `extrait_brut`, `provenance`, + les liens de cycle. **UN event par document-source.**
- **IMMO PROJETTE** (écrivain unique `graph_nodes`) : `DesignationEvent{subtype=…}`
  (avis/projet, **nœud DISTINCT par étape**) ou N `Bylaw` **à l'adoption** ; la
  supersession, la corrélation cross-stage, la qualif « Steve » = **business-logic
  immo indélégable**.

## 2. Le champ de cycle de vie — `document_type` (émis) + `lifecycle_stage` (dérivé)

Réconciliation des deux axes (décision owner Q3 + read reglements + décision geo-cond) :

- **`document_type` (émis par geo, first-class stampé, owner Q3)** = le **type du
  DOCUMENT-SOURCE** dont l'event est extrait. geo n'émet un event QUE si un document
  existe : `document_type ∈ { avis_motion | projet_reglement | adoption | entree_en_vigueur }`.
  (owner a nommé 3 ; le 4e `entree_en_vigueur` est **conditionnel** — voir §2.1.)
- **`lifecycle_stage` (axe canonique de STATUT, orthogonal au `type`-contenu, read
  reglements)** = `{ avis_motion | projet | adopte | en_vigueur }`. **NON polluer
  l'énum `type`** (`type` = CONTENU de l'event ; `lifecycle_stage` = l'ÉTAPE). La
  cible « tous les EN VIGUEUR » = prédicat trivial **`lifecycle_stage == en_vigueur`**.
- **Mapping** : `document_type=avis_motion → stage=avis_motion` ; `projet_reglement →
  projet` ; `adoption → adopte` ; `entree_en_vigueur → en_vigueur`.

### 2.1 `en_vigueur` — règle anti-invention (décision geo-cond)
`en_vigueur` est un **ÉTAT**, pas un document. Donc :
- **geo émet un event `document_type=entree_en_vigueur` (stage=en_vigueur) UNIQUEMENT
  si un DOCUMENT source existe** (avis d'entrée en vigueur / publication détecté), son
  contenu **verbatim** ;
- **SINON immo DÉRIVE** `en_vigueur` de `(adoption + date d'entrée en vigueur)` =
  business-logic immo. **geo n'émet JAMAIS un event sans document source** (anti-invention).

## 3. Granularité + relations (3 relations SÉPARÉES)

**Un event DISTINCT par étape** (pas un event qui mute) → geo émet une SÉQUENCE pour
le même règlement, chaque event portant son `document_type`/`stage` + les liens.
**Trois relations sémantiquement distinctes, jamais fusionnées :**

| Relation | Portée | Sémantique |
|---|---|---|
| **`lifecycle_predecessor`** | INTRA-règlement (même n°) | l'event de stage antérieur du MÊME n° (avis→projet→adopté→en_vigueur). Reconstruit sur `(reglement_number + ordre des stages)`, **PAS l'ordre d'émission** (découverte rétroactive). |
| **`supersedes`** | CROSS-règlement (n° différent) | remplacement TOTAL (ex. 2019-342 supersede 05-1992). **Inchangé.** |
| **`amends`** *(recommandé — cas saint-dominique)* | CROSS-règlement | un amendement (son PROPRE n° + propre cycle) qui **MODIFIE** une base sans la remplacer. ⚠ distinct de `supersedes` (total) ET de `lifecycle_predecessor` (même n°). |

**Fusionner = lier le mauvais doc** (source-mismatch, piège fantômes). `supersedes` NE
couvre PAS « amende » (remplacement ≠ modification) → d'où `amends`. **[JUGEMENT à
valider reglements/fable].**

## 4. Corrélation cross-stage — 2 champs, best-effort = décision IMMO

- **`cibleReglementNumero`** (émis par l'**avis**) = le n° **ANNONCÉ** par l'avis.
  ⚠ un avis de motion n'a **pas** de corps art.1.1 → geo extrait le n° annoncé,
  **VERBATIM ou `null`/UNKNOWN si pas clair, JAMAIS corrigé/inféré** (= le principe
  `verbatim-ou-inconnu` `emit.ts:10`, étendu au n° annoncé).
- **`bylaw_numero`** (émis par l'**adoption**) = le n° du **corps art.1.1** (source
  actuelle, `emit.ts:99`).
- **Corrélation = BEST-EFFORT, business-logic IMMO** : immo lie `(muni,
  reglement_number)` où `cibleReglementNumero (avis) == bylaw_numero (adoption)` ;
  divergence (renumérotation, avis vague, cible absente) → immo garde l'avis
  **pending/UNKNOWN**, **ne force JAMAIS** le lien. geo émet les DEUX n° neutres ; **le
  lien N'EST PAS une op geo.**

## 5. `reglement_number` = LISTE multi-valeur (owner Q2)

Une refonte adopte **N règlements** (ex. la-minerve 765–770) → `reglement_number` =
**liste**, pas single. Le `bylaw_numero` actuel (`string|null`, single) → **liste**.
Chaque valeur = verbatim-ou-inconnu. Un PV multi-règlements → **fan-out un event/stage
par règlement**, le PV = source partagée.

## 6. Anti-invention + source vivante (garde fantômes)

- **Verbatim-ou-inconnu** partout : `cibleReglementNumero`, `bylaw_numero`,
  `reglement_number`, `document_type` — geo émet ce que le document dit, ou UNKNOWN.
  **Jamais corrigé/inféré/fabriqué.**
- **Source VIVANTE exigée par stage** : un stage « confirmé » par une URL placeholder
  (`https://non-disponible`) ou 404 = **stage FANTÔME, INTERDIT**. Chaque event porte
  une `provenance` (url réelle + retrieved_at + sha256) ; `stage=en_vigueur` (comme
  tout stage) exige une source réelle. geo n'émet pas un stage sans document vivant.

## 7. Cas limites (design du contrat — co-conception reglements)

1. **avis mort** (avis sans adoption) → la chaîne se termine à `avis_motion`, **pas de
   Bylaw** (immo keye sur adopte) ; `stage==en_vigueur` l'exclut correctement.
2. **abrogation SANS remplacement** (en_vigueur abrogé, aucun successeur) → les 4 stages
   ne couvrent pas « abrogé ». **[décision à valider]** : geo émet un event
   `document_type=abrogation`/`stage=abroge` **SI un document d'abrogation existe**
   (anti-invention) ; sinon immo dérive « plus en vigueur » d'un superseding bylaw.
   **Reco : `abroge` conditionnel-au-document, comme `en_vigueur` (§2.1).**
3. **amendement vs base** (saint-dominique) → relation **`amends`** (§3), l'amendement =
   son propre n°+cycle.
4. **source placeholder/404** → stage fantôme interdit (§6).
5. **découverte rétroactive / hors-ordre** → `lifecycle_predecessor` reconstruit sur
   `(reglement_number + ordre des stages)`, pas l'ordre d'émission (§3).
6. **PV multi-règlements** → fan-out event/stage par n° (§5).

## 8. Migration / back-compat (transform COMMITTÉ reproductible)

Principe fondateur : « rien uniquement sur une machine » → la migration = un **transform
committé + reproductible** (re-run octet-identique), pas un one-off.

- **`type`-values existantes → `lifecycle_stage`** : `projet-reglement → stage=projet` ;
  `entree-en-vigueur → stage=en_vigueur` (map). ⚠ après repurpose de `type` en
  **contenu-pur**, quel `type` de contenu donner à ces events ? **[point à trancher] :**
  les events dont le SEUL signal était le type-lifecycle → perte d'info à évaluer (peut
  imposer un `type=autre` + le stage porté).
- **`supersedes` existants → désambiguïsation MÉCANIQUE reproductible** : cible de
  `supersedes` a le **MÊME `reglement_number`** → c'était en fait un
  `lifecycle_predecessor` (intra) → **migrer** ; `reglement_number` **différent** → vrai
  `supersedes` (cross). Règle reproductible.
- **Bitemporel** (core `SPEC_REORIENTATION_GRAND_FILET:94`) : les stages portent un
  **temps-valide** (date adoption / entrée en vigueur) vs **temps-transaction**
  (émission) ; la migration gère le split si les events existants n'ont qu'un timestamp.

## 9. Attendus owner / suite

- Ratif du **contrat gelé** (interface : `document_type` + `lifecycle_stage` +
  `cibleReglementNumero`/`bylaw_numero` + `reglement_number` liste + les 3 relations +
  la sémantique de corrélation best-effort + verbatim-ou-inconnu) → **GO LOT 1**.
- Points à confirmer avec reglements/fable avant gel : (i) `amends` comme 3e relation ;
  (ii) `abroge` conditionnel-au-document ; (iii) le `type`-de-contenu des events
  migrés (perte d'info) ; (iv) la réconciliation document_type↔stage↔en_vigueur.
- Après gel : immo projette contre l'interface ; geo build l'impl (extraction typée) ;
  le **set des avis pending** (output LOT 1) alimente le **refresh-priorité §6** (geo
  scrape cluster→S3, immo signale — frontière (b), post-LOT-1).
- Alignement §6 immo (`SPEC_EVOL_AVIS_MOTION_CYCLE_VIE.md`) : i-cond aligne sur ce
  contrat quand il land.

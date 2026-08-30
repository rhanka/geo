# SPEC — Contrat d'émission geo du cycle de vie règlement (LOT 1, interface RATIFIÉE)

> **Statut : ✅ RATIFIÉ — owner GO LOT 1 (2026-08-30).** Owner (rhanka) a ratifié **DIRECTEMENT**
> via AskUserQuestion dans la session i-cond (« Ratifier — GO LOT 1 »), 3 revues convergentes.
> Record durable AUTORITATIF = **track decision `01M1A07BZSH07FMCXTCGMVD0E0`** (immo
> `ws:8e7df847…`, outcome GO), attesté par i-cond (conducteur present-decision) — **owner-direct,
> PAS un relai**. L'interface était **GELÉE (v3.1)** avec revue complète : fable-5 CLEAN (F1–F6 +
> 0 nouveau défaut, regression-sweep OK) + check-intention `reglements` CLEAN + forme relations
> figée `i-arch` (review routée fable-5, fallback sanctionné : agy gemini 3.7 saturé h2a_run) ;
> elle est désormais **RATIFIÉE**. ⟹ GO impl LOT 1 (immo projette + geo build contre l'interface).
> **➕ §10 `type_instrument` = le DESIGN geo (revu fable-5) qui IMPLÉMENTE le SCOPE owner-ratifié §1**
> (record `01M1A25HKYSH2MK67K2CXH4Q1Q`, 2026-08-30) : famille règlements-d'urbanisme
> (zonage+lotissement+construction+PIIA+dérogation) + plan d'urbanisme = surface DISTINCTE. ⚠ **L'owner a
> ratifié le SCOPE (§1), PAS ce contrat (§10)** — §10 = ma conception réalisant §1, revue-fable, **non
> séparément owner-ratifiée**. Extension §9-minor additive (déclaré-source-ou-`unknown`) ; §1–§8 INCHANGÉS ;
> §9 étendu additivement (3e énum, politique par-valeur inchangée) ; raccord immo additif (i-arch drive).
> Livrable LOT 1 = ce **CONTRAT D'ÉMISSION GELÉ (interface)**, pas l'impl (immo
> projette contre l'interface gelée ; geo build l'impl APRÈS). Périmètre WP6. Auteur :
> geo-archi. Mode (b) : geo-archi conçoit + `reglements` co-conception + fable-5 2e avis.
> Revue v1 : 4 blockers (B1–B4) + S1–S6 INTÉGRÉS. **v2→v3** : (i) **forme de champ des
> relations = (α) discriminée + temporal node-level — DÉCIDÉE i-arch** (sa supersession
> bitemporelle prime, deferral geo-cond ; §3.1) ; (ii) **consolidation du gate `en_vigueur`
> — reglements** : cas-C (abrogation silencieuse) + processus-interrompu = UN SEUL motif
> anti-fabrication = des gates sur la dérivation, **+ mandat d'émission geo des faits
> suspensifs/terminaux** (§2.1) ; (iii) durcissements H1 (migration : test de stage exige
> deux bouts à stage connu, §8) + H4 (répétition même-stage = keep-history, PAS révision, §7.7).
> **v3→v3.1** : passe fable-5 (F1 blocker = quote §9 fabriquée → §9 étendu à `relation_type` +
> §3.1 dé-cité ; F2 = `replaces` flaggé/uncertain NE gate PAS, route pending §2.1 ; F3 = mandat
> d'émission respecte la taxonomie §1 par-surface ; F4–F6 mineurs) + catch i-arch (dérivation
> `en_vigueur` = verbatim-ou-UNKNOWN, 3 états, §2.1) + refinement reglements (DATE keyée sur le
> déclencheur légal publication-avis/certificat-MRC, PAS l'adoption, §2.1).
> Décisions owner : Q3 (document_type), Q2 (reglement_number liste), en_vigueur (geo-cond).
> Split GEO/IMMO validé i-arch, cohérent V34 + graphify 3.4. Ratification (GO LOT 1) :
> geo-cond→i-cond→owner.

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
extension additive (§9). **Un event par document-source** (par item-résolution sous fan-out,
§5 — F4). Par type, ce que geo émet :

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

### 2.1 `en_vigueur` — anti-invention + GATE de dérivation (geo-cond + reglements + i-arch)
geo émet un event `entree_en_vigueur` **UNIQUEMENT si un document source existe** (verbatim).
**Sinon immo DÉRIVE** `en_vigueur` — mais la dérivation est **elle-même verbatim-ou-UNKNOWN**
(i-arch), en **séparant STATUT et DATE** (reglements) :
- le **STATUT** `en_vigueur` peut être dérivé (adopté + délai légal écoulé + AUCUN gate,
  cf. ⭐ ci-dessous) — robuste même sans date exacte ;
- la **DATE** d'entrée en vigueur est **verbatim-ou-UNKNOWN**, keyée sur le **fait-DÉCLENCHEUR
  légal** — pour un règlement de zonage QC c'est en général la **publication de l'avis
  d'entrée en vigueur / le certificat de conformité MRC**, **PAS l'adoption** (le délai court
  de LÀ — reglements). **Déclencheur ou délai absent → DATE = `UNKNOWN`, JAMAIS fabriquée** :
  `adoption + délai-approximé` n'est pas qu'une invention, c'est une date **subtilement FAUSSE**
  (mauvais trigger).
⟹ le marquage de provenance porte **3 états**, pas 2 : **`verbatim`** (event geo
document-backed) / **`derived`** (STATUT dérivé + DATE sur déclencheur+délai CONNUS) /
**`UNKNOWN`** (déclencheur/délai absent : le STATUT peut rester dérivé, la **DATE = UNKNOWN**).
Le census owner sépare ainsi preuve-grade, inférence-grade, et non-dérivable.

**⭐ La dérivation `en_vigueur` est GATÉE (consolidation reglements — cas-C §7.2 et
processus-interrompu §7.8 sont UN SEUL motif anti-fabrication = des gates).** immo ne dérive
`en_vigueur = adopté + délai légal` **QU'EN L'ABSENCE** de tout fait suspensif/terminal :
`{ event suspensif (registre-referendaire / retrait / échec-référendaire / refus-MRC),
document d'abrogation, bylaw qui `replaces` }`. **Là où la preuve d'un gate est
SILENCIEUSE/absente, `en_vigueur` est un PLANCHER (résidu documenté), PAS une garantie** — le
faux-positif de l'abrogation silencieuse (§7.2) reste un CONNU, jamais masqué. **⚠ (F2,
safety-critical) un `replaces` — ou tout fait de gate — `typing_confidence:uncertain`/`flagged`
NE résout JAMAIS silencieusement `¬replaced` dans un sens ou l'autre** : il ne GATE pas (sinon
un amendement mis-typé `replaces` par le défaut-conservateur de migration §8 tuerait à tort la
base vivante à grande échelle) NI ne garantit `en_vigueur` ; la base affectée **route en
pending/review** (motif §4 « pending/UNKNOWN, jamais forcé »). **Seul un `replaces` `certain`
gate.**

**⭐ Mandat d'émission geo (le côté-geo du gate — sinon immo ne PEUT pas gater et FABRIQUERA
un `en_vigueur`).** Comme `lifecycle_stage` est DÉRIVÉ immo, les gates VIVENT côté dérivation
immo ; la responsabilité du contrat d'ÉMISSION geo est donc d'**ÉMETTRE tous les faits que
immo doit gater OU dont il dérive la date**, **chacun sur SA surface d'émission déjà au
contrat (F3 — pas de double-émission, respect de la taxonomie §1)** : le **content-event
`registre-referendaire`** (taxonomie v2.1) et tout event suspensif ; l'**event `abrogation`**
(§1, un `document_type` lifecycle — PAS un content-event) ; le **libellé « remplace » = CHAMP
verbatim sur l'event `adoption`** (§1, matériau du `replaces`) ; et — pour la **DATE**
d'entrée en vigueur (pas seulement le gate) — le **fait-DÉCLENCHEUR verbatim** (date de
publication de l'avis d'entrée en vigueur / certificat de conformité MRC) comme champ/event,
faute de quoi la DATE dérivée est `UNKNOWN` (jamais adossée à l'adoption par défaut — reglements).
Un fait suspensif/terminal présent-dans-la-source mais NON émis = un `en_vigueur` fabriqué en
aval. geo n'INTERPRÈTE pas ces faits (immo les type/gate/dérive) ; geo GARANTIT leur émission
verbatim quand la source les porte.

## 3. Les 3 relations = TYPÉES PAR IMMO (geo émet le verbatim) — noms corrigés (résout B1)

⚠ **B1 — collision de nom** : `supersedes` EXISTE DÉJÀ dans le contrat gelé v2.1 avec un
sens DIFFÉRENT = **pointeur de RÉVISION d'une MÊME étape** (même `event_id`, `version++`,
ne traverse JAMAIS les étapes — `SPEC_QC_ZONING_EVENTS_V2:39-42,63`,
`acquisition/src/zoning-events-emit.ts:97,148-149`).
On NE le redéfinit PAS. Les relations de CYCLE portent des noms **distincts** :

| Relation (typée par IMMO) | Portée | Sémantique | Matériau verbatim (émis geo) |
|---|---|---|---|
| `supersedes` *(existant v2.1, INCHANGÉ)* | même event, même étape | révision/correction (`version++`) | — (mécanisme v2.1) |
| `lifecycle_predecessor` | INTRA-règlement (même n°) | étape antérieure du même n° (avis→projet→adopté→en_vigueur) | les n° + stages (immo reconstruit sur n°+ordre-des-stages, PAS l'ordre d'émission) |
| **`replaces`** *(nouveau ; ex-« supersedes cross » de la v1)* | CROSS-règlement | remplacement TOTAL (« abroge et remplace `<n°>` ») | libellé verbatim |
| **`amends`** *(nouveau)* | CROSS-règlement | MODIFICATION (« règlement modifiant `<n°>` ») — la base reste en vigueur, amendée | libellé verbatim |

immo TYPE la relation depuis le libellé verbatim ; **libellé peu clair → UNKNOWN, jamais
deviné** (S6). `replaces` ≠ `amends` (total ≠ modification) est **safety-critical** :
un amendement mis-typé `replaces` tuerait à tort une base vivante.

### 3.1 Forme de champ = (α) relation typée DISCRIMINÉE + temporal node-level (DÉCIDÉE i-arch)
[FAIT — décision i-arch, sa supersession bitemporelle prime (deferral geo-cond).] La forme
n'est PAS une préférence : elle découle de la **politique d'extension par-VALEUR du §9**
(gravée à l'origine pour `document_type`, **explicitement étendue à `relation_type` au §9** —
F1, pas de citation d'un texte inexistant). Cette politique — valeur d'énum discriminante
inconnue → ignorée, ADDITION de valeur = minor-version non-breaking — est une extension au
niveau **VALEUR (discriminant)** : **(α) relation discriminée** la supporte nativement ;
**(β) champs nommés la CONTREDIT** (ajouter un prédicat = changement de schéma = major, pas
minor). ⟹ (α) est la SEULE forme cohérente avec la politique d'extension gravée. Forme figée
(graphe PROJETÉ immo) :

```
node.relations: [ {
  relation_type: "lifecycle_predecessor" | "replaces" | "amends" | "supersedes",
  target: { reglement_number } | { node_id },   // A1-safe : le n° vit dans la CIBLE,
                                                //  JAMAIS dans l'event_id (=hash-libellé-par-item, §5)
  from_libelle: <libellé verbatim émis geo> | null,  // null pour lifecycle_predecessor
                                                //  (dérivé n°+ordre-stages, PAS d'un libellé)
  typing_confidence: "certain" | "uncertain",   // uncertain → flagged
  flagged: boolean                              // libellé peu clair / amends incertain →
                                                //  flaggé, JAMAIS deviné (S6/§8)
} ]
node.temporal: TemporalSpan{ validFrom, validTo, knownFrom, knownTo }
              // bitemporel au niveau NŒUD, verbatim-ou-UNKNOWN (S4b, jamais fabriqué) ;
              // validTo se ferme quand le successeur lifecycle_predecessor arrive.
              // Les relations sont des LIENS ; le temporel vit sur le NŒUD.
```

Les 4 contraintes fermes sont respectées : (1) **A1-safe** — le n° est dans `target`, pas
dans l'identité d'event ; (2) **bitemporel verbatim-ou-UNKNOWN** — `temporal` ne fabrique
aucune date ; (3) **`amends` conservateur** — `typing_confidence:uncertain` + `flagged`
rendent le safety-critical `replaces`≠`amends` EXPLICITE (défaut migration = `replaces`+flag,
jamais auto-`amends`) ; (4) **stage dérivé-immo** — la forme ne ré-encode aucun stage émis ;
`lifecycle_predecessor` LIE par n°+ordre-stages. Écriture des relations = **immo**
(projection/écrivain unique) ; geo émet les stage-events verbatim, immo COMPUTE.

## 4. Corrélation cross-stage — best-effort = business-logic IMMO (sound, inchangé)

`cible_reglement_numero` (avis, verbatim-ou-null, jamais inféré) vs `bylaw_numero`
(adoption, corps art.1.1). **immo lie** best-effort `(muni, n°)` où cible==adoption ;
divergence → **pending/UNKNOWN, jamais forcé**. geo émet les DEUX n° neutres.

## 5. `event_id` sous fan-out (résout B3) + `reglement_number` liste (Q2)

**A1 (v2.1) : `event_id = sha256(muni | source_ref | detection_anchor)` ; `bylaw_numero`
INTERDIT dans l'identité** (`acquisition/src/zoning-events-emit.ts:150-153`). Sous fan-out (un PV multi-règlements → un
event/stage **par item-résolution**, §1-F4 — jamais « par n° » : le n° n'entre pas dans
l'identité), l'`detection_anchor` **DOIT** distinguer par règlement **sans** le
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
   preuve d'abrogation/remplacement (`replaces`) = un PLANCHER, pas une garantie contre
   l'abrogation silencieuse** » (F5 : « remplacement », pas le terme B1-collidé). La cible
   owner « tous les vrais EN VIGUEUR » porte ce caveat.
3. **amendement vs base** (saint-dominique) → `amends` (§3), l'amendement = son n°+cycle.
4. **placeholder/404** → stage fantôme interdit (§6).
5. **découverte rétroactive/hors-ordre** → predecessor sur (n°+ordre-des-stages), pas ordre d'émission.
6. **PV multi-règlements** → fan-out (§5).
7. **(S5) répétition MÊME stage** : premier/second projet de règlement (approbation
   référendaire QC) = 2 docs `projet_reglement`, même n° → « ordre des stages » ne
   départage pas INTRA-stage → immo ordonne par date/provenance. ⚠ **(H4) PAS un
   `supersedes`-révision** (reglements) : les DEUX projets sont des events DISTINCTS
   (event_id distincts, docs-sources distincts) et sont **GARDÉS** (keep-history) ; traiter
   le second comme un `version++` du premier EFFACERAIT le redraft déclenché par le registre
   référendaire (anti-invention). Chacun porte son propre `node.temporal`.
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
  ⚠ **(H1, durcissement reglements) le test de stage exige que les DEUX bouts aient un stage
  CONNU** : si un event est un content-event sans type-lifecycle (stage UNKNOWN), le test
  même-stage/différent-stage est **INAPPLICABLE** → **NE PAS reclasser, garder `supersedes`
  (conservateur) + flagger**. On n'INFÈRE jamais un stage pour PILOTER la reclassification
  (fail-loud étendu).
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

- **Extension additive gravée (par-VALEUR, sur les TROIS énums discriminantes)** : les
  consommateurs **DOIVENT tolérer une VALEUR inconnue d'énum discriminante** — un
  `document_type`, un `relation_type` (§3.1), **ET un `type_instrument` (§10)** inconnus —
  (ignorer/passer, jamais crash) ; toute ADDITION de valeur = **minor-version** (non-breaking).
  ⟹ le gel n'est pas bloqué par une énum « fermée » — il est bloqué par une énum **sans
  politique** ; la politique est gravée pour les trois énums, donc l'ajout futur (`abroge` déjà
  in ; un `document_type` de processus-interrompu, un nouveau `relation_type`, ou un nouveau
  `type_instrument` observé, plus tard) n'est PAS breaking. **C'est cette politique par-valeur
  qui tranche la forme (α) discriminée du §3.1** (F1 : le §3.1 s'y réfère, il ne cite aucun
  texte inexistant) **ET qui a permis l'extension §10 `type_instrument` (owner §1)**.
- **Prédicat owner corrigé (S1)** : « tous les VRAIS règlements EN VIGUEUR » (en force
  AUJOURD'HUI) = `lifecycle_stage==en_vigueur ∧ ¬replaced ∧ ¬abroge` (**3 clauses**, pas
  1), **évalué sur le graphe PROJETÉ immo** (après dérivation), jamais sur le flux émis geo.
  Les clauses `¬replaced ∧ ¬abroge` **SONT le gate §2.1** (même motif) ; le caveat cas-C
  §7.2 (PLANCHER, pas garantie) reste porté par le prédicat.
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

## 10. Extension `type_instrument` — famille règlements-d'urbanisme + surface plan distincte

> **SCOPE owner-RATIFIÉ §1 (2026-08-30, record `01M1A25HKYSH2MK67K2CXH4Q1Q`, outcome GO)** : (b) **famille
> règlements-d'urbanisme** (zonage + lotissement + construction + **PIIA + dérogation**) + **plan
> d'urbanisme INCLUS comme SURFACE DISTINCTE** (intention-grade ; capte le flagship `2026-509`).
> Conditions : `type_instrument` (déclaré-source-ou-`unknown`) + `② (ii)-via-statut`.
> ⚠ **§10 = le DESIGN geo (revu fable-5) qui IMPLÉMENTE ce scope §1 — l'owner a ratifié le SCOPE (§1),
> PAS ce contrat (§10).** **Extension §9-minor additive** (par-valeur, 3e énum discriminante) ; le cycle
> bylaw gelé §1–§8 INCHANGÉS ; §9 étendu additivement (3e énum, politique par-valeur inchangée).

**§10.1 Le champ.** `type_instrument: string | null` émis PAR EVENT = le **type d'instrument
DÉCLARÉ-SOURCE** que l'event concerne, extrait VERBATIM du titre/type source. **Granularité
PAR-EVENT** (comme `document_type` ; sous fan-out §5, chaque item-résolution porte SON instrument —
une refonte multi-règlement porte le bon instrument par event). **Énum à VALEUR, PAS un booléen**
(un flag ne distinguerait pas lotissement de PIIA — i-arch).

**§10.2 Set connu initial** : `{ zonage | lotissement | construction | plan-urbanisme | piia |
derogation }` (+ valeurs observées ultérieures). **§9-tolérant** (cf. §9, 3e énum discriminante
par-valeur) : une valeur INCONNUE → le consommateur l'ignore / route en bucket générique, **jamais
un crash** ; ADDITION de valeur = minor-version.

**§10.3 Déclaré-source-OU-`unknown`** (nuance anti-invention, symétrique sainte-martine) : extrait
du titre/type source VERBATIM (« règlement de **zonage** »→`zonage` ; « **plan d'urbanisme** »→
`plan-urbanisme` ; « règlement de **lotissement** »→`lotissement`). ⚠ **Titre absent/ambigu →
`unknown`, JAMAIS deviné du contenu.** Le **mislabel** (plan présenté en zonage) ET l'**absence**
(instrument deviné) sont tous deux couverts. geo émet le déclaré-source ; **geo ne CLASSIFIE pas** ;
immo route/rend/score sur la valeur (jamais un label heuristique).

**§10.4 `plan-urbanisme` = LE marqueur de la SURFACE DISTINCTE (owner).** Le plan d'urbanisme est
DANS la famille MAIS **comme surface distincte** : intention-grade / indicateur-avancé (un changement
de plan **HABILITE** un rezonage, ce n'est PAS un rezonage ferme). immo route `type_instrument=
plan-urbanisme` vers cette surface, rendue/scorée **distinctement** d'une contrainte zonage ferme.
⟹ **le SEUL champ `type_instrument` porte À LA FOIS l'appartenance-famille ET la distinction-plan** —
pas de 2e flag.

**§10.5 ⚠ Articulation BYLAW-lifecycle vs CASE-lifecycle** [JUGEMENT — conséquence structurelle de
l'élargissement owner, surfacée à geo-cond]. L'owner inclut **PIIA + dérogation** dans la famille ;
ces objets sont souvent des **décisions PAR CAS** (pas de cycle avis→projet→adoption). ⚠ **Le RÉGIME
(bylaw vs case) est déterminé par `document_type`, PAS par `type_instrument`** (F2 fable) :
- **`document_type` SET** → **bylaw-lifecycle** (cycle avis→…→abrogation, §1–§8), quel que soit
  `type_instrument`. ⚠ Un **règlement HABILITANT** (« Règlement sur les dérogations mineures », «
  Règlement relatif aux PIIA ») EST un bylaw à cycle complet **portant `type_instrument=derogation/piia`**
  — c'est un event bylaw (document_type set), PAS un case.
- **`document_type=null`** → **content-event** (`type ∈ {derogation-mineure, ppcmoi, cptaq, …}`
  taxonomie v2.1), décision unique par-cas, PAS de cycle.
⟹ `type_instrument` (déclaré-source) = l'**INSTRUMENT** (mapping TYPIQUE : zonage/lotissement/
construction/plan = famille-bylaw ; piia/derogation = souvent case, **mais bylaw si document_type set**) ;
`document_type` (set-ou-`null`) = le **RÉGIME** ; `type` (content) = la sous-catégorie case. immo route :
bylaw-famille → surface contrainte ; plan → surface intention-grade distincte ; case → surface par-cas.
**Le champ unifiant gère l'élargissement sans casser le cycle bylaw** (le régime reste `document_type`-
driven, §1–§8 intacts).

**§10.5.1 Dérivation `statut` — N-A-PROUVÉ ≠ UNKNOWN (raffinement D6, i-arch).** Un `document_type=null`
n'est PAS toujours « stage inconnu ». La dérivation du **`statut`** (côté immo) discrimine via
`type_instrument`+`type` :
- `document_type=null` **ET** case (`type_instrument ∈ {piia, derogation}` OU content-`type ∈ {ppcmoi,
  derogation-mineure, …}`) → **statut = N-A-PROUVÉ, non-flaggé** (l'instrument n'a par nature aucun cycle
  → absence de stage PROUVÉE) ;
- `document_type=null` **ET** instrument bylaw-family (`type_instrument ∈ {zonage, lotissement,
  construction, plan-urbanisme}`) → **statut = UNKNOWN + flagged** (lacune RÉELLE : un instrument
  bylaw-family devrait porter un stage).
Sans ce discriminateur, immo flaggerait des cases « stage manquant » à tort (fausse-lacune). ⚠ La règle
porte sur la dérivation du **`statut`**, PAS sur `type_instrument` lui-même (qui reste déclaré-source-ou-
`unknown`, geo-émis verbatim). **Binding pour LES DEUX consommateurs** (projection extraction LOT 1.b +
raccord immo), auditable. Même motif que la garde couverture 3-états du §9-env (N-A seulement dans
l'emprise déclarée).

**§10.6 Émission.** extraction/reglements extraient `type_instrument` du titre/type source verbatim ;
absent/ambigu → `unknown`. geo n'arbitre pas (déclaré-source). `validateZoningEvent` : `string`
(connu-ou-toléré) ou `null` ; jamais deviné.

**§10.7 Migration / back-compat.** Champ **ADDITIF, safe-default** : `null` pour les events existants
= rétro-compat (comme LOT 1.a). Back-fill `type_instrument` SI le titre-source le déclare, sinon
`unknown` (jamais deviné). immo : `nullable`/`unknown` défaut, §9-tolérant (comme `relation_type`).

**§10.8 Version.** §9-minor (par-valeur), non-breaking. **SCOPE owner-ratifié §1** (record
`01M1A25HKYSH2MK67K2CXH4Q1Q`, 2026-08-30) ; **§10 = le design geo revu-fable qui l'implémente, PAS
séparément owner-ratifié**. Livrable LOT 1 = ce contrat ; l'impl émission + consommation immo (surface
plan distincte) = raccord ADDITIF (i-arch drive).

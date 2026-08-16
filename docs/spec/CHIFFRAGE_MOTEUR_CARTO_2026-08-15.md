# CHIFFRAGE — Moteur carto geo : 2D-first vs renderer-neutre-v1 + séquencement seam-avant-UI

> **Statut : DRAFT décision-support — OWNER-GATED (remonté à geo-cond pour paquet owner unique
> avec l'étude preprod).** Date : 2026-08-15. Auteur : geo-archi (`claude:archi`, WP6 contrats/architecture).
>
> **MAJ décision (2026-08-15) — geo-cond (conducteur ; owner « no preference » → tranché conducteur,
> aligné ADR-0025 + C1)** : **B (renderer-neutre-v1) CONFIRMÉ + gate seam-avant-UI**. **Phase 0 (W1–W10 :
> moteur greenfield + spike 3D) BORNÉE AUTORISÉE, réversible jusqu'au gel.** Garde-fous : le **GEL du seam
> reste HELD** (démo 3D verte + OK geo-cond→owner) ; **aucun lot DS / migration immo avant gel** ; enveloppe
> de plafonnement personne-jours livrée en §6.1 (anti-chèque-en-blanc, chiffre absolu toujours `unknown`).
> **Grounding** : `docs/spec/SPEC_GEO_MAP_ENGINE.md` (ADR-0025, sur origin/main @5ea4c62d) — §1
> (moteur renderer-neutre), §7 (resourcing/ordre), §8 (contraintes immo), §9 (jalon de gel démo 3D).
> Cross-check `SPEC_EVOL_3D_MAPS_2026-08-14.md` (radar-immobilier `lane/conductor @30a065f`, **lu**) :
> **§4.2 Porte 1** = « aucune intégration UI 3D avant le gel d'un contrat de seam v1 renderer-neutral »
> → **confirme mot pour mot** le séquencement seam-avant-UI de ce chiffrage (§5) ; **§1.2** pose 4
> questions bloquantes owner avant gel, auxquelles mon `SPEC_GEO_MAP_ENGINE` répond (mapping §5.1).
> **Anti-invention** : ce chiffrage NE fabrique PAS de personne-jours absolus (pas de donnée de
> vélocité) ; il livre décomposition + tailles relatives (S/M/L) + delta + séquencement. Le chiffre
> absolu est gaté sur le dimensionnement des owners de build (geo pour le moteur, DS pour L1–L6, cf.
> §7 du spec). Toute case sans base = `unknown`, jamais devinée.

---

## 1. Objet

La décision est **déjà prise** (ADR-0025 : moteur **renderer-neutre dès la v1**, gel gaté sur démo
3D). Ce chiffrage n'ouvre pas la décision ; il **explicite le delta de coût** entre la voie retenue
(**B : renderer-neutre-v1**) et l'alternative rejetée (**A : 2D-first, 3D retrofité plus tard**), pour
que l'owner voie noir sur blanc *ce que la neutralité v1 coûte en amont* et *ce qu'elle évite en aval*.
Il pose aussi le **séquencement seam-avant-UI** (le seam gelé AVANT tout adaptateur), car c'est le
levier qui transforme le coût du 3D d'un « retrofit non borné » en un « spike borné ».

## 2. Les deux stratégies

| | **A — 2D-first** | **B — renderer-neutre-v1** *(retenue, ADR-0025)* |
|---|---|---|
| Contrat de couche v1 | paint maplibre direct (ou neutre non prouvé 3D) | `GeoLayerSpec` + encodages neutres compilés **par renderer** (§1.3.1) |
| geo-core | zoom/caméra maplibre implicite | `GeoViewport` + **zoom normalisé + équivalence caméra 2D/3D** (§1.5) |
| Preuve 3D | reportée | **spike 3D minimal** avant gel (§9) |
| dataviz-core | émet `step` maplibre | émet **bins neutres `{upTo, token}[]`** ; moteur compile (§1.6) |
| Gel du seam | tôt, sur abstraction non prouvée | **après démo 3D verte** (§9) |
| Conformité immo (C1, déjà ratifiée owner) | **violée** (module non renderer-neutre) | **satisfaite** (§8) |

## 3. Décomposition du travail moteur *(grounded §1.4/§1.5/§1.6/§9 ; taille = complexité relative)*

| # | Work item (moteur, greenfield) | Réf | Taille | Porté par A ? | Porté par B ? |
|---|---|---|---|---|---|
| W1 | Réconciliateur de couches déclaratif (diff `setLayers`) | §1.4 | M | oui | oui |
| W2 | Partition d'ownership par préfixe d'ID (`layers` ‖ `syncLayers`) | §1.4 | S | oui | oui |
| W3 | Viewport non-contrôlé + **contrat d'écho** (epsilon+throttle `moveend`) | §1.4 | M | oui | oui |
| W4 | Caméra (`flyTo`/`fitBounds`/`recenterKeepZoom`/`resetToInitialView`) | §1.4 | S | oui | oui |
| W5 | Basemap + **ré-injection overlays post-`setStyle`** | §1.4 | M | oui | oui |
| W6 | Tool-plugin context (mesure) | §1.3.5 | M | oui (2D) | oui (2D+3D) |
| W7 | **Encodages neutres → compile paint PAR renderer** (constant/category/valueStep/valueRamp) | §1.3.1/§1.6 | **L** | non¹ | **oui** |
| W8 | Tokens→paint par renderer + ré-application au thème (`setTokens`) | §1.3.3 | M | oui² | oui |
| W9 | **geo-core : `GeoViewport` + zoom normalisé + équivalence caméra 2D/3D** | §1.5 | **L** | non | **oui** |
| W10 | **Spike 3D** (Cesium OU deck) : 1 `GeoLayerSpec`+`TokenMap` rend en 3D ; viewport round-trip 2D↔3D | §9 | **M-L** | non | **oui** |
| W11 | Refactor `dataviz-core` → bins neutres (retirer émission `step` maplibre) | §1.6 | M | non | oui (cross-package, owner-gated) |

¹ A écrit du paint maplibre direct → **pas** de couche de compilation neutre (économie apparente W7).
² A résout des tokens vers du paint maplibre uniquement (moins général).

**Absolu (personne-temps) = `unknown`** ici : à remonter par l'owner de build moteur (§7 : « Dimensionnement
remonté par geo »). Les tailles ci-dessus sont un ordre de grandeur relatif, pas une conversion en jours.

## 4. Delta A → B — le surcoût réel de la neutralité, et ce qu'il achète

**Surcoût AMONT de B (ce que A n'écrit pas en v1)** : W7 (compile neutre par renderer, **L**) + W9
(geo-core zoom normalisé + équivalence caméra, **L**) + W10 (spike 3D, **M-L**) + W11 (bins neutres, M).
Ordre de grandeur : **~2×L + 1×(M-L) + 1×M** de travail moteur *en plus* en v1.

**Coût AVAL évité par B (le retrofit que A paie plus tard, non borné)** :
- Réécriture de la couche paint en neutre **a posteriori** (W7 fait tard = touche tout le paint existant, pas greenfield) ;
- **Re-gel du seam** : le contrat v1 figé en 2D-only est faux pour la 3D → seam v2 breaking ;
- **Re-travail des adaptateurs L1–L4** : construits sur un seam 2D-only, ils encodent des hypothèses maplibre → refonte à chaque adaptateur (×4 frameworks) ;
- **Ré-adoption immo** : immo a **déjà ratifié (owner)** « module carto geo-owned, DS-compliant, renderer-neutre » (§8, C1). A **viole** cette ratification → immo ne peut pas adopter pour la 3D → dossier de sync i-cond rouvert.

**Asymétrie clé** : le surcoût amont de B est **borné et connu** (W7/W9/W10/W11, énumérés) ; le coût aval
de A est **non borné** (retrofit + ×4 adaptateurs + ré-ratification immo) et tombe *après* que du code
adaptateur ait été écrit sur un mauvais seam. B **échange un coût borné amont contre un risque non borné aval**.

## 5. Séquencement seam-avant-UI *(grounded §7 + §9 ; le levier central)*

```
Phase 0 (moteur, geo owner) : W1–W9 + W10 spike 3D
        └── démo 3D VERTE (§9) ──►  GEL DU SEAM v1  ◄── jalon bloquant, HOLD geo-cond→owner
                                        │
        ┌───────────────────────────────┴───────────────────────────────┐
        │ (après gel seulement)                                          │
   L1–L4 adaptateurs de base (geojson/points)         ‖   W11 refactor dataviz-core → bins neutres
   — NE consomment PAS les bins → avancent en //           (owner-gated, cross-package)
        └───────────────┬───────────────────────────────────┬───────────┘
                        ▼                                     ▼
                 L5 chrome/choroplèthe (dépend des bins neutres)
                        ▼
                 L6 migration immo (adoption composant canonique + fetch-out C3)
```

**Pourquoi geler le seam AVANT l'UI** (et pas l'inverse) :
1. Un seam gelé *après* les adaptateurs = adaptateurs écrits sur un contrat mouvant = re-travail garanti (le coût aval de §4).
2. Le seam ne peut être gelé *correctement* qu'une fois **prouvé satisfiable en 3D** (§9) — sinon on fige une abstraction non vérifiée (anti-généralisation-prématurée, §1.8).
3. Donc l'ordre est **contraint, pas préférentiel** : `spike 3D → gel → UI`. Le spike 3D (W10) est le **prérequis du gel**, pas une option de fin de projet.

**Point de bascule unique = démo 3D (§9).** C'est le seul jalon qui autorise le gel et donc le démarrage
de tout le travail UI (L1–L6). Tout le resourcing DS (L1–L6) est **en aval** de ce jalon (§7).

### 5.1 Alignement avec immo (`SPEC_EVOL_3D_MAPS §1.2/§4.2/§D10`) — la démo 3D a un double rendement

immo **§4.2 Porte 1** = « aucun travail d'intégration UI 3D avant le gel du seam v1 renderer-neutral » :
identique au séquencement de ce chiffrage. immo **§1.2** pose **4 questions bloquantes owner AVANT gel**,
auxquelles mon `SPEC_GEO_MAP_ENGINE` répond :

| Q bloquante immo (§1.2) | Où mon SPEC répond | Preuve = démo 3D (§9) ? |
|---|---|---|
| Q1 breaking `0.1.1→0.5.0` + coût upgrade `GeoView.svelte` | §6 Gate A + §8 C5 (livrable ; chiffre `unknown`, porté immo/Gate A) | non (inventaire, hors moteur) |
| Q2 abstraction couches réelle (Zones/Lots/Signals couplées MapLibre ou prêtes adaptateur 3D ?) | §1.2/§1.3 (moteur greenfield, encodages neutres) | **OUI** — un `GeoLayerSpec` rendu en 3D EST la preuve |
| Q3 geo-core : zoom normalisé + équivalence caméra 2D/3D **testable** | §1.5 | **OUI** — le round-trip viewport 2D↔3D EST la preuve |
| Q4 collision de nom `GeoMap` (DS-dataviz vs geo-ui-svelte MapLibre) | §2 (rename `GeoMap→GeoChart`, sans alias) | non (rename, hors moteur) |

**Conséquence de chiffrage** : le **spike 3D (W10) n'est pas qu'un gate de gel interne geo — il est le
véhicule de preuve de 2 des 4 questions bloquantes owner d'immo (Q2, Q3)**. Le même travail borné achète
simultanément (a) le gel de mon §1 et (b) la levée des blocages Q2/Q3 côté immo → **double rendement**,
argument supplémentaire pour B (le coût amont de la neutralité est déjà exigé par le processus owner immo,
il n'est pas un surcoût propre à geo).

**Contrainte resourcing (immo §4.2/§D10)** : sur contention de ressources, **P05 passe devant le chantier
3D**. Impact sur ce chiffrage : le build **moteur (Phase 0, geo)** est amont et **hors contention P05** ; le
travail **adaptateurs DS (L1–L6)** partage la phase « après gel » et est **soumis à “P05 d'abord”** en cas
de contention — à intégrer dans le resourcing owner (le gel du seam ne doit PAS attendre P05, mais
l'intégration UI oui).

## 6. Sensibilité au risque

- **Driver de coût dominant = issue du spike 3D (W10)**, pas la taille des adaptateurs.
  - Spike **vert** → gel → B rentabilise son amont, A est disqualifiée rétroactivement (aurait dû faire W7/W9).
  - Spike **rouge** → §1 corrigé *avant* tout gel (§9) : c'est précisément le coût que A masque en ne testant jamais la 3D avant d'avoir tout construit en 2D.
- **Le spike 3D est bon marché relativement à ce qu'il dé-risque** : barre = **1 renderer réel, 1 `GeoLayerSpec`+`TokenMap`, 1 viewport round-trip** (§9) — minimal, borné. Il achète la certitude que le seam gelé est correct pour ×4 adaptateurs + immo.
- **Dépendance cross-package W11** (dataviz-core) : owner-gated, ne bloque QUE le chemin choroplèthe/L5, **pas** les adaptateurs de base L1–L4 (§1.6/§7) — donc parallélisable, hors chemin critique du gel.

### 6.1 Enveloppe de plafonnement Phase 0 (ordre de grandeur — dispositif de cap owner)

geo-cond demande un **ordre de grandeur personne-jours** pour que l'owner **plafonne** (anti-chèque-en-blanc),
le chiffre absolu restant `unknown` faute de vélocité mesurée. **Ce n'est PAS un devis ni un engagement** :
c'est une enveloppe **paramétrique** dont le **cadran est la table de conversion taille→temps**, ajustable par
l'owner de build. Périmètre = **Phase 0 = W1–W10** (moteur greenfield + spike 3D), **hors W11** (après-gel).

**Cadran — hypothèse de conversion (1 ingénieur sénior, À AJUSTER par l'owner de build)** :

| Taille | jours (hypothèse) |
|---|---|
| S | 2–4 |
| M | 6–10 |
| L | 15–22 |
| M–L | 10–16 |

**Composition W1–W10** : S×2 (W2, W4) · M×5 (W1, W3, W5, W6, W8) · L×2 (W7, W9) · M–L×1 (W10).
- Borne basse : 2·2 + 5·6 + 2·15 + 10 = **74 j**
- Borne haute : 2·4 + 5·10 + 2·22 + 16 = **118 j**

**Enveloppe Phase 0 ≈ 74–118 personne-jours ≈ ~15–24 personne-semaines ≈ ~3,5–5,5 personne-mois** (1
ingénieur). W1–W6 sont indépendants du spike → parallélisables à effectif >1 (calendrier plus court), mais le
**total personne-jours reste la base du cap**, pas le calendrier.

**Ce qui peut faire sauter l'enveloppe** : le **spike 3D (W10)**. Vert → enveloppe tient → gel. **Rouge →
correction §1 avant gel = coût additionnel NON inclus** (dépend du défaut). W10 est amont précisément pour
**borner ce risque tôt** (cf. §6).

**Ce que le cap n'EST PAS** : une vélocité mesurée, un devis, un engagement. **Le cadran est la variable
owner** — changer la table de conversion déplace l'enveloppe. Le **chiffre absolu réel** se mesure par l'owner
de build sur les premiers work items (anti-invention : je livre le paramétrage transparent, pas un nombre
prétendu vrai).

## 7. Ce qui reste `unknown` / hors de ce chiffrage (anti-invention)

- **Personne-jours absolus** (moteur ET L1–L6) : `unknown` — dimensionnement owner de build (§7). Je livre scope+taille+ordre ; les owners attachent la vélocité.
- **Choix Cesium vs deck.gl** pour le spike : `unknown`, tranché par le spike lui-même (§9 : « Cesium OU deck »).
- **Coût upgrade `GeoView.svelte` 0.1→0.5** (immo, Gate A/C5) : `unknown` — livrable Gate A (§6/§8), porté immo.
- **Ownership évolution geo-core** (release cross-repo, §1.5) : à confirmer geo-cond/owner.
- **Cross-check `SPEC_EVOL_3D_MAPS §4.2`** : PENDING (branche non poussée) — peut préciser/amender le framing seam-avant-UI d'immo.

## 8. Recommandation

**Confirmer B (renderer-neutre-v1) avec le gate seam-avant-UI (§9)**, pour trois raisons groundées :
1. **Asymétrie de risque** (§4) : surcoût amont **borné** (W7/W9/W10/W11) contre coût aval **non borné**
   (retrofit + ×4 adaptateurs + ré-adoption immo) que A encourt.
2. **Contrat immo déjà ratifié** (§8, C1) : A **violerait** une ratification owner existante ; B la
   satisfait par construction.
3. **Le gate 3D est un dé-risquage bon marché** (§6/§9) : un spike minimal borne le seul coût inconnu
   (satisfiabilité 3D) *avant* d'engager tout le travail UI.

**HOLD maintenu** : rien de gelé/ratifié sans OK geo-cond→owner. Ce chiffrage alimente le paquet owner
unique (avec l'étude preprod). Il ne déclenche aucune implémentation.

---

## Références
- `docs/spec/SPEC_GEO_MAP_ENGINE.md` (ADR-0025) — §1, §7, §8, §9. Sur origin/main @5ea4c62d.
- `docs/decisions.md` — ADR-0025.
- immo (radar-immobilier `lane/conductor @30a065f`, lu) : `SPEC_EVOL_3D_MAPS_2026-08-14.md §1.2/§4.2/§D10`, `DOSSIER_DECISION_3D_MAPS_2026-08-14.md §9`.

**DRAFT décision-support — OWNER-GATED — chiffre absolu `unknown` (owner de build). Anti-invention :
tailles relatives groundées sur le spec, pas de personne-jours fabriqués.**

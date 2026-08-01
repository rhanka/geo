# SPEC — Workpackages geo (structure ratifiée 2026-07-30)

> Statut : **structure et rôles RATIFIÉS et APPLIQUÉS dans track le 2026-07-30**
> (`track validate` OK, 21 235 events). Les 7 WP existent (index track WP13→WP19,
> titre `wp1:`…`wp7:`) ; les anciens conteneurs `couche:*`, `immo-lots-enrichment`
> et `zonage-enrichment` sont annulés ; 41 sous-arbres reparentés. **4 items
> restent hors migration** faute de reparent inter-workspace (§4bis). Décisions de
> périmètre encore ouvertes : §5.
> Origine : refonte demandée par le propriétaire — « le *require* séparé de la
> donnée n'a pas de sens ; la QA et la traçabilité doivent être INTÉGRÉES à chaque
> WP de donnée ». Brainstorm fable-5 :
> `work/coverage/…/wp-refonte-proposition-fable5.md` (hors dépôt).

## 0. Le principe (ce que le refactoring corrige)

> **Un WP possède sa donnée, sa preuve et son compteur. Les trois ou rien.**

Le découpage précédent mesurait le *require* (`pv/scraper-configured · <ville>`),
pas la donnée servie. Conséquence vécue : WP « pv » affichait 96 % (1 065/1 106)
alors que la couverture réelle du graphe était 640/1 106, connue seulement en
écrivant un script exprès. **Il n'y a pas de WP « QA »** : ce serait recréer le
require à côté de la donnée. La QA est une obligation de structure de chaque WP :
une partition fermée + un script de mesure committé.

Trois obligations, par construction, dans chaque WP de donnée :

| Obligation | Mécanisme |
|---|---|
| **« Fait » = partition fermée** | états nommés dont la somme = dénominateur ; `unknown ≠ complete` ; **un refus est un état, jamais une absence** (modèle : partition PV `INDEXED 5 492 · OWNER_NOT_CONFIRMED 337 · EXTRACTION_FAILED 417 · CONTAMINATION 53 · UNKNOWN 83 = 6 382`) |
| **Compteur recalculable** | UN script de mesure committé par WP, déterministe, sortie datée dans `work/coverage/` ; un chiffre non recalculable ment (modèle : `acquisition/src/pv-couverture-municipale.ts`) |
| **Preuve par construction** | pas de dépôt sans manifeste de capture ; `sha256(octets) == nom du fichier` (prouvé 223/223) ; le manifeste EST la preuve v2 |

## 1. Les 7 workpackages

| # | nom | rôle | ferme quelle classe de problème | frontière — PAS ici | script de mesure |
|---|---|---|---|---|---|
| **wp1** | cadastre | `lot` | lot + géométrie + **propriétaire** + évaluation (rôle MAMH), clé = matricule ; source provinciale par ville | pas la jointure lot↔zone (→ wp5) | manquant |
| **wp2** | zones | `zones` | géométrie de zonage servie à provenance prouvée octet-pour-octet (capture→stamp→readback), y compris ré-acquisition | pas les attributs réglementaires (→ wp3) ; pas la jointure (→ wp5) | pièces existantes ; runner unifié manquant |
| **wp3** | reglements | `reglement` | ce que le règlement dit de la zone : normes/grilles, n° + millésime, usage dominant, **effet densifiant 4a** | pas la géométrie (→ wp2) ; pas la détection d'événement (→ wp4) | partiel |
| **wp4** | pv | `pv` | délibérations + avis + **YouTube (transcription)** captés, indexés, propriétaire confirmé → événements de zonage | pas la qualification de l'effet (→ wp3) ; le graphe immo reste écrit par immo | **existe** (modèle) |
| **wp5** | jointures | `jointures` | lot↔zone, normes repliées sur le lot, cohérence lot-zone, contrat passthrough OGC | pas la géométrie ni sa preuve (→ wp2) ; pas le scoring immo | 4 matrices à unifier |
| **wp6** | archi | `archi` | **règles et contrats UNIQUEMENT, pas de code/build** : contrats servis, règles de QA, règles de capture (le *quoi* et le *comment prouver*) | pas l'implémentation ni le build du socle (→ wp7) ; pas les verdicts de donnée (chaque WP juge chez lui) | partiel |
| **wp7** | socle | `deploy` | le **BUILD** du socle : GeometryKernel, geo-lib, kernel de capture (implémentation), + API OGC, lib npm `@sentropic/geo`, pmtiles | pas la définition des règles/contrats (→ wp6) | manquant |

## 2. Placements tranchés (les cas ambigus)

- **Captation des propriétaires → wp1.** Le rôle foncier MAMH est clé par
  matricule comme le cadastre : même source, même granularité, même passe.
  ⚠️ wp1 est **le seul WP porteur de PII** (Loi 25, ADR-0013) : l'anti-PII est un
  **état nommé de sa partition** (`PII_REFUSED`), pas une règle dans une doc à côté.
- **Recapture → DANS chaque WP de donnée, jamais transverse.** La recapture est
  une **transition d'état**, pas une phase : seul le WP qui possède la donnée sait
  ce qu'est un remplaçant valable (ex. GOnet6 succédant à goazimut décommissionné,
  186 URL). wp6 possède le *contrat* de capture ; chaque WP possède *ses* captures
  et recaptures. Le déclencheur est un état de partition (`SERVED_PROOF_DEAD` →
  recapture planifiée par la mesure), pas une décision humaine — sinon la mortalité
  se redécouvre par accident.
- effet densifiant 4a → **wp3** (le PV *détecte*, le règlement *qualifie*).
- normes pliées sur le lot → **wp5** (produit de rapprochement, pas attribut du lot).
- surface / adresse / code postal → **wp1** (attributs intrinsèques de la source).
- pmtiles → **wp7** (dérivé de service ; wp2 dit *ce qu'il y a dedans*, wp7 *comment
  c'est servi*).
- contrat servi geo→immo → **wp6** le définit, **wp7** le publie.

## 3. Rôles — qui décide, qui mesure, qui refuse

| rôle | portée | droit de REFUSER |
|---|---|---|
| **toi** (propriétaire, cadre h2a) | transverse | tout ; seul à trancher les ADR et à autoriser un retrait prod (`--withdraw`) |
| **conductor** | transverse | toute campagne sans essai borné chiffré ; re-grinder une lane terminale ; un levier au coût non mesuré |
| **qa** | transverse | tout chiffre non recalculable depuis un artefact committé ; toute partition qui ne ferme pas ; tout Δ fabriqué. Possède les *règles*, vérifie les mesures — mais **chaque WP porte SON script et SA partition** |
| **archi** | wp6 | une règle métier restée dans un `_*.ts` ; un vert par omission (workspace sauté, fixture locale absente) |
| **lot** | wp1 | un dépôt sans propriétaire établi ; toute PII non filtrée |
| **zones** | wp2 | un stamp sans capture ; une géométrie sans preuve v2 |
| **reglement** | wp3 | un « projet de règlement » traité comme adopté ; un effet sans qualité juridique établie (c'est ici que 3 effets fabriqués sont partis en prod) |
| **pv** | wp4 | un owner ambigu (bonaventure/saint-elzear) ; une date non verbatim |
| **jointures** | wp5 | une résolution floue de code de zone (HC-14→COMPTON) |
| **deploy** | wp7 | publier une couche non exposée/non lisible ; un npm dont le tarball ne porte pas son module |

**Séparation clé** (leçon « effet fabriqué parti en prod ») : *celui qui produit
ne se note pas lui-même* — le rôle `qa` reçoit les SOURCES, jamais la conclusion ;
un gardien de WP peut bloquer son conductor ; seul le propriétaire débloque.

## 4. Migration (à appliquer APRÈS §5)

On ne refrappe pas les 8 728 items : on re-titre les conteneurs survivants, on
re-parente les WP éclatés dessous, on **démote les 26 `voie:*`** (une voie est un
levier, pas un WP — c'est ce qui vide les 27 WP fantômes).

| actuel | devient |
|---|---|
| WP1 cadastre, WP2 role-foncier | **wp1** (rôle = attribut par matricule, pas WP séparé) |
| WP3 zones, WP8 zones-reacquire, « Provenance zonage servie » | **wp2** (sa QA rentre à la maison) |
| WP4 normes, WP10 zonage-enrichment, les deux WP « 4a » | **wp3** (fusion 4a à ratifier, §5-C) |
| WP5 pv, annotation-pv/pv-octets | **wp4** |
| WP9 immo-lots-enrichment | **wp5** |
| WP7 « LOT 0 — Fondations » (dé-jalonné) + SPEC capture | **wp6** |
| WP6 pmtiles + API + npm | **wp7** |
| 26 sous-WP `voie:*` | démotés (attribut d'item) |

**Cinq chiffres à RE-MESURER avant tout affichage** (non fiables) : wp4 (96 % →
640/1 106) · wp2 (911 compte des voies, pas des géométries prouvées) · preuve v2
(48/871 ignore 186 URL mortes et 146 fragments `#` auto-fabriqués) · dénominateurs
wp5 (`unknown`, non retraçables) · wp1 (agrégats non mappés aux villes).

## 4bis. Convergence des 4 items inter-workspace (FAIT — décision D tranchée)

Track refuse `item reparent` entre workspaces et n'offre ni move-workspace ni
renommage. Les 4 items hors `ws:5ce6` ont été **convergés par recréation fidèle**
(titre + body + état + scope + enfants préservés, **nouvel ULID**) sous leur WP,
puis l'original a été annulé (un item `done` est d'abord rouvert). `validate` OK.

| item source (ws) | → destination | état préservé | note |
|---|---|---|---|
| `annotation-pv/reglement-octets` (`geo`, done) | wp3 | done | ULID neuf |
| `annotation-pv/pv-octets` (`geo`, in-progress) | wp4 | in-progress | ULID neuf |
| `annotation-pv/delta-grille-4a` (`geo`) | wp3 (**fusion 4a**) | — | annulé, absorbé par `effet_densifiant_4a` |
| `LOT 0` + 5 enfants (`geo-lib`) | wp7 socle | to-do | dé-jalonné, scope `packages/**` re-déclaré |

L'ancien ULID n'est plus valide : c'est le coût de l'immuabilité de workspace dans
track. Aucune donnée métier perdue.

## 5. Décisions de périmètre — TRANCHÉES par le propriétaire (2026-07-30)

- **A. Propriété des PV → geo possède l'acquisition PV.** Révoque le volet PV
  d'ADR-0013 ; wp4 est légitime ; immo reste consommateur. Voir **ADR-0023**.
- **B. Track → travail seul, vérité = mesure.** Track ne garde que les items de
  travail (leviers, campagnes) ; la couverture-ville vit dans l'artefact de mesure
  + portfolio. Supprime structurellement le double compteur. ⚠️ **Change le contrat
  de lecture du `track report`** : le % ne mesure plus la couverture — à répercuter
  dans le générateur de rapport et la doc portfolio (non encore fait).
- **C. Fusion 4a → un seul item dans wp3.** `delta-grille-4a` fusionné dans
  `effet_densifiant_4a` (§4bis).
- **D. Workspace → convergence propre effectuée** (§4bis), pas de laisser-racine.
- **Premier niveau GELÉ** : aucun WP racine sans accord du propriétaire (ADR-0022,
  `AGENTS.md`).

## 6. Reste à faire (non bloquant, hors périmètre de cette passe)

- Écrire les scripts de mesure manquants par WP (wp1 socle-couverture, wp2
  zones-couverture, wp5 partition unifiée) — modèle : `pv-couverture-municipale.ts`.
- Répercuter la décision B dans le générateur de rapport (contrat de lecture).
- Re-mesurer les 5 chiffres non fiables (§4) avant tout affichage.
- Câbler les rôles (RACI) sur les 7 WP une fois les handles d'acteur confirmés.

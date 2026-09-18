# GEO — Plan PRA / sauvegarde (volet geo de la PR conjointe immo + geo)

> Statut : **DRAFT — relecture i-cond avant tout commit.** Volet geo du PRA d'ensemble
> décidé par l'owner le 2026-09-18 (prime = immo, orchestration i-cond ; deux PR conjointes
> `rhanka/radar-immobilier` + `rhanka/geo` présentées ensemble avec le dossier de décision).
> Ce document ne déclenche AUCUN acte cluster/S3 : c'est le plan. Destination repo prévue :
> `docs/ops/pra/GEO_PRA_PLAN.md`.

## 1. Périmètre — quoi on sauvegarde, quoi on exclut

**Irremplaçables (copie de reprise dédiée) :**
- `sources/qc-zonage-grilles/` — **aujourd'hui le SEUL pont octets→S3 existant** (44 objets, dernier 2026-07-28).
- `raw/<source>/cas/<sha256>.<ext>` + `capture/_runs/<run-id>/` — **crown jewels** dès que la
  capture-on-cluster shippe (0 objet aujourd'hui). Règle C-7 : `raw/` ne doit **jamais** être supprimé.

**Exclus de la copie dédiée (re-dérivables) — dit explicitement :** `normalized/` (servi),
`exports/immo/` (contrat), `pmtiles/`, et le layer **PostGIS**. Tous re-dérivables des sources/captures
par des pipelines idempotents. Les sauvegarder serait dupliquer une donnée reconstructible ; on ne le fait pas.

## 2. Cible + identités

- Bucket cible : **`sentropic-geo-pra`** (proposé), **privé**, **versionné**.
- Identités least-priv : **lecture seule** côté source (`sentropic-geo`), **écriture seule** côté cible
  (put/append, **jamais delete**). Aucune identité ne peut à la fois lire la source et supprimer la cible.
- ⚠️ **Région** : `bhs` ne couvre **pas** une panne régionale. Une cible cross-région (autre région OVH
  ou 2ᵉ provider) ajoute egress + stockage + latence de copie. **Chiffrage = i-infra/k8s** ; **arbitrage = owner**
  (ce n'est pas un choix technique). Remonté tel quel.

## 3. Conservation PROUVÉE — un bucket versionné ne suffit pas (revue immo #1)

Un bucket privé + versionné ne **prouve** pas la conservation. Il faut nommer ce qui **empêche l'écrasement**,
ce qui **borne la rétention**, et **ce qui reste garanti si le mécanisme fort n'est pas disponible**.

- **Mécanisme retenu — SOUS CONDITION de disponibilité — Object Lock mode COMPLIANCE (WORM)** sur les préfixes
  irremplaçables : une version verrouillée n'est ni écrasable ni supprimable, **par personne** (y compris un admin),
  jusqu'à échéance. Governance-mode serait contournable par un rôle privilégié → insuffisant pour « irremplaçable ».
  ⚠️ **À VÉRIFIER, pas supposé** : rien dans nos mesures ne prouve qu'OVH Object Storage expose Object Lock sur la
  région `bhs` ni sur l'offre utilisée → **vérification en file k8s** (portée par i-cond).
- **Repli si Object Lock indisponible** : versioning activé **+ suppression de version interdite par politique IAM**
  (aucune identité ne porte `DeleteObjectVersion` sur ces préfixes) **+ MFA-delete si supporté**. Ce que ce repli
  **NE garantit PLUS** : ce n'est **pas** du WORM — un porteur de la politique IAM (ou un changement de politique)
  peut lever l'interdiction et supprimer une version. La conservation devient **« protégée par politique »,
  révocable**, et non **« immuable par verrou »**. Réduction de garantie à **signaler dans le dossier de décision**.
- **Borner la rétention** : rétention **déclarée explicitement** (pas une absence de lifecycle — une absence n'est
  pas une garantie et se change silencieusement). Les octets `raw/cas` ne périment jamais (C-7).
- **⚠️ L'irréversibilité de COMPLIANCE = DÉCISION OWNER, pas un réglage.** Une version verrouillée ne peut être
  supprimée **par personne, y compris l'owner**, jusqu'à échéance : cela **engage le stockage pour toute la durée**
  et **interdit d'effacer une donnée même sur demande légitime**. **Durée proposée : COMPLIANCE 1 an, ROULANTE**
  (re-verrou à chaque cycle → protection continue, mais réversibilité retrouvée en cessant le renouvellement au bout
  d'≤ 1 an, plutôt qu'un verrou « à vie » irréversible). **Coût induit** = octets verrouillés × prix stockage/Go/mois
  × durée, payé **quoi qu'il arrive** (COMPLIANCE interdit la suppression anticipée) : négligeable sur l'irremplaçable
  actuel (44 grilles), **dominé par le futur `raw/` (50–400 Gio projetés)** → chiffrage exact = i-infra/k8s.
  **Question owner** (au même rang que la région) : valider la **durée** (1 an roulant proposé) et le **mode**
  (COMPLIANCE irréversible vs repli politique révocable).
- **Suppression accidentelle** : versioning + (lock **ou** MFA-delete) → une suppression ne détruit pas la donnée.

## 4. Copie idempotente + inventaire

- **Copie** : idempotente (skip si la clé cible existe avec même taille/sha), **append-only** vers la cible,
  **jamais de delete**. Exécutée par un **job cluster** (RO source / WO cible), estampée du `coherence_id` du cycle.
- **Inventaire** produit à chaque cycle, par objet : `{ clé, taille, sha256 (quand présent), date, version-id cible }`.

## 5. Inventaire VÉRIFIABLE — pas seulement produit (revue immo #2)

L'inventaire doit pouvoir être **contrôlé contre le contenu réel du bucket cible**, pas juste émis :

- **`raw/cas/<sha256>`** : le **nom EST le sha256** → on recalcule `sha256(octets copiés) == nom == inventaire`.
  Vérification de bout en bout triviale et **forte** (intégrité par construction).
- **`sources/qc-zonage-grilles/`** : si un sha256 de capture existe → idem ; sinon `taille` + `ETag` S3
  (avec la limite connue de l'ETag multipart, à noter).
- **Réconciliation cible ↔ inventaire** : lister le bucket cible **avec les version-ids**, comparer à l'inventaire
  (clé, version-id, taille, sha256). Tout écart (objet manquant, taille divergente, hash divergent, version
  inattendue) = **alarme**. C'est cette réconciliation qui prouve « l'inventaire correspond au bucket », pas le
  simple succès du job.
- **Contrôle périodique** (pas seulement à la copie) : re-list + re-hash d'un **échantillon** régulier + un
  contrôle complet à cadence définie → détecte une dérive/corruption silencieuse côté cible.

## 6. Consistance de cycle — `coherence_id` + immuabilité

- **`coherence_id` commun** au cycle PRA (immo-PG + immo-S3 + bucket-geo). geo l'utilise déjà pour le
  preprod-sync (§6.1) → réutilisable, estampé sur l'inventaire.
- **geo n'exige AUCUN gel d'écritures** : les irremplaçables sont **immuables / content-addressed**
  (`raw/cas/<sha256>` WORM ; grilles append-only) → seules de **nouvelles clés** apparaissent, jamais de
  réécriture en place → une copie est **cohérente sans freeze**. Le gel ne concerne que ce qui se modifie en
  place = **la base PostgreSQL immo** (confirmé avec i-cond : le gel global immo+geo initial est retiré).
- **Écritures pendant la fenêtre** : de nouvelles captures peuvent atterrir (nouvelles clés) — non corruptrices,
  rattrapées au cycle suivant. `normalized/` peut se re-stamper : hors copie (re-dérivable).

## 7. Graphe de dépendances pour la RESTAURATION

- Le bucket irremplaçable geo est **indépendant** de la PG/S3 immo.
- Chaîne de re-dérivation geo : `raw/ + capture/_runs/ (+ sources/grilles)` = source captée →
  re-dérive `normalized/` (servi, rejouer les pipelines) → re-dérive `exports/immo/` (contrat).
- **Ordre restore geo** : (1) restaurer les irremplaçables (`raw/`, `capture/_runs/`, `sources/qc-zonage-grilles/`) →
  (2) re-dériver `normalized/` → (3) re-dériver `exports/immo/`. **PostGIS** se reconstruit depuis `normalized/`.
- **Arête inter-projet** : **immo dépend de geo** pour `exports/immo/` (contrat), **geo ne dépend pas d'immo**.
  Donc dans la séquence d'ensemble : **restaurer geo (jusqu'à exports/immo/) AVANT qu'immo re-lise le contrat.**

## 8. Mesuré vs non mesuré (les non-mesurés → k8s, demande portée par i-cond)

| Élément | Valeur | Source |
|---|---|---|
| Bucket `sentropic-geo` entier | ~48.9 GB / 45 378 objets | relevé migration OVH 2026-07-29 (`s3-target.json`) — **mesuré** |
| `sources/qc-zonage-grilles/` | 44 objets ; **taille = non mesurée** | dépôt (compte) / S3 (taille) |
| `raw/` + `capture/_runs/` | **0 objet aujourd'hui** | spec (non matérialisé) |
| Versioning `sentropic-geo` actif ? | **non confirmé** (« souhaitable », `SPEC_CAPTURE_ON_CLUSTER.md:231`) | **à confirmer live (k8s)** |
| Object Lock (COMPLIANCE) dispo OVH `bhs` / offre ? | **non vérifié** | **à vérifier (k8s)** |
| Débit de copie | **non mesuré** | job/k8s |
| RTO / RPO réels | **non mesuré** | job/k8s |

- **RTO/RPO** : l'irremplaçable **actuel** est minuscule (44 PDF) → copie de l'ordre secondes–minutes.
  Le **futur `raw/`** (projeté « 50–400 Gio », incertitude trop large pour un chiffre — `SPEC_CAPTURE_ON_CLUSTER.md`)
  dominera → RTO/RPO du set complet = **N-A** jusqu'à ce que `raw/` existe **et** soit mesuré.

## 9. Gates (ce que le merge ne fait PAS)

- **Aucun acte cluster/S3 au merge** : ce PR = le plan. La copie est un **job à armer** post-décision owner.
- Ordre : **relecture i-cond** (avant présentation) → **décision owner** (versioning confirmé, nom + région du
  bucket, rétention/lock) → **mesures k8s** → armer le job de copie + le contrôle de réconciliation.

## 10. Questions owner (pour le dossier de décision — au même rang)

1. **Versioning** `sentropic-geo` : confirmé actif ? (le dépôt le dit seulement souhaitable ; confirmation k8s en cours).
2. **Bucket cible** : `sentropic-geo-pra` — OK ?
3. **Région** : une cible dans `bhs` **ne couvre pas** une panne régionale. Cible cross-région (autre région OVH / 2ᵉ provider) ? — chiffrage i-infra/k8s, arbitrage owner.
4. **Object Lock COMPLIANCE** : disponible sur OVH `bhs` / l'offre ? (vérif k8s). Sinon **repli « protégé par politique », révocable** (§3) — garantie réduite (pas de WORM) à acter.
5. **Rétention** : durée + mode. **Proposé : COMPLIANCE 1 an roulant.** L'owner tranche la **durée**, l'**irréversibilité** (COMPLIANCE interdit toute suppression, y compris la sienne, jusqu'à échéance) et **assume le coût de stockage induit** (négligeable aujourd'hui, dominé par le futur `raw/`).

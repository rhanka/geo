# AUTOSEED2-VALIDATE — validation du recalage vectoriel autonome T2 `--auto-seed`

Date: 2026-07-02
Agent: autoseed2 (opus 4.8, natif local)
Rôle: **validation** de la capacité `--auto-seed` (déjà livrée et committée), pas de nouveau code.

## Constat de départ (anti-doublon)

La feature `--auto-seed` demandée par la mission **existe déjà**, committée sur
`feat/cadre-acquisition` par une session sœur :

- `7e766f3` feat(zones): `--auto-seed` pour t2-autogcp (bbox+rotation coarse seed, residual-gated)
- `729573b` iso-gate dur orientation/isotropie sur `--auto-seed`
- `aab83dd` désambiguïsation de rotation par lot-assignment (`--rotation-disambig lots`)
- `1504402` `--fit similarity` (Umeyama 2D)
- `6e27095` arbitrage anisotropie modérée par couverture-lots (`--aniso-lot-arbitrate`)
- `facdcd7` `t2-build-multisheet` (plans multi-feuillets)
- doc: `3567c3d` `docs/spec/zonage-georeferencement-gcp.md` §6–§10

Le pipeline (`acquisition/src/lib/t2-autogcp.ts::deriveAutoSeedGcps` + CLI
`acquisition/src/t2-autogcp.ts`) : bbox cadastre S3 (WGS84) → extents du corps de
carte (density / density+10/20% / percentile / full) × 4 rotations → dérivation
autogcp existante (coins de lots réels) → gate résidu+holdout → iso-gate
(orientation north-up + anisotropie ≤ 1,1 + non-miroir) → arbitrage lot-assignment.
Cette version corrige une faille d'un premier jet naïf « best = plus bas résidu »
(qui verrouillait coteau en **rot180** à 4,2 m — un flip auto-cohérent).

## Test obligatoire — coteau-du-lac (rot0 attendu, ~21 m manuel, 28 zones servies)

PDF: `reglement-no-URB-400-zonage-annexe-A-ensemble-ville.pdf` (A0, 3370,51×2384,25 pt,
vectoriel). Cadastre S3 `qc-cadastre-lots/coteau-du-lac` (3909 lots) — bbox WGS84
identique au seed manuel prouvé.

- `--auto-seed` **seul** → REJET : les 19 seeds franchissent résidu+holdout mais aucun
  ne franchit l'iso-gate. Le fit affine de coteau est **anisotrope 1,10–1,185** (léger
  étirement CAD/projection) alors que `maxAnisotropy = 1,1`. NB: la doc §7.1 cite coteau
  comme « référence iso-gate propre à ~1,01 » — non reproduit ici (l'auto-seed obtient
  1,10–1,18, car ses GCP issus de l'extent `percentile` sont concentrés en bande médiane).
- `--auto-seed --aniso-lot-arbitrate --rotation-disambig lots` → **SERVE** :
  gagnant `percentile/rot0` (orientation VRAIE ; le flip rot180 écarté),
  **résidu 16,99 m ≤ 30 m**, holdout 23,07 m, 17 GCP réels, anisotropie confirmée
  réelle par le cadastre (**serving lot-coverage 98,72 %**).
- `t2-build --dry-run --labels text` sur le GCP gagnant : résidu 16,99 m,
  28 codes lettrés in-frame, spatial 0,85 km, **98,7 % lots**, **23 features servies**.

Verdict coteau : géoréf autonome **CORRECTE** (rot0, ≤30 m, ~99 % lots). Sert 23 zones
vs 28 au seed manuel : l'extent `percentile` rogne le haut/bas de la carte → 5 zones de
bordure tombent « empty » (14 empty labels). L'extent `density+20%` (33 GCP, pleine
hauteur, 4 empty labels) reproduirait plus de zones ; l'arbitrage classe sur la
couverture-lots (98,72 %) et non le nombre de zones → il choisit `percentile`.
Déjà servi sur S3 : `qc-zonage-coteau-du-lac` 28 features, source t2-autogcp, 21,373 m
(issu du **seed manuel**, affine mildly-anisotrope, antérieur à l'iso-gate).

## 2e cas vectoriel — windsor (chemin propre, complémentaire)

PDF: `villedewindsor.qc.ca/.../Plan-de-zonage.pdf` (Esri ArcMap, 4032×3024 pt, texte
Arial sélectionnable). Cadastre S3 (2549 lots).

- `--auto-seed --aniso-lot-arbitrate --rotation-disambig lots` → **PASS** :
  gagnant `density+20%/rot0` via désambiguïsation lot-assignment,
  **résidu 21,66 m ≤ 30 m**, holdout 23,74 m, 36 GCP, **anisotropie 1,042 (propre)**,
  north-up. (Pas d'arbitrage anisotropie nécessaire — chemin iso-gate/disambig propre.)
- `t2-build --dry-run --labels text` : résidu 21,66 m, 139 codes distincts, spatial
  0,51 km, **99,84 % lots**, 138 features. (La serve curée sœur sur S3 = 76 features ;
  écart = politique de fusion/label aval, pas la géoréf.)

## Vérification S3 (dépôts réels `normalized/ca-qc-zonage/`)

| slug            | features | source     | résidu m | lots % |
|-----------------|----------|------------|----------|--------|
| coteau-du-lac   | 28       | t2-autogcp | 21,373   | 99,33  |
| windsor         | 76       | t2-gcp3    | 3,61     | 100    |
| arundel         | 37       | t2-gcp3    | 9,142    | 97,17  |
| hudson          | 43       | t2-gcp3    | 10,937   | 99,31  |

(voir aussi `AUTOGCP-T2MASS2.md` : shard de masse en cours, SKIP honnêtes documentés.)

## Verdict — INDUSTRIALISABLE EN MASSE : **OUI** (sous flags)

L'auto-seed récupère de façon **autonome** la géoréf VRAIE (bonne rotation, ≤30 m,
~99 % lots) sur les deux cas testés, corroboré par 4 villes déjà servies. Anti-invention
respecté : seuls des GCP dérivés (coins de lots) franchissant le gate comptent ; jamais
de bbox-stretch ; SKIP/ABORT honnête sinon.

Conditions/limites pour le driver de masse :
1. **Passer `--aniso-lot-arbitrate --rotation-disambig lots`** : `--auto-seed` seul rejette
   les plans à anisotropie légère (coteau 1,10–1,18) et les ambiguïtés 0°/180° — pourtant
   servables. Ces deux flags sont indispensables à la pleine autonomie.
2. **Sélection d'extent** : l'arbitrage classe sur la couverture-lots, ce qui peut préférer
   un extent (percentile) couvrant bien les lots mais servant moins de zones (bordures
   « empty ») qu'un extent pleine-hauteur (density+20%). Piste d'amélioration : départager
   aussi sur le nombre de zones/labels non-vides.
3. **Réconcilier la doc §7.1** : coteau n'est pas un « pass iso-gate propre à 1,01 » mais un
   cas d'**arbitrage anisotropie** (1,10–1,18) ; windsor (1,042) est le vrai cas propre.

Artefacts de validation (scratchpad, non committés pour éviter collision avec la sœur qui
gère `work/gcp/`) : `coteau.autoseed.aniso.{gcp,report}.json`,
`windsor.autoseed.{gcp,report}.json`, + logs `*.build.stderr.log`.

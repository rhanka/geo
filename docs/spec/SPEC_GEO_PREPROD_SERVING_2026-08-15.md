# SPEC — geo-preprod-serving + contrat data preprod immo↔geo + cycle récup prod→preprod *(cadrage WP6)*

> **Statut : RATIFIÉ owner 2026-08-18 (« ratifie, GO build gaté ») → ADR-0027. Build gaté AUTORISÉ ;
> le déploiement PROD reste propriété owner (KUBE_CONFIG_DATA).** Date : 2026-08-15 ; **MàJ 2026-08-18** —
> 6 besoins §6 groundés socle (Q2/Q5/Q6 tranchés) + §4.1 coherence_id servi + **§4 parité de serving** ; ratifié ADR-0027.
> Auteur : geo-archi (`claude:archi`, WP6 contrats/architecture). **Je cadre ; geo-socle construit ;
> poc-k8s pose la topologie du tier joint ; extraction prod = infra/extraction.**
>
> **Grounding (faits, vérifiés en lecture) :**
> - `radar-immobilier lane/conductor @30a065f : docs/spec/reports/DOSSIER_DECISION_PREPROD_2026-08-15.md`
>   **§6** (preprod jointe cross-repo + contrat data) et **§6.1** (cycle de récup prod→preprod assaini Loi 25).
> - `geo lane/socle : work/preprod-infra-inventory-20260810.md` — faits LIVE OVH (kubectl lecture seule) :
>   convention namespace-par-env, état geo prod, quota `tenant-quota`, S3 `sentropic-geo`, job GHCR
>   `6f916eb4`, contrainte « dernier km » (refresh index).
> - `geo lane/socle : scripts/geo-preprod-infra-facts.mjs @203bb250` (kubectl lecture seule, **2026-08-18**) —
>   faits LIVE **résolvant les 6 besoins §6** : serving **S3-only** (env geo-api prod = `{PORT, GEO_DATA_URI,
>   NODE_ENV}`, **zéro PG**), host/ingress **traefik + letsencrypt-prod**, registre **Scaleway→GHCR (alignement
>   en cours)**, refresh **`rollout restart` + verify gaté coherence_id**, coût **+1 pod** (0 postgis, 0 PVC).
>
> **Anti-invention** : ce cadrage ne fabrique AUCUN chiffre de coût absolu ni valeur infra non observée ;
> toute donnée que je n'ai pas en lecture est marquée `unknown → socle` (liste §6). **HOLD** : rien de
> gelé/ratifié sans OK geo-cond→owner.

---

## 1. Objet & frontières

Le dossier §6 acte que **geo n'a pas de preprod de serving aujourd'hui → à concevoir**. geo-cond m'a
délégué ce cadrage (WP6). Ce document livre :
1. le **design geo-preprod-serving** (namespace, S3, image, isolation, coût — les 6 questions socle) ;
2. le **contrat data preprod immo↔geo** (§6) — ce que geo-preprod sert à immo-preprod, et le point de cohérence ;
3. le **contrat du cycle de récup prod→preprod** (§6.1) — invariants (Loi 25, sens unique, idempotence) ;
4. le **handoff socle** — mes besoins précis en valeurs réelles pour finaliser.

Il ne livre PAS : d'implémentation, de manifeste k8s, de déploiement, ni le gel du modèle de sync
(gated : co-design geo-cond+poc-k8s → double revue → dossier décision, cf. §8).

## 2. Grounding — faits (aucune décision ici, sourcés)

**§6 (owner 2026-08-15)** — preprod = **tier joint cross-repo unique** (immo + geo + poc-k8s) :
- **immo-preprod consomme geo-preprod** (zones, règlements, couches servies) — **jamais geo-prod** ;
- promotion coordonnée ; **un seul `PREPROD_ACCEPTANCE` cross-repo** prouvant le produit de bout en bout ;
- topologie du tier joint (namespaces, isolation, câblage, promotion) → poc-k8s.

**§6.1 (owner 2026-08-15)** — cycle récurrent, contrôlé, assaini :
- sources = PG prod immo (signaux/lots/prospect_*/account_*) + **serving prod geo (S3 normalized / graph / règlements / zones)** ;
- **assainissement Loi 25 OBLIGATOIRE** (anonymiser/retirer la PII) — « production-shaped » ≠ données prod réelles ;
- **sens unique STRICT** : lecture prod → écriture preprod ; **aucun** chemin d'écriture vers la prod ;
- cadence/fraîcheur : périodique, watermark, **rejouable, idempotent** ;
- cross-repo **synchronisé** : immo-preprod et geo-preprod au **même point de cohérence** ;
- propriété : extraction = infra/extraction · assainissement = contrat spec · chargement preprod = poc-k8s.

**Infra LIVE (socle)** : convention **namespace-par-env** ; geo prod = ns `geo` (geo-api 1/1 image
`…/geo-api@sha256:f8b152b1…` + postgis StatefulSet) ; quota `tenant-quota` **2/20 pods, 288Mi/3Gi req,
1536Mi/6Gi lim → marge large** ; S3 = bucket `sentropic-geo` (OVH bhs), `GEO_DATA_URI=s3://sentropic-geo/normalized`,
creds = secret `geo-s3-credentials` ; CI/CD = job GHCR par digest `build-and-push-geo-api-ghcr` (`6f916eb4`) ;
« dernier km » = geo-api cache son index au démarrage → couches fraîches = rollout/refresh (outillé socle).

**Distinction groundée (allège la jambe geo)** : les couches **servies par geo sont des données
publiques** (cadastre / zonage / règlement d'urbanisme). **La charge d'assainissement Loi 25 (§6.1) est
IMMO-side** (PG : prospect_contacts, access_log, identités). **La jambe geo du cycle = copie idempotente
S3→S3, sans PII à retirer** — SAUF si une couche servie par geo embarque de la donnée personnelle
d'origine immo (`caveat` à vérifier, §9). Position par défaut groundée : geo-servi = public → copie seule.

## 3. Décisions de cadrage — les 6 questions socle *(recommandation groundée + ce qui reste socle-gated)*

| # | Question | Recommandation (groundée) | Gate |
|---|---|---|---|
| Q1 | ns preprod dédié vs réutiliser `sentropic-preprod` | **`geo-preprod` dédié** : suit la convention ns-par-env (matchid/openerp), isole RBAC/secrets/quota, épouse la séparation immo-preprod↔geo-preprod du §6. Réutiliser `sentropic-preprod` co-mêlerait deux apps/cycles. | ratif. geo-cond+poc-k8s |
| Q2 | S3 : préfixe `normalized-preprod/` vs bucket séparé | **DÉCISION = bucket séparé** (socle 2026-08-18) : creds OVH S3 = clés liées à un user OpenStack, le write-deny par préfixe façon IAM AWS **n'est PAS garanti** (`unknown`). Anti-invention : le sens unique §6.1 ne doit pas dépendre d'une capacité non vérifiée → un **bucket preprod séparé** impose la frontière au niveau credential/bucket (blast-radius propre), sans policy de préfixe. `GEO_DATA_URI` preprod pointe le bucket preprod. **Probe socle** en cours (documente la capacité OVH ; n'affecte pas la décision). | ✅ tranché (bucket) |
| Q3 | Cycle promotion prod→preprod (Loi25, idempotent) | **Jambe geo = job de sync S3→S3 idempotent**, watermark-driven, tournant côté poc-k8s/socle (source S3 `sentropic-geo` **atteignable socle**, contrairement au PG prod immo qui exige i-infra). Copie seule (données publiques). Rejouable. | co-design poc-k8s |
| Q4 | Isolation prod↔preprod | **SA/RBAC dédiés** au ns `geo-preprod` ; **secret `geo-s3-credentials-preprod` distinct**, sans droit d'écriture prod ; **NetworkPolicy refusant l'egress preprod→prod** ; ingress/host preprod dédié. Invariant : **aucune cred preprod ne peut écrire la prod** (impose §6.1 au niveau infra, pas par convention). | fait socle (host/DNS, IAM) |
| Q5 | Image geo-api preprod : même digest prod vs canal candidat | **Digest CANDIDAT** épinglé `@sha256:<digest>` (jamais `:latest`). Preprod teste le candidat AVANT prod ; `PREPROD_ACCEPTANCE` vert → **promotion du MÊME digest** en prod = re-pointage, pas rebuild. **DÉCISION = aligner prod+preprod sur GHCR-by-digest** (socle 2026-08-18, en cours) : la promotion « re-pointer le même digest » n'est **littérale** qu'avec **un seul canal digest** ; le dual-registre+miroir rajoute une surface de drift. Un canal GHCR = Q5 littérale + une seule source d'identité d'image. geo-preprod prend un **imagePullSecret GHCR dédié**. | ✅ tranché (GHCR) |
| Q6 | Coût dans le quota | **RÉSOLU (socle 2026-08-18) = +1 pod geo-api-preprod** (req **75m CPU / 128Mi**, lim **500m CPU / 768Mi**), **0 postgis** (serving S3-only → le postgis du ns geo n'est pas dans le chemin de serving OGC), **0 PVC**. Ns dédié `geo-preprod` → quota propre (grant owner/infra) ; trivial côté cluster. ⚠ Quota **secrets** du ns : prévoir ≈ 3 (S3-preprod + GHCR-pull + tls). | ✅ tranché (1 pod) |

## 4. Contrat data preprod immo↔geo *(§6)*

- **Ce que geo-preprod SERT — PARITÉ COMPLÈTE (invariant, ratifié ADR-0027)** : geo-preprod sert
  **l'intégralité du set servi par geo-prod** pour les familles immo, via **la même surface OGC** que la prod
  (mêmes contrats de provenance), sur un **host preprod dédié**. Parité **data-driven** (= ce que geo-prod sert
  AUJOURD'HUI, PAS un sous-ensemble curé — geo-api sert le layout S3, pas une liste codée en dur). Familles
  connues à la ratif (grounded conso immo `ogc-pull.ts:689`, i-cond) : `qc-zonage-<slug>` **+ variantes suffixées**
  `qc-zonage-<slug>-<layer>` (`-arcgis`/`-rcu`/`-affectations-arcgis`…, `startsWith`), `qc-lots-<slug>`,
  `qc-zonage-norms-*`, **`qc-tod-<slug>`**, **`qc-zoning-events`**. Le sync copie le set COMPLET ; la gate
  coherence_id (§4.1) vérifie **toutes** les familles servies (pas seulement le zonage de base) — un sous-ensemble
  servi = **échec de parité**.
- **Consommation** : **immo-preprod consomme geo-preprod uniquement** (§6) — imposé par (a) config
  immo-preprod (endpoint geo = host preprod) ET (b) isolation réseau (Q4). Jamais geo-prod.
- **Point de cohérence** : un **`preprod_coherence_id`** partagé (= watermark du snapshot prod épinglé par
  les DEUX jambes de récup) ; la jointure immo↔geo en preprod n'est valide qu'à `coherence_id` égal des
  deux côtés (§6.1 « même point de cohérence »).
- **Ordre « dernier km »** (outillé socle, `scripts/geo-preprod-refresh.mjs` = rollout+verify) : récup écrit
  `normalized-preprod/` + stampe `coherence_id` → **`kubectl rollout restart deployment/geo-api-preprod`**
  (l'index est caché au démarrage) → **verify gaté** (`geo-verify-served-collections.mjs`, `GEO_API_BASE`
  preprod : 200 + numberMatched **au `coherence_id` synchronisé** — un pod stale ÉCHOUE la gate) → alors
  seulement le `coherence_id` est *servi*. La gate assert la **fraîcheur** (coherence_id servi == sync'd), pas
  la seule présence des collections.
- **PREPROD_ACCEPTANCE** (§6, cross-repo unique) : contribution geo = couches servies épinglées au
  `coherence_id` ; l'acceptation assert que la jointure immo↔geo au `coherence_id` partagé réussit.

### 4.1 — Contrat « coherence_id servi » (exposition OGC) *(nouveau, socle 2026-08-18)*

Pour que la gate de fraîcheur (« dernier km ») soit **prouvable THROUGH l'API** (pas seulement en S3),
geo-api DOIT exposer le `coherence_id` **servi** — c'est ce qui prouve que le **pod de serving** a chargé la
nouvelle donnée, pas juste que S3 la contient :
- **Watermark unique dataset-level** (§6.1 : un seul point de cohérence ; TOUTES les collections le partagent —
  geo-api sert tout depuis un snapshot S3, un rollout recharge tout atomiquement).
- **Stampé par le sync** dans un manifeste racine `normalized-preprod/coherence.json` =
  `{ coherence_id, generated_at, prod_watermark }` (ou plié dans l'index served-collections lu au build d'index).
- **Exposé par geo-api via OGC** : propriété `coherence_id` sur chaque `/collections/<id>` **+** sur la landing `/`.
  **Conditionnel** : présent en S3 → servi ; **absent** (ex. prod sans manifeste) → champ **omis** → gate **fail-closed** (correct).
- **Gate socle** (committé `@349c3da5`) : `geo-verify-served-collections.mjs --expect-coherence <id> --coherence-field
  coherence_id` asserte `coherence_id` **servi (lu via l'API)** == sync'd → un pod stale ÉCHOUE (« présent » ≠ « frais »).
- **Chemin JSON = CONFIRMÉ top-level `coherence_id`** (socle 2026-08-18, vérifié contre la sortie OGC RÉELLE via
  `scripts/geo-ogc-collection-dump.mjs`) : landing `/` = `{title, description, links}` et collection `/collections/<id>`
  = `{id, title, attribution, crs, storageCrs, license, links}` → **top-level `coherence_id` libre sur les DEUX, zéro
  collision** ; la gate socle (défaut `--coherence-field coherence_id`, top-level) est **déjà alignée** (zéro changement
  verifier une fois le champ exposé).
- **Implémentation = petite addition geo-api** (`packages/geo` : lire le manifeste au build d'index → injecter `coherence_id`
  top-level sur collection **et** landing, conditionnel). **geo-owned, ordonnancé par geo-cond** ; preneur candidat = **socle**
  (serving = son domaine). **Tant que non exposé, la gate fail-closed = correct.**

## 5. Contrat du cycle de récup prod→preprod *(§6.1)*

**Invariants (testables, non négociables) :**
1. **Sens unique STRICT** — lecture prod → écriture preprod ; **aucune** cred/route preprod ne peut écrire
   la prod (imposé au niveau cred+NetworkPolicy, Q4 ; pas seulement documentaire).
2. **Idempotent + rejouable** — rejouer à un watermark donné converge vers le même état preprod.
3. **Fraîcheur watermark** — chaque passe publie un watermark ; la preprod expose son point de fraîcheur.
4. **Cohérence cross-repo** — jambe geo et jambe immo épinglent le **même** point de cohérence prod.

**Jambe geo (dans le périmètre de ce cadrage)** : `s3://sentropic-geo/normalized/…` → chemin preprod
(Q2). **Copie seule** (données publiques, §2). Le job émet `coherence_id` = watermark du snapshot prod copié.

**Jambe immo (contexte, propriété immo/i-infra)** : PG prod → **assaini Loi 25** → preprod, synchronisée
au même `coherence_id` que la jambe geo.

**Répartition de propriété (§6.1)** :
| Étape | geo | immo |
|---|---|---|
| Extraction prod | S3 `sentropic-geo` (**atteignable socle**) | PG prod (i-infra, OVH prod hors kubectl socle) |
| Assainissement | copie seule (public) `caveat` §9 | anonymisation PII Loi 25 = contrat spec |
| Chargement preprod | poc-k8s | poc-k8s |
| Refresh « dernier km » | rollout/refresh geo-api-preprod (outillé socle) | — |

Alimente les « fixtures production-shaped nettoyées » exigées par §5.2 du dossier (tests de migration).

## 6. Handoff socle — RÉSOLU *(valeurs réelles remontées, socle 2026-08-18 `geo-preprod-infra-facts.mjs @203bb250`)*

| # | Besoin | Fait remonté (socle) | Décision |
|---|---|---|---|
| 1 | postgis requis pour le SERVING ? | **NON.** env geo-api prod = `{PORT=8787, GEO_DATA_URI=s3://…/normalized, NODE_ENV=production}`, **zéro var PG** ; serving OGC depuis **S3 seul**. | Q6 = 1 pod, 0 postgis |
| 2 | creds S3 scopables par préfixe ? | **`unknown`.** OVH S3 = clés liées à un user OpenStack ; prefix-deny IAM **non garanti**. Probe socle en cours (documentaire). | Q2 = **bucket séparé** |
| 3 | host/ingress + cert | **traefik** + cluster-issuer **letsencrypt-prod** ; host preprod `api.preprod.geo.sent-tech.ca`, tls `geo-api-preprod-tls`, cert **auto** (cert-manager). | Q4 ✅ (seul **DNS** = owner/infra) |
| 4 | registre image | Scaleway aujourd'hui (`rg.fr-par.scw.cloud/…`, pull secret `geo-registry-pull`) ; job GHCR pousse déjà sur GHCR. | Q5 = **aligner GHCR-by-digest** + imagePullSecret GHCR preprod |
| 5 | empreinte postgis preprod | **N/A** (découle de #1). Réf. prod : req 30m/160Mi, lim 768Mi. | — |
| 6 | interface refresh « dernier km » | `kubectl rollout restart deployment/geo-api-preprod` + gate `geo-verify-served-collections.mjs` (coherence_id) → packagé **`geo-preprod-refresh.mjs`** (validé). | §4 câblé |

**Reste 2 dépendances externes** : (a) **enregistrement DNS** du host preprod = owner/infra ; (b) **probe socle** capacité OVH prefix-deny = documentaire (n'affecte pas Q2).

## 7. Isolation & sûreté *(Loi 25 + sens unique — invariants assertables)*

- **A1** — geo-preprod écrit dans un **bucket S3 preprod séparé** (Q2, socle 2026-08-18) ; **aucune cred montée en `geo-preprod` n'a de droit d'écriture sur le bucket prod `sentropic-geo`** ni sur le PG prod (frontière au niveau bucket, pas par policy de préfixe non garantie).
- **A2** — NetworkPolicy : egress `geo-preprod` → endpoints prod = **refusé** (le cycle lit la prod depuis la
  jambe d'extraction, pas depuis les charges de serving preprod).
- **A3** — endpoint geo de immo-preprod = host preprod (assert config), jamais le host prod.
- **A4** — image preprod épinglée par digest immuable (jamais `:latest`).
- **A5** — **parité de serving** (ADR-0027) : geo-preprod sert le set **COMPLET** de geo-prod pour les familles
  immo (data-driven, cf. §4) ; la gate coherence_id (§4.1) échoue si une famille servie en prod manque en preprod
  → un sous-ensemble servi n'est jamais « frais ET complet ».

## 8. Séquencement & ce qui reste gated

```
ce cadrage (WP6, geo-archi) ─► co-design geo-cond + poc-k8s (topologie tier joint, §6)
    ─► double revue ─► dossier décision « modèle de sync détaillé »
        (contrat data preprod, ordre de promotion, acceptation conjointe)
    ‖ geo-socle : build/expose geo-preprod (ns, deploy, ingress, secret preprod, câblage sync, refresh)
    ‖ poc-k8s : chargement preprod + coordination cross-repo
```
**Déploiement PROD reste owner** (KUBE_CONFIG_DATA). **HOLD** : rien de gelé/ratifié sans OK geo-cond→owner.

## 9. Reste `unknown` (anti-invention)

- **6 faits socle §6 → RÉSOLUS** (socle 2026-08-18, cf. §6 table). Coût groundé = +1 pod (75m/128Mi–500m/768Mi), 0 postgis, 0 PVC.
- **Capacité OVH prefix-deny** : `unknown` — probe **différée** (socle 2026-08-18, raison factuelle) : la tester n'est PAS read-only (exige `put-bucket-policy` sur le bucket PROD `sentropic-geo`, risque de verrouiller la prod, ou l'IAM OVH **owner-held**) → on ne mute pas la policy du bucket prod sur un track non tranché. La décision Q2 = bucket séparé **n'en dépend PAS** ; probe quand (a) track avancé + (b) accès IAM owner (documentaire, `unknown → fait`).
- **Enregistrement DNS** du host `api.preprod.geo.sent-tech.ca` = dépendance owner/infra (DNS externe).
- **`caveat` Loi 25 geo** : vérifier qu'aucune couche servie par geo n'embarque de donnée personnelle
  d'origine immo. Défaut groundé = geo-servi public → copie seule ; à confirmer avant de graver « copie sans assainissement ».
- Topologie exacte du tier joint (namespaces croisés, promotion) : propriété poc-k8s (§6).

---

## Références
- `radar-immobilier lane/conductor @30a065f` : `DOSSIER_DECISION_PREPROD_2026-08-15.md §6/§6.1` ;
  `SPEC_EVOL_PREPROD_RELEASE_SAFETY_2026-08-15.md` (§5.2 fixtures).
- `geo lane/socle` : `work/preprod-infra-inventory-20260810.md` (faits LIVE OVH).
- Décision cadre : `docs/decisions.md` (ADR preprod à ouvrir par geo-cond si ratifié).

**DRAFT cadrage — OWNER-GATED — je cadre, socle construit, PROD reste owner. Anti-invention : faits
sourcés ligne à ligne, `unknown → socle` pour tout non-observé, zéro chiffre fabriqué.**

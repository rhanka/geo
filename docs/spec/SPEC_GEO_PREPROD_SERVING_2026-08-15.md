# SPEC — geo-preprod-serving + contrat data preprod immo↔geo + cycle récup prod→preprod *(cadrage WP6)*

> **Statut : DRAFT cadrage/étude — OWNER-GATED. Aucune implémentation ni déploiement avant
> ratification ; le déploiement PROD reste propriété owner (KUBE_CONFIG_DATA).** Date : 2026-08-15.
> Auteur : geo-archi (`claude:archi`, WP6 contrats/architecture). **Je cadre ; geo-socle construit ;
> poc-k8s pose la topologie du tier joint ; extraction prod = infra/extraction.**
>
> **Grounding (faits, vérifiés en lecture) :**
> - `radar-immobilier lane/conductor @30a065f : docs/spec/reports/DOSSIER_DECISION_PREPROD_2026-08-15.md`
>   **§6** (preprod jointe cross-repo + contrat data) et **§6.1** (cycle de récup prod→preprod assaini Loi 25).
> - `geo lane/socle : work/preprod-infra-inventory-20260810.md` — faits LIVE OVH (kubectl lecture seule) :
>   convention namespace-par-env, état geo prod, quota `tenant-quota`, S3 `sentropic-geo`, job GHCR
>   `6f916eb4`, contrainte « dernier km » (refresh index).
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
| Q2 | S3 : préfixe `normalized-preprod/` vs bucket séparé | **Préfixe `normalized-preprod/` SI** les creds preprod peuvent être **scopées par préfixe** (écriture `normalized-preprod/*` autorisée, `normalized/*` **refusée** → sens unique §6.1 imposé au niveau IAM). **SINON bucket séparé** (blast-radius propre). `GEO_DATA_URI` preprod pointe le chemin preprod. | fait socle (IAM préfixe ?) |
| Q3 | Cycle promotion prod→preprod (Loi25, idempotent) | **Jambe geo = job de sync S3→S3 idempotent**, watermark-driven, tournant côté poc-k8s/socle (source S3 `sentropic-geo` **atteignable socle**, contrairement au PG prod immo qui exige i-infra). Copie seule (données publiques). Rejouable. | co-design poc-k8s |
| Q4 | Isolation prod↔preprod | **SA/RBAC dédiés** au ns `geo-preprod` ; **secret `geo-s3-credentials-preprod` distinct**, sans droit d'écriture prod ; **NetworkPolicy refusant l'egress preprod→prod** ; ingress/host preprod dédié. Invariant : **aucune cred preprod ne peut écrire la prod** (impose §6.1 au niveau infra, pas par convention). | fait socle (host/DNS, IAM) |
| Q5 | Image geo-api preprod : même digest prod vs canal candidat | **Digest CANDIDAT** épinglé `@sha256:<digest>` (jamais `:latest`, cohérent §2 du dossier). Preprod teste le candidat AVANT prod ; `PREPROD_ACCEPTANCE` vert → **promotion du MÊME digest** en prod (approuvé owner) = re-pointage, pas rebuild. CI/CD = job GHCR par digest (`6f916eb4`). | fait socle (registre GHCR vs Scaleway) |
| Q6 | Coût dans le quota 20-pods/6Gi | **geo-preprod minimal = geo-api (1 pod)** + **postgis preprod UNIQUEMENT si le serving en dépend** (à confirmer §6). Enveloppe : usage courant 2/20 pods, marge large → +1 à +2 pods tient. Chiffre exact = 2 faits socle (postgis requis ? empreinte mém.). | faits socle |

## 4. Contrat data preprod immo↔geo *(§6)*

- **Ce que geo-preprod SERT** : `{zones, règlements, couches servies}` via **la même surface OGC** que la
  prod (mêmes collections `qc-zonage-<slug>`, mêmes contrats de provenance), sur un **host preprod dédié**.
- **Consommation** : **immo-preprod consomme geo-preprod uniquement** (§6) — imposé par (a) config
  immo-preprod (endpoint geo = host preprod) ET (b) isolation réseau (Q4). Jamais geo-prod.
- **Point de cohérence** : un **`preprod_coherence_id`** partagé (= watermark du snapshot prod épinglé par
  les DEUX jambes de récup) ; la jointure immo↔geo en preprod n'est valide qu'à `coherence_id` égal des
  deux côtés (§6.1 « même point de cohérence »).
- **Ordre « dernier km »** : récup écrit `normalized-preprod/` → **rollout/refresh geo-api-preprod**
  (l'index est caché au démarrage, contrainte socle) → alors seulement le nouveau `coherence_id` est *servi*.
- **PREPROD_ACCEPTANCE** (§6, cross-repo unique) : contribution geo = couches servies épinglées au
  `coherence_id` ; l'acceptation assert que la jointure immo↔geo au `coherence_id` partagé réussit.

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

## 6. Handoff socle — mes besoins précis *(valeurs réelles à me remonter pour finaliser)*

1. **postgis requis pour le SERVING ?** geo-api-preprod sert-il depuis S3 seul (`GEO_DATA_URI`), ou a-t-il
   besoin de postgis (⇒ +1 pod preprod) ? → tranche Q6 (1 vs 2 pods).
2. **Creds S3 scopables par préfixe ?** OVH S3 permet-il une cred écrivant `normalized-preprod/*` mais
   **refusée** sur `normalized/*` ? → tranche Q2 (préfixe vs bucket séparé) en imposant le sens unique.
3. **Host/ingress preprod** (ex. `api.preprod.geo.…`) + cert (cert-manager présent) → Q4.
4. **Registre image preprod** : GHCR (job `6f916eb4`) vs Scaleway (registre prod actuel) — aligner ou dual ? → Q5.
5. **Empreinte mém. postgis preprod** (si requis) → chiffre Q6.
6. **Interface du refresh « dernier km »** (handle/commande de rollout/refresh déjà outillé) → câbler l'ordre récup→refresh du §4.

## 7. Isolation & sûreté *(Loi 25 + sens unique — invariants assertables)*

- **A1** — aucune cred montée en `geo-preprod` n'a de droit d'écriture sur `normalized/*` (prod) ni sur le PG prod.
- **A2** — NetworkPolicy : egress `geo-preprod` → endpoints prod = **refusé** (le cycle lit la prod depuis la
  jambe d'extraction, pas depuis les charges de serving preprod).
- **A3** — endpoint geo de immo-preprod = host preprod (assert config), jamais le host prod.
- **A4** — image preprod épinglée par digest immuable (jamais `:latest`).

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

- Les 6 faits socle du §6 (postgis-serving, IAM préfixe, host, registre, empreinte postgis, interface refresh) — `unknown → socle`.
- **`caveat` Loi 25 geo** : vérifier qu'aucune couche servie par geo n'embarque de donnée personnelle
  d'origine immo. Défaut groundé = geo-servi public → copie seule ; à confirmer avant de graver « copie sans assainissement ».
- Chiffre de coût absolu (pods/Mi/CPU) : `unknown` tant que Q6.1/Q6.5 non remontés ; pas de nombre fabriqué.
- Topologie exacte du tier joint (namespaces croisés, promotion) : propriété poc-k8s (§6).

---

## Références
- `radar-immobilier lane/conductor @30a065f` : `DOSSIER_DECISION_PREPROD_2026-08-15.md §6/§6.1` ;
  `SPEC_EVOL_PREPROD_RELEASE_SAFETY_2026-08-15.md` (§5.2 fixtures).
- `geo lane/socle` : `work/preprod-infra-inventory-20260810.md` (faits LIVE OVH).
- Décision cadre : `docs/decisions.md` (ADR preprod à ouvrir par geo-cond si ratifié).

**DRAFT cadrage — OWNER-GATED — je cadre, socle construit, PROD reste owner. Anti-invention : faits
sourcés ligne à ligne, `unknown → socle` pour tout non-observé, zéro chiffre fabriqué.**

# Run capture cluster — cohorte grandes villes zéro-capture

Journal de la capture PV des GRANDES villes encore zéro-capture (identifiées par
croisement `municipal_coverage.slugs` 673 committé `2a1015f8` vs référentiel
1106). Cible : Québec, Laval, Sherbrooke, Saguenay, Trois-Rivières, Terrebonne,
Saint-Hyacinthe, Rimouski — quasi-certainement membres du palier 167.

## Découverte read-only — `20260803T195800Z`
Runner `acquisition/src/pv-decouverte-worklist.ts` (voies bornées, lecture web
seule, `no_document_bytes_read`) sur les 8 slugs.
- **Résultat** : `candidate=1, no_candidate=6, indeterminate=1`. Seule
  **TERREBONNE** rend des candidats par les voies par défaut (WordPress media) :
  23 PV octet-désignés (`terrebonne.ca/wp-content/uploads/…`, séances CE + CM).
- Les 7 autres (portails propres, non-WordPress) rendent 0 par défaut →
  **seeding `--seed-pages` requis** (URL de portail PV officiel vérifiée
  read-only). Beat suivant.
- **Fix durable capitalisé** (`83f8c775`) : le piège récurrent `source=pv-discovery`
  (octets orphelins de la métrique, clé sur `raw/pv-index/cas/`) est corrigé par
  un flag `--source` (défaut `pv-index`) + `buildCaptureTargets` testé. La
  worklist terrebonne porte `source=pv-index`.
- Artefacts : `work/coverage/pv-decouverte-grandes-villes-20260803T195800Z.json`
  (+ `-capture-lot-0001.json`).

## Soumission cluster — `20260803T210500Z`
- **Job** : `geo-capture-pv-20260803t210500z` (OVH `poc-ca`, ns `geo` ; garde
  anti-mauvais-cluster PASS via `acquisition/config/k8s-target.json`).
- **Worklist S3 (contrat)** : `s3://sentropic-geo/registry/capture-worklists/pv-20260803T210500Z.json`.
- `--shards 1 --concurrency 1 --memory-limit-mi 512` (1 ville/pod). CAS attendu
  sous `raw/pv-index/cas/<sha>.<ext>`. Aucun polling local.
- **Classification** (`pv-capture-octets-20260803T210500Z.json`) : run TERMINAL,
  23 tentatives → **23× `HTTP_403` (« malgré User-Agent navigateur »)**,
  0 confirmé, 0 octet durable (`storage_key=null`). `terrebonne.ca` bloque le
  fetch PDF depuis l'egress cluster (WAF/IP datacenter ou protection hotlink sur
  `/wp-content/uploads/`) — la découverte lisait le HTML en 200, mais l'octet du
  document est muré. **Terrebonne NE monte PAS** : mur de capture réel, pas une
  invention de couverture. À retenter via un egress alternatif (`--egress tor:pv`
  / proxy) ou une source hors-WAF ; sinon capture-bound documenté.

## Soumission cluster 2 — laval + rimouski (seed) — `20260803T211500Z`
- Seed découverte (`45436fc6`) : **rimouski 74 PV** (`/storage/app/media/…`,
  robots OK), **laval 6 PV** (comité exécutif, Azure blob ; ≥1 INDEXED suffit
  pour la couverture-ville). 5 autres grandes villes à re-sourcer (SPA/viewer/DNS).
- **Job** : `geo-capture-pv-20260803t211500z` (2 shards, concurrency 2, 512Mi ;
  1 ville/pod). Worklist S3 `pv-20260803T211500Z.json`. Aucun polling.
- **Classification** (`pv-capture-octets-20260803T211500Z.json`) : run TERMINAL,
  80 tentatives → **74 `PV_LISIBLE_PROPRIETAIRE_CONFIRME`** (92,5 %) + 6
  `DOCUMENT_LISIBLE_NON_PV` (ordres-du-jour rimouski). Ventilation confirmés :
  **rimouski 68**, **laval 6**. Les PV de comité exécutif de laval sont bien
  classés PV (propriétaire « VILLE DE LAVAL » confirmé par texte natif) — pas
  besoin des PV de conseil pour la couverture-ville (≥1 INDEXED suffit).
- **Câblage → verdict → recompte** : générateur capitalisé
  `acquisition/src/pv-octets-to-verdict.ts` (fonction pure testée
  `verdictDocumentsFromOctets`, anti-invention : n'indexe qu'une ligne confirmée
  COMPLÈTE, dédup CAS) → verdict
  `pv-lecture-visuelle-grandes-villes-lot-01-rimouski-20260803T211500Z.json`
  (74 INDEXED : laval 6 + rimouski 68) folded par `pv-couverture-municipale`
  (glob `pv-lecture-visuelle-*`). **Couverture 673 → 675/1106 (+2 : laval,
  rimouski).**

## Bilan cohorte grandes villes (à ce beat)
- **+2 capté strict** : laval, rimouski (INDEXED committé).
- **1 mur capture** : terrebonne (403 WAF/IP ; egress alternatif à tenter).
- **5 à re-sourcer** : quebec, saguenay, trois-rivieres, sherbrooke,
  saint-hyacinthe (SPA/viewer/DNS) → prochain beat seeding profond.

## Re-sourcing profond des 5 — `20260803T213000Z` (0/5, MURS INFRA/POLITIQUE)
Découverte read-only ciblée (evidence box-side datée committée `0793607c` :
`pv-decouverte-grandes-villes-resource2-20260803T213000Z.json`). Les vraies
sources PDF sont identifiées mais AUCUNE n'est capturable proprement ce beat —
mur d'infrastructure ou de politique, pas un défaut de découverte :
- **saint-hyacinthe** — la plus proche : PV **same-domain**
  `www.st-hyacinthe.ca/medias/ville/vie-democratique/seances-publiques/AAAA/PVSE*.pdf`.
  Blocage = **chaîne TLS incomplète du serveur** (« unable to verify the first
  certificate ») : casse `fetch` strict node ET WebFetch (confirmé aux deux
  stacks). Mur SERVEUR, pas box. Débloquer = capture-worker qui complète la
  chaîne (intermédiaire fourni / CA bundle) — enhancement infra.
- **trois-rivieres, sherbrooke** — famille **maruche OFFSITE**
  (`conseil-v3r.maruche.ca` / `contenu.maruche.ca`, hôtes ≠ domaine officiel) :
  la porte `sameOfficialDomain` refuse par conception. Débloquer = décision de
  politique (allowance maruche avec preuve de rattachement ville) ou un
  `source_kind` maruche-aware.
- **saguenay, quebec** — **SPA purs** : PDF chargés par XHR/JS, 0 ancre SSR,
  aucun endpoint `{html}` same-domain. Émettre un candidat exigerait de sniffer
  l'endpoint de données (headless) — hors mandat read-only, et le runner
  interdit de deviner les URLs (anti-invention).

### Prochains beats possibles (hors ce beat, pour l'owner)
- **Wayback/CDX** (`matchType=domain`, `http://`) pour saint-hyacinthe / saguenay
  / quebec : l'archive porte un cert valide et des snapshots PDF ancrés — voie la
  plus probable pour convertir sans toucher l'infra.
- **capture-worker TLS/CA + egress alternatif** : débloquerait à la fois
  saint-hyacinthe (chaîne) et terrebonne (WAF 403).
- **politique maruche** : débloquerait trois-rivieres + sherbrooke (+ d'autres
  munis de la même famille).

## Bilan NET cohorte grandes villes
**+2 captés strict committés (laval, rimouski, → couverture 675/1106).**
6 restants documentés avec preuve reproductible : 1 mur WAF (terrebonne),
2 murs offsite-politique (trois-rivieres, sherbrooke), 2 SPA (saguenay, quebec),
1 mur TLS-serveur (saint-hyacinthe). Aucun UNKNOWN fabriqué en N-A ni en
complete : chaque mur est tracé, rejouable.

## Résiduels → prochain beat
- 7 grandes villes à seeder (portails propres) : découvrir l'URL du portail PV
  officiel de chacune (read-only), `--seed-pages slug=URL`, re-découverte →
  worklist `source=pv-index` → capture cluster.

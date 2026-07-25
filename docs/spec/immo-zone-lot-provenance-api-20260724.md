# Contrat Immo — provenance de géométrie de zone servie (déploiement réel)

**Statut :** additif, SERVI en production (audit readback confirmé).
**Date :** 2026-07-24.
**Producteur :** geo. **Consommateur :** immo.
**Relation au contrat antérieur :** complète
[`immo-zone-lot-provenance-api-20260722.md`](./immo-zone-lot-provenance-api-20260722.md)
(« recovery r2 »). Ce document-ci décrit ce qui est **réellement déposé sur
les features `qc-zonage` servies aujourd'hui** — deux propriétés plates,
directement sur `properties`, distinctes de l'enveloppe imbriquée
`immo_zone_lot_provenance` du contrat 20260722 (laquelle reste une
proposition non implémentée à ce jour). Ne pas confondre les deux : ce
document est la source de vérité pour ce qui est consommable *maintenant*.

## 1. Ce qui est servi

Chaque feature d'une collection `qc-zonage-<slug>` servie porte désormais
deux propriétés additives :

```ts
type ZoneSourceLevel =
  | "historical-verified"
  | "legacy-traceable"
  | "candidate"
  | "orphan"
  | "unknown";

interface QcZonageFeatureProperties {
  // ... propriétés existantes inchangées (zone_code, code_zone, proof, etc.)
  zone_source_url: string | null;
  zone_source_level: ZoneSourceLevel;
}
```

- **`zone_source_url`** — l'URL de la source géométrique réelle qui a produit
  le polygone servi (service SIG/ArcGIS/AGOL/GeoNet/WFS/JMap, GeoPDF ou plan
  officiel). `null` signifie qu'**aucune source n'a été conservée** pour
  cette collection — c'est une déclaration de transparence, **pas une
  erreur** et **pas un signal de mauvaise qualité géométrique**. Le polygone
  reste servi et opposable indépendamment de la présence de cette URL.
- **`zone_source_level`** — le niveau de preuve associé à cette source (ou à
  son absence). Voir section 2 pour la sémantique exacte de chaque valeur.

Les deux propriétés sont **identiques sur toutes les features d'une même
collection** (stampées par collection, pas par feature individuellement) et
sont posées par une écriture additive qui **ne touche ni la géométrie ni le
bloc `proof`** existants (voir `acquisition/src/lib/zonage-proof.ts`,
`putServedZoneAdditive` — liste blanche stricte des clés de provenance
modifiables).

## 2. Sémantique exacte de `zone_source_level`

| Valeur | Sens | Avertissement pour l'affichage |
|---|---|---|
| `historical-verified` | Une source géométrique **et** une filiation d'octets ont été vérifiées contre une évidence identifiable. | C'est le seul niveau qui peut être présenté comme « source vérifiée ». |
| `legacy-traceable` | Une chaîne de trace historique est connue et ré-identifiable (souvent avec une URL réelle de service SIG/ArcGIS), **sans vérification suffisante de la filiation octet courante**. | **NE PAS présenter comme une preuve courante.** C'est une lignée historique plausible, pas une certification que les octets servis aujourd'hui proviennent exactement de cette URL. |
| `candidate` | Une source officielle a été identifiée/établie pour la municipalité, mais la filiation octet vers le polygone servi **n'est pas prouvée**. | **NE PAS présenter comme une source vérifiée.** En pratique, `zone_source_url` vaut `null` pour la quasi-totalité des collections `candidate` servies aujourd'hui : la piste existe mais n'est pas encore retenue comme URL publiable sans affirmation de preuve. |
| `orphan` | Aucune source géométrique n'a pu être retenue pour cette collection. | `zone_source_url` est toujours `null`. Le polygone reste servi tel quel — ne jamais masquer ou dégrader une zone à cause de ce niveau. |
| `unknown` | Provenance non évaluée pour cette collection au moment du dépôt (valeur de repli, cas résiduel). | À traiter comme `orphan` côté affichage (aucune preuve à afficher), mais sémantiquement distincte : « pas encore regardé » plutôt que « regardé et rien trouvé ». Absente de la production au 2026-07-24 (0 collection servie porte cette valeur), mais l'enum doit être gérée par tout consommateur strict. |

`legacy-traceable` et `candidate` sont les deux pièges d'affichage à éviter :
les deux peuvent porter (rarement pour `candidate`, souvent pour
`legacy-traceable`) une URL réelle et cliquable, ce qui peut donner
l'impression trompeuse d'une preuve solide. Le champ `zone_source_level`
doit **toujours** être affiché à côté de l'URL, jamais l'URL seule.

## 3. Distinction des trois axes — rappel impératif

`zone_source_url` / `zone_source_level` décrivent **uniquement la
provenance de la géométrie de zone**. Ils sont strictement indépendants des
deux autres axes déjà présents dans les payloads Immo :

| Champ | Axe | Question | Ne prouve pas |
|---|---|---|---|
| `zone_source_url` / `zone_source_level` | provenance de **géométrie** de zone | « D'où vient le polygone de cette zone ? » | le règlement applicable, ni la jointure lot→zone |
| `reglement_url` (+ `reglement_numero`, `reglement_millesime`) | provenance **réglementaire** | « Quel règlement de zonage documente cette zone ? » | l'origine des octets géométriques |
| `assignment_method` (côté `qc-lots`, contrat 20260722 §3 `lot_assignment_evidence`) | preuve de **jointure** lot↔zone | « Pourquoi ce lot est-il rattaché à cette zone ? » | l'origine de la géométrie de la zone ciblée |

Une même municipalité peut légitimement avoir une provenance réglementaire
forte (`reglement_url` renseignée, règlement identifié et daté) et une
provenance de géométrie faible (`zone_source_level: "orphan"`,
`zone_source_url: null`) — ce sont deux mesures indépendantes. Voir
l'exemple Chelsea en section 4.3 : ne jamais copier une URL de règlement
dans `zone_source_url`, et ne jamais déduire `zone_source_level` d'après la
qualité de la provenance réglementaire.

## 4. Comment Immo doit afficher ces champs

1. **Toujours afficher `zone_source_level` à côté de l'URL**, jamais l'URL
   seule. L'URL sans le niveau invite à la sur-confiance.
2. **`zone_source_url` non nul → lien cliquable**, avec le niveau affiché en
   badge/texte adjacent (ex. « Source : legacy-traceable » à côté du lien).
3. **NE PAS présenter `legacy-traceable` ou `candidate` comme une source
   vérifiée.** Réserver tout libellé du type « source vérifiée » /
   « certifiée » à `historical-verified` uniquement.
4. **NE PAS masquer une zone parce que `zone_source_level === "orphan"`** (ou
   `unknown`). Afficher honnêtement le niveau (ex. « provenance de géométrie
   non retracée ») ; ne jamais retirer le polygone, son `zone_code`, ses
   normes ou son rattachement lot pour cette seule raison. C'est la même
   politique de non-blackout que le contrat 20260722 §6 impose déjà pour
   l'enveloppe `immo_zone_lot_provenance` — elle s'applique identiquement
   ici.
5. Un `zone_source_url === null` **ne doit jamais être remplacé** par une
   valeur déduite (ex. le site web de la municipalité, l'URL du règlement,
   ou une recherche approximative) : c'est un `null` honnête, à afficher tel
   quel (ex. « source non conservée »).

## 5. État réel du déploiement (audit readback 2026-07-24)

Source : `work/coverage/zone-source-readback-audit-20260724.json`
(`_zone-source-readback-audit.ts`, lecture directe des objets S3 servis,
indépendante des logs de run).

- **871** collections `qc-zonage` servies au total.
- **870 / 871** portent les deux propriétés (`zone_source_url`,
  `zone_source_level`) sur l'échantillon de features lu.
- **529** portent une `zone_source_url` réelle non nulle (« STAMPED »).
- **341** portent les deux propriétés avec `zone_source_url: null` de façon
  honnête (« STAMPED_NULL »).
- **1** collection (`les-cedres`) n'a pas reçu le stamp : sa collection
  servie est vide (0 feature) — rien à stamper, pas un échec de dépôt.
- **0** erreur de lecture (`read_error`).

## 6. Exemples JSON

Les trois exemples ci-dessous sont construits à partir de collections
réellement servies (pas de données inventées), pour montrer les trois cas
les plus utiles à Immo : un `legacy-traceable` avec URL réelle, un
`candidate` (où `zone_source_url` est `null` dans l'écrasante majorité des
cas servis aujourd'hui), et un `orphan`.

### 6.1 `legacy-traceable` — trace historique avec URL de service SIG réelle

Collection `qc-zonage-chazel` (18 features servies).

```json
{
  "type": "Feature",
  "properties": {
    "zone_code": "...",
    "code_zone": "...",
    "zone_source_url": "https://www.goazimut.com/gis109-14/arcgis/rest/services/870_AbitibiOuest/87095_Chazel/MapServer/157",
    "zone_source_level": "legacy-traceable"
  },
  "geometry": { "type": "Polygon", "coordinates": ["..."] }
}
```

Affichage attendu : lien cliquable vers l'URL ArcGIS, avec un badge
« lignée historique — pas une vérification courante », jamais « source
vérifiée ».

### 6.2 `candidate` — source officielle établie, filiation non prouvée

Collection `qc-zonage-armagh` (61 features servies).

```json
{
  "type": "Feature",
  "properties": {
    "zone_code": "...",
    "code_zone": "...",
    "zone_source_url": null,
    "zone_source_level": "candidate"
  },
  "geometry": { "type": "Polygon", "coordinates": ["..."] }
}
```

Affichage attendu : pas de lien (URL nulle) ; badge « source candidate — non
confirmée » uniquement. Ne jamais afficher ce cas comme une source
vérifiée, même si une piste de source est connue en coulisse.

### 6.3 `orphan` — pas de source retenue ; le lot et la zone restent servis

Collection `qc-zonage-chelsea` (164 features servies).

```json
{
  "type": "Feature",
  "properties": {
    "zone_code": "...",
    "code_zone": "...",
    "zone_source_url": null,
    "zone_source_level": "orphan"
  },
  "geometry": { "type": "Polygon", "coordinates": ["..."] }
}
```

**Note pédagogique (axe réglementaire vs axe géométrie) :** Chelsea illustre
exactement pourquoi les deux axes sont séparés (section 3). Le règlement de
zonage de Chelsea est bien identifié — `1215-22 — Annexe 2`, disponible à
`https://www.chelsea.ca/download_file/view/8284/279` (source :
`work/coverage/normes-provenance.json`) — et sert la grille de normes avec
une provenance forte. Mais cette URL est une **provenance réglementaire**
(`reglement_url`), pas une **provenance de géométrie de zone**. La
géométrie de zone de Chelsea reste `zone_source_level: "orphan"` /
`zone_source_url: null` : aucune source SIG/plan n'a été retenue pour les
polygones eux-mêmes. Ne jamais copier une URL de règlement dans
`zone_source_url` sous prétexte que la municipalité a « une bonne
provenance » par ailleurs.

## 7. Compatibilité et non-régression

- Additif uniquement : aucune propriété existante (`zone_code`, `code_zone`,
  `proof`, `assignment_method`, `reglement_*`, normes dérivées) n'est
  renommée, retirée ou réinterprétée par ce dépôt.
- Un consommateur qui ignore `zone_source_url` / `zone_source_level`
  continue de fonctionner sans changement.
- L'écriture qui pose ces deux champs est *readback-verified* : chaque
  écriture relit l'objet servi et vérifie la présence exacte des valeurs
  avant de considérer la collection comme stampée (voir
  `fold-zone-source-provenance-to-zonage.ts`, `verifyPatchedFeatures`).
- Politique de non-blackout identique au contrat 20260722 §6 : `orphan`,
  `unknown` ou `candidate` ne doivent jamais faire disparaître ou masquer un
  lot, une zone, ses normes ou son rattachement déjà servi.

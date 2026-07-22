# SPEC — Global Evidence Release v1: lots, zones, normes et rattachements

**Statut : NORMATIF — GO design, NO-GO publication jusqu'à l'acceptation §12.**  
**Décision :** les données géographiques visibles par Immo forment une *release de preuve* unique et immuable. Une écriture objet par objet dans `normalized/` n'est jamais une publication.  
**Portée :** toutes les collections géographiques servies au tenant Immo, sans exception de municipalité, de code de zone, de lot, de norme ou de tuile.

## 1. Problème et règle de non-ambiguïté

Les produits actuels peuvent être mis à jour indépendamment : le zonage, les lots enrichis, les normes et leurs sidecars ne partagent ni identifiant de release, ni manifeste, ni activation atomique. Une donnée peut alors être servie entre deux écritures, ou dériver d'un objet zonage différent de celui que voit Immo.

**Règle V1 :** Immo ne peut présenter une zone, un rattachement lot→zone ou une norme comme actuelle/autoritative que si la feature retournée est cryptographiquement liée à une release active validée et à une preuve immuable. L'absence de preuve est une donnée visible, jamais une autorisation implicite.

Les anciens champs (`source`, `confidence`, `_source_url`, `_reglement`, `reglement_*`, `_snapshot`) restent descriptifs et rétrocompatibles ; ils **ne sont pas** une preuve V1.

## 2. Univers fermé de la release

La release contient la fermeture de toutes les dépendances visibles :

| Objet visible | Preuve minimale obligatoire |
|---|---|
| `qc-lots-*` | source cadastrale, géométrie source, hash de source, transformations ; release zone exacte et résultat de l'affectation ; preuve de chaque norme non nulle pliée sur le lot |
| `qc-zonage-*` | couche/document géométrique exact, identifiant de feature/planche, hash/version, licence, transformation/contrôle qualité ; règlement et état d'effet associés au `zone_code` |
| normes réglementaires | artefact brut, hash, page/cellule/span, méthode d'extraction, statut d'effet et confiance ; aucune valeur non nulle sans preuve de champ |
| affectation lot→zone | `lot_feature_id`, `zone_feature_id`, release de zone, algorithme/version/paramètres, métriques de recouvrement et résultat |
| PMTiles ou autre représentation cartographique servie | release source, hash, couche et transformation de génération ; une tuile brute cadastre ne peut pas prétendre représenter les lots enrichis |

Une collection de backup, prépublication, `__pre`, ou autre alias est hors catalogue public, ou elle doit satisfaire exactement le même contrat. Elle ne peut jamais contourner V1.

## 3. Contrat embarqué par feature

Chaque feature retournée dans une collection V1 contient ce bloc additif, stable et sérialisé canoniquement :

```json
{
  "evidence_version": 1,
  "release_id": "sha256:<manifest-canonical-sha256>",
  "feature_id": "identifiant stable de cette feature",
  "feature_digest": "sha256:<feature-canonical-sha256>",
  "evidence_status": "verified | unavailable | rejected",
  "evidence_ref": "sha256:<evidence-ledger-entry-canonical-sha256>"
}
```

Contraintes :

1. `release_id`, `feature_id`, `feature_digest`, `evidence_status` et `evidence_ref` sont **toujours présents** ; `evidence_ref` pointe aussi une entrée explicite pour `unavailable` ou `rejected`.
2. Le digest porte la feature canonique, hors le bloc de liaison auto-référent, selon l'algorithme défini par l'implémentation de référence et testé par golden.
3. Une feature ne peut pas référencer une entrée d'une autre release.
4. Une feature `verified` doit avoir une chaîne de preuves complète au ledger ; `unavailable` et `rejected` ne sont pas promus en statut d'usage/règlement courant par Immo.
5. `feature_id` est stable à travers les releases quand l'objet métier est le même ; une géométrie changée produit un nouveau digest, pas une identité inventée.

Le bloc embarqué est indispensable au consommateur. Le détail est hors ligne dans le ledger afin de ne pas répéter des PDF, GCP ou métadonnées volumineuses dans chaque feature.

## 4. Ledger de preuves, immuable et dédupliqué

Chaque release embarque un ledger contenu-adressé. Les objets lourds sont dédupliqués et référencés par SHA-256. Les entrées doivent permettre de remonter de chaque propriété visible à la source brute et à la transformation.

```text
releases/<release-id>/
  manifest.json
  validation.json
  evidence/ledger.jsonl
  evidence/blobs/sha256/<digest>
  data/normalized/...
```

Le ledger porte au minimum :

- identité, URL/couche/document source et licence ; hash et date/version observée ;
- géométrie source : ID de feature ou page/planche, CRS, méthode (`native-vector`, `georeferenced-document`, `derived`), paramètres et résultat de qualité ;
- règlement : numéro, texte/version, date d'effet, amendements connus et statut ;
- norme : champ cible, artefact, page/cellule/span, extraction, validation et confiance ;
- affectation : digests des inputs lot/zone, algorithme et paramètres, fractions/ambiguïtés, digest du résultat ;
- producteurs : version de code/configuration, hashes des inputs et rapport de validation.

Un règlement au niveau municipal ne prouve pas à lui seul le contour ou le code d'une feature zone. Un `source` textuel, une URL mutable ou une date de dépôt ne suffit pas non plus.

## 5. États de preuve et comportement Immo

| État | Sens | Comportement obligatoire d'Immo |
|---|---|---|
| `verified` | chaîne complète et validée | peut afficher comme donnée source ; liens de preuve disponibles |
| `unavailable` | absence de preuve explicitée | affiche l'absence ; ne qualifie pas le zonage/norme de courant ou officiel |
| `rejected` | source ou dérivation invalidée | ne l'emploie pas pour une décision ; exposition de l'explication de rejet |

V1 interdit les états flatteurs mais non définis (`partial`, `documented`, `likely`) pour une donnée servie comme autoritative. Ils peuvent exister dans l'acquisition de travail, jamais à la place de ces trois états publiés.

## 6. Release candidate immuable

Un producteur écrit uniquement sous un préfixe de candidate, jamais dans la surface publique :

```text
registry/releases/<release-id>/data/normalized/...
```

`manifest.json` liste exhaustivement, dans un ordre canonique :

```json
{
  "schema": "geo-evidence-release/v1",
  "release_id": "sha256:...",
  "producer_revision": "<git commit>",
  "objects": [{
    "logical_key": "qc-lots/qc-lots-<slug>.geojson",
    "physical_key": "data/normalized/qc-lots/qc-lots-<slug>.geojson",
    "sha256": "sha256:...",
    "bytes": 123,
    "content_type": "application/geo+json"
  }],
  "catalog": ["collections explicitement exposées"],
  "evidence_ledger_sha256": "sha256:...",
  "validation_sha256": "sha256:..."
}
```

Après écriture, une candidate est immuable. Toute correction crée une nouvelle candidate et un nouveau manifeste. Les répertoires plats/sous-répertoires concurrents sont interdits : une clé logique a exactement une forme canonique dans le manifeste.

## 7. Validation fail-closed de fermeture

`validation.json` est produit avant activation et doit être `passed`. Tout autre statut interdit l'activation.

Contrôles obligatoires, sur **100 %** des objets catalogués :

1. manifeste, ledger, GeoJSON et tuiles valides ; bytes et SHA-256 conformes ;
2. collection fermée : aucune feature sans bloc V1, aucune référence pendante, aucun digest ou ID dupliqué de façon incohérente ;
3. même `release_id` dans chaque feature, ledger et réponse API ;
4. lots : chaque `zone_code` non nul est résolu dans la **même release** et le résultat d'affectation est vérifié contre les digests annoncés ;
5. normes : chaque valeur non nulle a une preuve de champ ;
6. zones : chaque `zone_code` servie a une preuve de géométrie et de statut réglementaire ;
7. PMTiles/exports : chaque représentation publique est attachée au même manifeste ;
8. aucune collection/alias public hors manifeste ;
9. régression de couverture, divergence de millésime, conflit de règlement ou source rejetée : échec sauf exception explicitement approuvée et encodée au ledger comme `unavailable`/`rejected`, jamais silencieuse ;
10. résolution API de toutes les collections du catalogue contre la candidate, y compris pagination et cache, renvoie le `release_id` attendu.

L'ancien contrôle de fraîcheur par `mtime` est une aide de diagnostic et n'est pas une validation d'intégrité de dépendances.

## 8. Activation atomique et lecture API

Une seule opération rend une candidate active : compare-and-swap (ETag/version) d'un pointeur unique :

```text
registry/served/current.json
```

```json
{
  "schema": "geo-evidence-current/v1",
  "release_id": "sha256:<manifest hash>",
  "prefix": "registry/releases/<release-id>/data/normalized",
  "manifest_sha256": "sha256:...",
  "validation_sha256": "sha256:...",
  "previous_release_id": "sha256:..."
}
```

L'API ne résout **que** ce pointeur, charge le manifeste validé et refuse de servir une release sans `validation.status === "passed"`. Elle renvoie `release_id` dans les réponses et inclut ce même ID dans les clés de cache. Immo refuse de joindre dans une même vue des objets de releases différentes.

Une copie séquentielle vers `normalized/`, le redémarrage d'un pod, un backup local ou le changement séparé de plusieurs URLs ne satisfont pas cette exigence.

## 9. Rollback et concurrence

Le rollback est un CAS du pointeur vers le manifeste validé antérieur, retenu immuablement. Il ne réécrit pas les GeoJSON. Les activations concurrentes échouent plutôt que d'écraser une activation inconnue ; la nouvelle candidate doit alors être revalidée sur le parent actif.

Une politique de rétention garde les releases activées et leurs preuves pour la durée de conservation réglementaire définie par le produit. La suppression n'est possible qu'après vérification qu'aucun pointeur de rollback ou client versionné ne la référence.

## 10. Migration sans état mixte

1. Construire l'implémentation de release et le support de résolution dans le dépôt/image de `geo-api` propriétaire.
2. Construire une candidate exhaustive depuis les données actuellement publiques, avec état explicite pour chaque feature.
3. Exécuter validation §7 et l'acceptation §12 ; aucun producteur ne peut écrire l'espace servi pendant la fenêtre.
4. Déployer l'API capable de résoudre le pointeur **sans l'activer** ; son healthcheck teste le manifeste candidat.
5. Activer par CAS unique ; contrôler les réponses API et Immo pour un unique `release_id`.
6. Retirer l'exposition des anciens préfixes/aliases publics. Les writers historiques passent en mode candidate-only avant toute nouvelle acquisition.

Si une API compatible n'est pas disponible, le résultat est **NO-GO**. Une fenêtre de maintenance avec copie séquentielle est éventuellement un contournement d'exploitation, mais ne peut pas être annoncée comme V1 atomique.

## 11. Limites de responsabilité

Cette spécification exige que les données disponibles soient solidement attachées ; elle ne fabrique pas une source primaire inexistante. Le statut `unavailable` rend ce manque visible à l'intégralité des consommateurs. La candidate n'est activable que si le produit accepte explicitement de servir cet état pour chaque objet concerné ; elle ne peut masquer la lacune derrière un champ nul ou un règlement municipal global.

Le code d'Immo doit afficher le statut, le lien de ledger et les preuves accessibles. La présence du bloc V1 sans cette surface produit est une intégration incomplète, donc un échec §12.

## 12. Double consensus contradictoire et gate de déploiement

La spécification est déployable seulement après deux validations indépendantes et consignées, avec objections résolues :

- **consensus acquisition/intégrité** : preuve par feature, algorithmes de digest, fermeture des dépendances, règles de rejet ;
- **consensus opérations/consommation** : API/pointeur/CAS, cache/rollback, catalogue public, comportement Immo et observabilité.

Les deux signataires doivent confirmer explicitement :

- aucune écriture directe dans la surface servie ;
- aucune collection publique sans bloc V1 ;
- test de candidate exhaustif 100 % passé ;
- activation et rollback CAS démontrés ;
- Immo expose les trois états et refuse les joins inter-release ;
- PMTiles et tout export visible sont inclus ou retirés du périmètre public ;
- plan de rollback exécuté en répétition.

**GO final :** deux validations sans objection bloquante + validation automatique `passed` + propriétaire de l'API ayant déployé le résolveur de pointeur.  
**NO-GO automatique :** objet mutable présenté comme preuve, upload séquentiel présenté comme atomicité, sidecar non lié à la feature, collection legacy visible hors manifeste, ou lien lot/zone/norme entre releases différentes.

## 13. Décisions de cette évolution

- Cette évolution est **une seule évolution de contrat** : son activation n'admet aucun mélange de V0 et V1 dans le catalogue Immo.
- Elle est **globale** : un lot, une zone, une norme ou une tuile sans preuve n'est pas exclu silencieusement ; il porte `unavailable` ou `rejected` et la raison immuable correspondante.
- Elle est **fail-closed** : les améliorations de provenance, re-folds et correctifs de zone sont des entrées d'une nouvelle candidate, jamais des mutations du produit servi.

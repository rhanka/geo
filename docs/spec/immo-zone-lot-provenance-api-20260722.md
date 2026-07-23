# Contrat Immo — évidence lot→zone et provenance de géométrie (recovery r2)

**Statut :** proposition normative additive v1.
**Date :** 2026-07-22.
**Producteur :** geo. **Consommateur :** immo.

## 1. Objet et règle fondamentale

Ce contrat ajoute une enveloppe d'explicabilité aux payloads Immo qui relient un
lot à une zone. Il sépare **trois axes indépendants** :

| Axe | Question à laquelle il répond | Ne prouve pas |
|---|---|---|
| `lot_assignment_evidence` | « Pourquoi ce lot a-t-il ce rattachement de zone enregistré ? » | l'origine des polygones de zone |
| `zone_geometry_provenance` | « Quelle est la traçabilité de la géométrie de cette zone ? » | que le lot appartient à cette zone |
| `acquisition_v2_readiness` | « Le dossier est-il complet pour une acquisition v2 vérifiable ? » | la validité historique, réglementaire ou spatiale du rattachement |

Une URL de règlement est une provenance réglementaire : elle ne peut jamais
remplir `zone_geometry_provenance.public_source`. De même, un code de zone,
une clé de collection ou une méthode de jointure ne constituent jamais à eux
seuls une source de géométrie.

Les mots **DOIT**, **NE DOIT PAS** et **PEUT** sont normatifs.

## 2. Position du payload et compatibilité

L'ajout se fait dans les propriétés du feature lot (ou dans le DTO Immo qui en
est la projection) :

```json
{
  "properties": {
    "zone_code": "H-12",
    "code_zone": "H-12",
    "assignment_method": "area-majority",
    "immo_zone_lot_provenance": { "contract": "immo-zone-lot-provenance/v1" }
  }
}
```

`immo_zone_lot_provenance` est **optionnel**. Son absence signifie seulement
« producteur antérieur ou dossier non évalué »; elle ne signifie jamais
`orphan`. Lorsqu'elle est présente, ses trois axes sont présents; un axe peut
valoir `null` seulement s'il est inapplicable et qu'un code de raison le rend
explicite.

Ce contrat est strictement additif : il ne renomme, ne reformate et ne
réinterprète pas `zone_code`, `code_zone`, `zone_codes`,
`dominant_fraction`, `multi_zone`, `assignment_method`, `norms` ni
`properties.proof`. Les consommateurs v1 qui ignorent la nouvelle propriété
continuent donc de fonctionner.

## 3. Forme canonique v1

```ts
type GeometryProvenanceStatus =
  | 'historical-verified'
  | 'legacy-traceable'
  | 'candidate-needs-human-confirmation'
  | 'orphan';

type ImmoZoneLotProvenanceV1 = {
  contract: 'immo-zone-lot-provenance/v1';
  assessed_at: string; // ISO-8601 UTC

  lot_assignment_evidence: {
    state: 'recorded' | 'unassigned' | 'not-assessed';
    selected_zone: {
      collection: string;     // e.g. qc-zonage-example
      feature_ref: string | null; // stable public ref; never a raw S3 key
      code: string;
    } | null;
    assignment_method:
      | 'area-majority'
      | 'centroid-fallback'
      | 'legacy-import'
      | 'unassigned'
      | 'unknown'
      | null;
    dominant_fraction: number | null; // [0, 1]
    multi_zone: boolean | null;
    zone_codes: string[] | null;      // known empty is [], unavailable is null
    evidence_snapshot: string | null; // public-safe snapshot identifier/date
    evidence_id: string | null;       // opaque public-safe identifier
    reason_codes: string[];
  };

  zone_geometry_provenance: {
    // These four statuses apply ONLY to the zone geometry provenance.
    status: GeometryProvenanceStatus;
    zone: {
      collection: string;
      feature_ref: string | null;
      code: string | null;
    } | null;
    public_source: {
      url: string; // canonical public HTTP(S) URL, no credentials/query/fragment
      type: 'geonet' | 'arcgis' | 'agol' | 'wfs' | 'jmap'
        | 'pdf-zonage' | 'geojson-officiel' | 'other-official';
      method: 'natif' | 'georeference';
      retrieved_at: string | null; // ISO-8601 UTC
      sha256: string | null;       // sha256:<lowercase-hex>
    } | null;
    verified_at: string | null;    // required for historical-verified
    evidence_id: string | null;
    reason_codes: string[];
  } | null;

  acquisition_v2_readiness: {
    state: 'ready' | 'not-ready' | 'not-assessed';
    checked_at: string | null; // ISO-8601 UTC
    unmet_requirement_codes: string[];
  };
};
```

Sur un lot dont le rattachement est `recorded`,
`lot_assignment_evidence.selected_zone` DOIT porter une `collection` et un
`code`; `feature_ref` demeure `null` s'il n'existe pas de référence stable et
non ambiguë. Sur un rattachement `unassigned` ou `not-assessed`,
`selected_zone` et `assignment_method` DOIVENT être `null` ou
`unassigned` selon l'état, sans remplacement par une zone voisine. Un code de
zone n'est pas une référence de feature : il peut être dupliqué dans une
collection.

`zone_geometry_provenance`, lorsqu'il est non nul, concerne la géométrie de la
zone visée par `selected_zone`. Elle peut être `null` quand aucun rattachement
n'est enregistré; `lot_assignment_evidence.reason_codes` doit alors contenir
par exemple `no-selected-zone`.

## 4. Sémantique des statuts de provenance

Le champ `zone_geometry_provenance.status` utilise **exactement** les valeurs
suivantes. Elles ne sont ni un score de confiance du lot, ni un statut de
publication, ni un statut réglementaire.

| Statut | Sens minimal | Contraintes |
|---|---|---|
| `historical-verified` | Une relation de provenance historique de la géométrie a été vérifiée contre une évidence identifiable. | `verified_at` et `evidence_id` sont non nuls. Cela ne prouve ni des octets actuels ni la complétude v2. |
| `legacy-traceable` | Une chaîne de trace legacy est connue et ré-identifiable, sans vérification historique suffisante. | Elle peut coexister avec une acquisition v2 prête réalisée ultérieurement. |
| `candidate-needs-human-confirmation` | Une piste de source ou de relation existe mais n'est pas confirmée par une revue humaine. | Aucune promotion automatique n'est autorisée. `public_source` est `null` sauf source officiellement validée comme divulguable sans l'affirmer comme preuve. |
| `orphan` | La provenance de géométrie attendue est rompue ou introuvable pour la zone référencée. | `reason_codes` est non vide et décrit la rupture, par exemple `source-identity-unlinked`; le rattachement lot déjà enregistré reste intact. |

Un statut `orphan` ne rend donc pas le lot orphelin. Il décrit uniquement une
lacune de la **provenance de géométrie de zone**. Inversement, une géométrie
`historical-verified` ne confirme pas la méthode, l'overlap ou le code du
rattachement du lot.

## 5. Préparation Acquisition v2 : un axe séparé

`acquisition_v2_readiness` est indépendant des quatre statuts ci-dessus. Il
mesure seulement si l'élément peut entrer dans le flux Acquisition v2, sans
refetch, publication, déploiement ou autre effet de bord au moment de produire
ce payload.

`state: "ready"` exige un contrôle explicite et une valeur non nulle pour :

1. l'identité de la zone (`collection` et référence stable quand disponible);
2. une source géométrique publique canonique;
3. son instant d'acquisition; et
4. son hash de contenu `sha256`.

Tout autre cas est `not-ready` avec une ou plusieurs valeurs stables parmi :
`missing-zone-identity`, `missing-canonical-public-source`,
`missing-retrieved-at`, `missing-content-sha256`,
`needs-human-confirmation`, `source-identity-unlinked`,
`not-assessed`. `ready` exige `unmet_requirement_codes: []`. L'état
`not-assessed` est réservé à une vérification v2 qui n'a pas encore été faite.

Il est interdit de déduire `ready` depuis `historical-verified`, ou
`not-ready` depuis `legacy-traceable`; une ancienne trace vérifiée et une
acquisition v2 complète répondent à des questions différentes.

## 6. Politique de non-blackout

Cette interface de récupération ne met aucune donnée Immo existante hors
service. En particulier, `candidate-needs-human-confirmation`, `orphan` ou une
préparation v2 `not-ready` **NE DOIVENT PAS** :

- retirer ou mettre à `null` un `zone_code` / `code_zone` déjà servi;
- supprimer un lot ou une zone de la réponse, ni cacher ses normes dérivées;
- modifier la méthode de rattachement, les fractions, `zone_codes` ou
  `properties.proof` existants;
- déclencher un rebuild, une écriture S3, un refetch ou un déploiement.

Le producteur ajoute une description de lacune, il ne corrige pas silencieusement
la donnée historique. Un consommateur PEUT exiger `acquisition_v2_readiness`
`ready` pour une action à haute assurance, mais ne PEUT pas utiliser ce contrat
comme règle de suppression ou de déréférencement. Si une règle de catalogue
antérieure interprète l'absence de preuve v2 comme une exclusion, le présent
contrat gouverne la projection Immo : la métadonnée de provenance est un
avertissement additif, jamais un blackout.

## 7. Champs sûrs à exposer

Les seuls champs publics autorisés par ce contrat sont les enums, dates ISO,
identifiants opaques, identifiants normalisés lot/zone, collection, code de
zone, métriques de rattachement, codes de raison, hash SHA-256 et URL HTTP(S)
canonique publiquement accessible. Une URL doit être dépourvue de credentials,
de query string et de fragment.

Ne sont jamais exposés : URI/clé S3, chemin local, identifiant de job ou de
run interne, log ou erreur brute, en-tête HTTP, adresse IP, token, URL signée,
credential, donnée personnelle, ni une piste de source candidate présentée
comme source autoritative. Une information indisponible est `null` avec un
`reason_code`; elle n'est pas remplacée par une valeur déduite.

## 8. Exemples JSON

Les exemples suivants montrent volontairement que le rattachement, le statut
de géométrie et l'état v2 ne se propagent pas l'un à l'autre.

### Historique vérifié, mais v2 non prêt

```json
{
  "contract": "immo-zone-lot-provenance/v1",
  "assessed_at": "2026-07-22T14:00:00Z",
  "lot_assignment_evidence": {
    "state": "recorded",
    "selected_zone": {
      "collection": "qc-zonage-exemple",
      "feature_ref": "qc-zonage-exemple#feature=H-12-001",
      "code": "H-12"
    },
    "assignment_method": "area-majority",
    "dominant_fraction": 0.94,
    "multi_zone": false,
    "zone_codes": ["H-12"],
    "evidence_snapshot": "2026-06-21",
    "evidence_id": "lot-zone-ev-7d21",
    "reason_codes": []
  },
  "zone_geometry_provenance": {
    "status": "historical-verified",
    "zone": {
      "collection": "qc-zonage-exemple",
      "feature_ref": "qc-zonage-exemple#feature=H-12-001",
      "code": "H-12"
    },
    "public_source": {
      "url": "https://donnees.example.org/zonage.geojson",
      "type": "geojson-officiel",
      "method": "natif",
      "retrieved_at": "2026-06-21T09:00:00Z",
      "sha256": null
    },
    "verified_at": "2026-07-22T13:50:00Z",
    "evidence_id": "geom-ev-a02e",
    "reason_codes": []
  },
  "acquisition_v2_readiness": {
    "state": "not-ready",
    "checked_at": "2026-07-22T14:00:00Z",
    "unmet_requirement_codes": ["missing-content-sha256"]
  }
}
```

### Trace legacy, acquisition v2 maintenant prête

```json
{
  "contract": "immo-zone-lot-provenance/v1",
  "assessed_at": "2026-07-22T14:00:00Z",
  "lot_assignment_evidence": {
    "state": "recorded",
    "selected_zone": {
      "collection": "qc-zonage-exemple",
      "feature_ref": null,
      "code": "R-4"
    },
    "assignment_method": "centroid-fallback",
    "dominant_fraction": null,
    "multi_zone": null,
    "zone_codes": ["R-4"],
    "evidence_snapshot": "2026-06-21",
    "evidence_id": "lot-zone-ev-99ba",
    "reason_codes": ["area-calculation-unavailable"]
  },
  "zone_geometry_provenance": {
    "status": "legacy-traceable",
    "zone": {
      "collection": "qc-zonage-exemple",
      "feature_ref": null,
      "code": "R-4"
    },
    "public_source": {
      "url": "https://carto.example.org/arcgis/rest/services/zonage/FeatureServer/0",
      "type": "arcgis",
      "method": "natif",
      "retrieved_at": "2026-07-22T11:30:00Z",
      "sha256": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    },
    "verified_at": null,
    "evidence_id": "legacy-geom-44c1",
    "reason_codes": ["historical-verification-unavailable"]
  },
  "acquisition_v2_readiness": {
    "state": "ready",
    "checked_at": "2026-07-22T14:00:00Z",
    "unmet_requirement_codes": []
  }
}
```

### Candidat de géométrie : le rattachement enregistré demeure exposé

```json
{
  "contract": "immo-zone-lot-provenance/v1",
  "assessed_at": "2026-07-22T14:00:00Z",
  "lot_assignment_evidence": {
    "state": "recorded",
    "selected_zone": {
      "collection": "qc-zonage-exemple",
      "feature_ref": "qc-zonage-exemple#feature=C-2-004",
      "code": "C-2"
    },
    "assignment_method": "area-majority",
    "dominant_fraction": 0.61,
    "multi_zone": true,
    "zone_codes": ["C-2", "C-3"],
    "evidence_snapshot": "2026-06-21",
    "evidence_id": "lot-zone-ev-10b4",
    "reason_codes": []
  },
  "zone_geometry_provenance": {
    "status": "candidate-needs-human-confirmation",
    "zone": {
      "collection": "qc-zonage-exemple",
      "feature_ref": "qc-zonage-exemple#feature=C-2-004",
      "code": "C-2"
    },
    "public_source": null,
    "verified_at": null,
    "evidence_id": "candidate-geom-0fe3",
    "reason_codes": ["needs-human-confirmation"]
  },
  "acquisition_v2_readiness": {
    "state": "not-ready",
    "checked_at": "2026-07-22T14:00:00Z",
    "unmet_requirement_codes": ["needs-human-confirmation", "missing-canonical-public-source"]
  }
}
```

### Provenance orpheline : ce n'est pas un effacement du rattachement lot

```json
{
  "contract": "immo-zone-lot-provenance/v1",
  "assessed_at": "2026-07-22T14:00:00Z",
  "lot_assignment_evidence": {
    "state": "recorded",
    "selected_zone": {
      "collection": "qc-zonage-exemple",
      "feature_ref": null,
      "code": "A-7"
    },
    "assignment_method": "legacy-import",
    "dominant_fraction": null,
    "multi_zone": null,
    "zone_codes": ["A-7"],
    "evidence_snapshot": "2026-06-21",
    "evidence_id": "lot-zone-ev-557a",
    "reason_codes": ["legacy-assignment-record"]
  },
  "zone_geometry_provenance": {
    "status": "orphan",
    "zone": {
      "collection": "qc-zonage-exemple",
      "feature_ref": null,
      "code": "A-7"
    },
    "public_source": null,
    "verified_at": null,
    "evidence_id": null,
    "reason_codes": ["source-identity-unlinked"]
  },
  "acquisition_v2_readiness": {
    "state": "not-ready",
    "checked_at": "2026-07-22T14:00:00Z",
    "unmet_requirement_codes": ["source-identity-unlinked", "missing-canonical-public-source"]
  }
}
```

## 9. Critères d'acceptation

Le contrat est accepté lorsque les assertions suivantes sont vérifiées par les
fixtures du producteur et du consommateur :

1. Les enums et les contraintes de nullité de la section 3 sont validés; toute
   autre valeur de statut, de méthode ou de préparation v2 est rejetée.
2. Les quatre statuts de provenance sont couverts. Au moins un fixture montre
   un rattachement `recorded` avec chacun d'eux, dont `orphan`; aucun statut de
   provenance ne modifie le rattachement enregistré.
3. Un fixture démontre indépendamment `historical-verified` + `not-ready` et
   `legacy-traceable` + `ready`.
4. En retirant uniquement `immo_zone_lot_provenance` d'une réponse enrichie,
   la projection de toutes les propriétés préexistantes est identique au
   baseline : mêmes clés, valeurs, nulls et tableaux.
5. Les fixtures `candidate-needs-human-confirmation`, `orphan` et `not-ready`
   continuent de servir lot, `zone_code`/`code_zone`, métadonnées de jointure,
   `proof` et normes existantes. Aucun filtre de réponse n'est activé.
6. Une validation d'allowlist refuse clés S3, chemins locaux, URL signées ou
   contenant query/fragment/credentials, secrets, logs et identifiants de jobs;
   les URL exposées sont HTTP(S) publiques et canoniques.
7. La vérification est purement contractuelle et par fixtures : elle n'exige
   ni refetch, ni écriture S3, ni déploiement, ni modification des collections
   existantes.

## 10. Déploiement progressif sans rupture

1. Les producteurs peuvent d'abord laisser l'enveloppe absente; les
   consommateurs la traitent comme « non évaluée » sans modifier leur logique
   actuelle.
2. La récupération ajoute ensuite les trois axes, avec `not-ready` et des
   codes de raison honnêtes lorsque v2 est incomplet.
3. Une préparation v2 ultérieure ne met à jour que
   `acquisition_v2_readiness` et les champs de provenance explicitement
   vérifiés. Elle ne réécrit pas le rattachement lot→zone enregistré sans une
   opération de jointure distincte et traçable.

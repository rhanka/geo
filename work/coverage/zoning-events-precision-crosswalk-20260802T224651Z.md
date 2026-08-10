# Analyse de précision qc-zoning-events vs DesignationEvents immo

Mesure read-only dérivée de la partition fermée matched/missed/extra du recall gate. Elle ne modifie ni le gate de rappel ni la spine.

Précision naïve agrégée : 0.0027 (2 matched / 750 events geo). C’est une borne basse descriptive : les extras sont ventilés ci-dessous, sans les déclarer faux positifs.

| Ville | Matched | Extra | Précision naïve | residual_taxonomy | shared_doc_immo_undercount | geo_only_doc | État |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| aggregate | 2 | 748 | 0.0027 | 748 | 0 | 0 | measured |
| saint-raymond | 0 | 40 | 0.0000 | 40 | 0 | 0 | measured |
| saint-stanislas | 0 | 0 | unknown (no_geo_events) | 0 | 0 | 0 | no_geo_events |
| sutton | 0 | 8 | 0.0000 | 8 | 0 | 0 | measured |
| coaticook | 2 | 14 | 0.1250 | 14 | 0 | 0 | measured |
| saint-mathieu-de-beloeil | 0 | 68 | 0.0000 | 68 | 0 | 0 | measured |
| saint-eustache | 0 | 618 | 0.0000 | 618 | 0 | 0 | measured |

## Ventilation fermée des extras geo-only

- residual_taxonomy : Même (muni, source_url_norm, date_iso) qu’un DesignationEvent immo, mais type différent: résidu de crosswalk à vérifier.
- shared_doc_immo_undercount : Même (muni, source_url_norm) qu’au moins un DesignationEvent immo, sans le signal de type divergent ci-dessus: sous-comptage immo ou sur-split geo à qualifier.
- geo_only_doc : Aucun (muni, source_url_norm) normalisé observé parmi les DesignationEvents immo: document geo-only réel ou bruit à qualifier.

Un `document_identity_state: incomplete` ne conclut pas qu’immo n’a jamais eu le document : il signale seulement qu’aucune comparaison de document normalisé n’était possible.

## Échantillon auditable (maximum 5 extras par catégorie)

### residual_taxonomy

- {"city":"saint-raymond","natural_key":{"muni":"saint-raymond","source_url_norm":"https://villesaintraymond.com/uploads/documents/pieces-jointes/09-02-2026-Ordre-du-jour.pdf","date_iso":"2026-02-09","type":"autre"},"extrait_brut":null,"document_identity_state":"complete"}
- {"city":"saint-raymond","natural_key":{"muni":"saint-raymond","source_url_norm":"https://villesaintraymond.com/uploads/documents/pieces-jointes/09-02-2026-Ordre-du-jour.pdf","date_iso":"2026-02-09","type":"derogation-mineure"},"extrait_brut":null,"document_identity_state":"complete"}
- {"city":"saint-raymond","natural_key":{"muni":"saint-raymond","source_url_norm":"https://villesaintraymond.com/uploads/documents/pieces-jointes/09-02-2026-Ordre-du-jour.pdf","date_iso":"2026-02-09","type":"derogation-mineure"},"extrait_brut":null,"document_identity_state":"complete"}
- {"city":"saint-raymond","natural_key":{"muni":"saint-raymond","source_url_norm":"https://villesaintraymond.com/uploads/documents/pieces-jointes/09-02-2026-Ordre-du-jour.pdf","date_iso":"2026-02-09","type":"derogation-mineure"},"extrait_brut":null,"document_identity_state":"complete"}
- {"city":"saint-raymond","natural_key":{"muni":"saint-raymond","source_url_norm":"https://villesaintraymond.com/uploads/documents/pieces-jointes/09-02-2026-Ordre-du-jour.pdf","date_iso":"2026-02-09","type":"projet-reglement"},"extrait_brut":null,"document_identity_state":"complete"}

### shared_doc_immo_undercount

Aucun extra dans cette catégorie.

### geo_only_doc

Aucun extra dans cette catégorie.

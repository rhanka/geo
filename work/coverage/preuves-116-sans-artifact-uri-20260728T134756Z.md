# Preuves des 116 refusées sans artefact S3

Lecture S3 strictement seule, terminée à `2026-07-28T13:48:34.473Z`. La partition fermée est une seule classe nominative de **116** collections : `uniform-https-artifact-uri-with-valid-sha256`. Il n’y a donc **0** preuve absente, **0** `sources.geometry` absent, **0** URI `s3://`, **0** URI autre, et **0** SHA manquant ou malformé.

Les 116 noms, le champ observé, et une enveloppe entière non transformée pour chaque forme distincte sont dans le JSON voisin; les trois enveloppes demandées sont celles de `audet`, `montreal` et `victoriaville`, sous `rows[].proof_envelope_samples`. Elles sont toutes `schema_version: "1.0"`, et portent `sources.geometry.artifact_uri` HTTPS + `sources.geometry.sha256` valide, mais aucun `retrieved_at`.

Le compte **167/871 est donc faux pour la définition « URL HTTPS + SHA-256 servi » : il faut le corriger à `167 + 116 = 283/871`**. Ces 116 ne sont toutefois pas des preuves v2 exactes : la règle v2 exige le triplet URL + `retrieved_at` + SHA-256 relié à un manifeste de capture, à son CAS re-haché et à son sidecar non-backfilled.

Pour rendre les 116 atteignables sans toucher aux géométries, il faut une migration v1→v2 additive explicitement autorisée et, pour chaque URL, une capture cluster dont la ligne de manifeste a exactement cette URL et dont les octets CAS re-hachent au SHA déjà écrit; elle fournit alors le seul `retrieved_at` légitime. Tout SHA différent impose l’arrêt et une décision de ré-acquisition, jamais un remplacement silencieux du SHA historique.

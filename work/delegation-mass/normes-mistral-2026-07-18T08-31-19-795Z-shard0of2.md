# NORMES Mistral — shard 0/2 — 2026-07-18T08:31:19.795Z

## Périmètre et méthode

- Sélection relue dans `coverage-matrix.json` : villes dont `zones.status=done` et
  `normes.status!=done`, triées puis filtrées avec `index % 2 == 0`.
- Moteur d'extraction employé pour le dépôt : **Mistral document_annotation**
  (`--engine mistral-schema`). Aucun moteur GPT/Codex n'a été employé.
- Relance de `loop-supervise.ts` au début et après le lot : tableau final
  `normes=777`, `zones=866`.

## Dépôt net : saint-alphonse-rodriguez

- Source officielle :
  `https://www.municipalite.saintalphonserodriguez.qc.ca/citoyens/urbanisme/reglements-d-urbanisme`.
  La page relie l'annexe courante « Annexe F — grilles combinées » :
  `https://www.municipalite.saintalphonserodriguez.qc.ca/wp-content/uploads/2026/05/2026-03-02-annexe-f-grilles-combinees.pdf`.
- Le serveur a confirmé `HTTP 200`, `application/pdf`, 3 727 242 octets. Le PDF est
  une grille image : la voie OCR `--auto-grid-page` a donc avorté sans consommation
  (« no grille window proven ») et la voie `mistral-schema` a été utilisée.
- Dépôt parquet vérifié : 120 lignes / 120 `zone_code` distincts, tous de forme
  réglementaire (`P1-1` à `P8-4`). Le manifeste fusionné indique
  `published_field_pct=83.6`, `overlap=107`, méthode `ocr/mistral-schema`.
- Gates : plus de trois codes verbatim réels, recoupement SIG non nul (107) et champs
  publiés non nuls. Aucune valeur non publiée n'a été fabriquée : le schéma conserve
  les valeurs verbatim ou `null`.
- Budget : chaque appel Mistral était plafonné à `1 USD`; les appels dont le résultat
  a été affiché totalisent 0,027 USD. Le premier passage complet a déposé le parquet,
  mais sa ligne de coût n'a pas été restituée par le lanceur; aucun montant supplémentaire
  n'est donc affirmé ici.

## Aval lots

- `zonage-norms-manifest-merge.ts --apply` a inscrit Saint-Alphonse-Rodriguez. La même
  fusion a également observé une entrée concurrente pour `ivry-sur-le-lac`; elle n'est
  pas attribuée à ce lot. Une entrée `registry` a échoué parce que sa clé S3 était
  absente.
- Après régénération ciblée, `lot-zone-join-run.ts --verify-only` confirme 5 477 lots,
  100 % affectés, 100 % avec normes et 0 % sans normes.
- `lots-enriched-run.ts` a redéposé 5 477 lots avec `zone_code=100 %` et
  `norms=100 %`.

## Échecs documentés, sans extraction payante

- `saint-casimir` : le règlement officiel local a été essayé avec la voie OCR
  auto-grille; résultat `no grille window proven` et abort à 0 USD.
- Premier lot shard-0 réexaminé : `abercorn`, `aston-jonction`, `authier-nord`,
  `biencourt`, `caplan`, `clermont--abitibi-ouest`, `dundee`, `east-broughton`,
  `fermont`, `gallichan`, `grand-remous` et `grosse-ile`. Les preuves déjà présentes
  dans les rapports de délégation montrent respectivement l'absence de grille réelle,
  un amendement seul, une annexe séparée ou blanche, un document hors règlement, une
  grille SIG sans recoupement, un scan non-grille, l'absence de codes de zone ou un
  portail non public. Le fallback registry/crawler n'a produit aucune nouvelle URL
  PDF officielle vérifiable pour ces cas.

## Intégrité

- Aucun fichier `.track`, secret ou `.claude` n'a été modifié.
- Aucun `--force` n'a été utilisé sur le parquet déjà déposé.

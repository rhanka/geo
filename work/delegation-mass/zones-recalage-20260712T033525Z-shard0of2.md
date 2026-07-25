# Recalage PDF zones — shard 0/2 — 2026-07-12T03:35:25Z

Règle appliquée: uniquement les villes dont l’index de Object.keys(cities).sort() modulo 2 vaut 0. Aucun AGOL owner harvest. Aucun Python. Aucun GCP, label ou zone_code inventé.

## Dépôt frais

La Bostonnais a été servie depuis la carte officielle https://labostonnais.ca/file-23876.

- T1 a détecté un GeoPDF NAD_1983_MTM_8, résidu de géoréférencement 0,537 m.
- La voie texte a confirmé 0 code; la voie Claude a lu 14 étiquettes dans le crop officiel.
- Le dictionnaire est limité aux codes visibles dans le plan officiel; 14/14 lectures sont exactes et validées, 0 rejet.
- Gate spatial: 1,962 km du centroïde cadastral, 14/14 labels dans la bbox.
- Serving: 13 features de codes distincts; 693/707 lots assignés, soit 98,02 %; 97,56 % de surface couverte.
- Dépôt S3 réussi dans normalized/ca-qc-zonage/qc-zonage-la-bostonnais.geojson.

Les chaînes obligatoires ont ensuite réussi:

- lot-zone-join-run: 707 lignes, 98,02 % assignés, parquet et statistiques vérifiés.
- lots-enriched-run: 707 lots déposés, surface 100 %, code postal 100 %, adresse 89,82 %.

## Boucle et preuves

Le premier lot de 12 slugs a déjà été contrôlé dans les rapports shard 0 précédents. Le lot suivant a été audité par preuve existante pour Côte-Nord-du-Golfe-du-Saint-Laurent, Desbiens, Duhamel, Eeyou-Istchee-James-Bay, Fassett, Forestville, Grand-Remous, Grandes-Piles, Hébertville, Inverness et Kipawa. La Bostonnais est le dépôt frais de ce lot.

Après le dépôt, la matrice contient 148 résidus pairs, dont 140 dans les buckets PDF. La vérification Node montre que les 148 ont une entrée de preuve dans le rapport terminal antérieur; aucun slug du shard n’est sans preuve. Les échecs antérieurs restent des rejets honnêtes: absence de plan de base, absence de géoréf, résidu ou holdout insuffisant, orientation/isotropie, gate spatial ou scan sans GCP réel. Ils ne sont pas transformés en zone servie.

Références de preuve:

- work/delegation-mass/zones-recalage-20260712T032414Z-shard0of2.json
- work/delegation-mass/zones-recalage-20260710T232036Z-shard0of2.json
- work/delegation-mass/zones-recalage-20260711T0355Z-shard0of2.json
- work/zones-recalage/shard0of2/la-bostonnais-t1-claude/qc-zonage-la-bostonnais.stats.json

Supervision finale: zones 820/1106; 817 servis; focus-30 zones 29/30, manque saint-boniface. Le dépôt frais est le seul nouveau dépôt de cette intervention.

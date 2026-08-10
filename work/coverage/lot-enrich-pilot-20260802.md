# Pilote lots-enriched — 2026-08-02

Périmètre : huit petites/moyennes municipalités, 8 769 lots au total, toutes
`complete` pour `code_zone` dans la matrice d'assignation, normes servies, moins
de 15 000 lots, hors Laval et hors listes de re-capture zones.

Gain mesuré sur les sidecars réellement servis : `folded-normes` passe de
157/8 769 (1,79 %) à 1 607/8 769 (18,33 %), soit **+1 450 lots**. Les gains sont
`chesterville` (+857, 3→860) et `saint-zephirin-de-courval` (+593, 0→593).
Les six autres sont des contrôles stables : aucune norme ni adresse n'a été
inventée ou perdue.

| muni | lots | normes avant→après | adresse avant→après | backup | miroir | stamp |
|---|---:|---:|---:|:---:|:---:|:---:|
| chesterville | 1 022 | 3→860 | 936→936 | OK | OK | OK |
| saint-zephirin-de-courval | 715 | 0→593 | 660→660 | OK | OK | OK |
| sainte-francoise--les-basques | 843 | 63→63 | 761→761 | OK | OK | OK |
| duhamel-ouest | 973 | 2→2 | 919→919 | OK | OK | OK |
| saint-ours | 1 293 | 8→8 | 1 278→1 278 | OK | OK | OK |
| dupuy | 936 | 7→7 | 936→936 | OK | OK | OK |
| ormstown | 2 421 | 62→62 | 2 401→2 401 | OK | OK | OK |
| havelock | 566 | 12→12 | 564→564 | OK | OK | OK |

Les `adresse=null` sont structurelles (`314` lots au total) : absence de valeur
dans le rôle joint par numéro de lot, ou absence de résolution anti-collision ;
elles ne comptent pas comme un gain et n'ont jamais été déduites. Chaque dépôt a
été sauvegardé sous `_replaced/` avant écrasement, écrit à plat, miroiré dans le
sous-dossier servi par geo-api, puis vérifié sur les deux clés. Les stamps
`zone_source_url`/`zone_source_level` du zonage servi sont identiques avant/après,
y compris le `STAMPED_NULL` honnête de `duhamel-ouest`.

Les matrices ont fourni la sélection et leurs raisons verbatim ; les chiffres
avant/après ci-dessus viennent des audits sidecars S3 réellement lus, avec le
sous-dossier prioritaire. Deux candidats de préflight (`ham-nord`, codes
disjoints, et `abercorn`, déjà 81/455 malgré la matrice datée à 0/455) ont été
restaurés depuis leur backup et ne font pas partie des huit livrés.

Typecheck : `npm run typecheck --workspace @sentropic/geo-acquisition` atteint
uniquement l'erreur préexistante `runIdsFromManifestKeys` dans
`src/lib/capture-e2e-probe.test.ts`, hors périmètre ; aucune correction ni
affaiblissement de ce typecheck n'a été fait.

# NORMES via Mistral — shard 3/4

Date: 2026-07-11T16:36:56Z  
Branche: `feat/cadre-acquisition`  
Sélection: `zones.status == done`, `normes.status != done`, index de la liste triée `% 4 == 3`.

## Résultat net

- Dépôt Parquet-only réussi: `saint-georges-de-windsor`.
- Moteur: `ocr/mistral-schema` (`document_annotation`), aucun GPT/Codex.
- Pages: 75 pages dimensionnelles explicites, 43 codes distincts.
- Gates: 43 codes >= 3; SIG 41; overlap 41; recouvrement SIG 100%; `publishedFieldPct=34.9%`; gates OK.
- Coût du dépôt final: 0,225 USD (test préalable: 0,060 USD), sous 1 USD/ville.
- Objet: `registry/qc-zonage-norms/qc-zonage-norms-saint-georges-de-windsor.parquet`.
- Fusion manifeste: 623 -> 624 entrées durant la commande; `saint-georges-de-windsor` ajouté. Une clé parasite `registry` a été ignorée par le merge (`specified key does not exist`).
- Join ciblé: 965 lots, 99,59% assignés, 100% de match, 0% sans normes, vérifications Parquet/stats OK.
- Lots enrichis: 965 lots, `zone_code=99.59%`, `norms=99.59%`, surface et code postal 100%, dépôt OK.

## Extractions Mistral rejetées par les gates

- `beaulac-garthby`, `belleterre`, `moffet`, `pierreville`, `saint-camille`, `sainte-anne-de-sorel`: 0 zone extraite.
- `kinnears-mills`: schéma 8 codes, overlap 0, champs publiés 0%.
- `notre-dame-du-nord`: 3 codes, overlap 0/107.
- `saint-simon-de-rimouski`: schéma 32 codes, champs publiés 44,5%, overlap 0/43.
- `westbury`, `saint-guillaume`, `notre-dame-de-stanbridge`, `saint-alexandre-de-kamouraska`, `saint-romain`, `wotton`, `saint-felix-de-kingsey`: moins de 3 codes exploitables après OCR/schéma.
- `saint-lin-laurentides`: schéma 8 codes, overlap 0/115, champs publiés 0%.
- `new-carlisle`: OCR 4 codes avec overlap 4 mais champs publiés 0%; schéma rejeté overlap 0.
- `saint-anaclet-de-lessard`: 0 zone dans les 80 premières pages; aucun signal dimensionnel fiable au probe.
- `parisville`: page dimensionnelle 99, OCR et schéma à 0 code; exécution sans dépôt faute d'URL PDF exacte.
- `saint-jude`: schéma 8 codes, overlap 0/47, champs publiés 0%.

Coût Mistral observé de tous les essais de ce shard durant cette session: environ 1,271 USD au total; chaque ville est restée sous 1 USD et sous six minutes.

## Découverte et preuves d'échec

- Matrice initiale: 69 cibles strictes dans le shard.
- 212 manifestes `discovered*.json` croisés: 15 PDF confirmés; tous ont été testés ci-dessus.
- Inventaire local complet du résidu: les meilleurs règlements/grilles ont été sondés; les PDF sans URL exacte n'ont pas été déposés.
- `saint-andre-de-restigouche`: artefact écarté, car les fichiers portent explicitement sur Saint-Alexis (mauvaise municipalité).
- `grand-metis`, `les-hauteurs`, `saint-dominique-du-rosaire`: graines officielles trouvées, mais le portail `municipalites-du-quebec.com` a expiré au téléchargement; aucun coût OCR.
- Le crawler 2-hop a confirmé sa limite de registry PV: 0 PDF confirmé pour les lots ciblés et la majorité des petites municipalités absentes de la registry.
- Le résidu sans PDF confirmé ni artefact local reste non productible sans nouvelle source officielle; aucun document ni norme n'a été inventé.

## Supervision finale

Scoreboard observé: normes 626/1106, zones 817/1106. L'augmentation globale 623 -> 626 inclut l'activité concurrente; le dépôt attribuable à ce shard est `saint-georges-de-windsor`.

# Normes Mistral — shard 0/4

Date : 2026-07-12T03:41Z  
Branche : `feat/cadre-acquisition`  
Règle : liste globale des slugs triée, conservation des index tels que définis par la matrice, `index % 4 == 0` uniquement.

## Exécution

- `loop-supervise.ts` exécuté au départ et entre les lots. Le premier appel a nécessité l’autorisation du pipe IPC temporaire de `tsx`; la supervision a ensuite réussi.
- Norme lue : `docs/spec/normes-extraction-retenu.md`.
- Sélecteur : 70 candidats productibles au départ (`zones=done` et `normes!=done`) dans ce shard.
- Quatre lots ont été parcourus, soit 60 slugs, sans traiter les autres shards.
- Toutes les extractions ont utilisé Mistral (`mistral-ocr-4-0` ou `mistral-schema`); aucun GPT-5.5/Codex n’a été utilisé.
- Chaque tentative Mistral a été plafonnée à 1 USD par ville; les appels schema de fallback sont restés sous le dollar cumulé de la ville.

## Dépôts acceptés

| slug | résultat Mistral | gates |
|---|---|---|
| `beaumont` | 49 lignes parquet-only | 49 codes, 41 overlap SIG, `publishedFieldPct=32.1`, dépôt accepté |
| `price` | 22 lignes parquet-only | 22 codes, 20 overlap SIG, `publishedFieldPct=22.7`, dépôt accepté |

Les deux dépôts ont été réconciliés avec `zonage-norms-manifest-merge.ts --apply` pendant la boucle. Le manifeste est passé de 645 à 648 avec Beaumont, puis de 648 à 649 avec Price; les erreurs `registry: The specified key does not exist` concernent un artefact registry absent et n’ont pas contourné les gates.

## Gates négatifs et preuves principales

- `0 zones extracted` : Abercorn, Auclair, Barnston-Ouest, East Broughton, Bedford, Clermont, Ivry-sur-le-Lac, L’Ascension-de-Patapédia, Normandin, Notre-Dame-du-Bon-Conseil, Port-Daniel-Gascons, Ragueneau, Rémyigny, Rivière-Bleue, Saint-Épiphane, Saint-Eugène-de-Ladrière, Saint-Jean-de-la-Lande, Saint-Marcel-de-Richelieu, Saint-Pie, Saint-Pierre-de-Broughton, La Visitation, New Richmond, Saint-Hilaire-de-Dorset, Saint-Jules.
- seuil `<3 zone_codes` : Albanel (1), Gatineau (1), La Visitation schema (1).
- `overlap=0` : Grosse-Île (2), Clermont (6 puis 7), Les Îles-de-la-Madeleine (2), L’Islet (4), Sacré-Cœur-de-Jésus (6).
- `publishedFieldPct=0` : Lac-des-Plages (30 codes), L’Île-d’Anticosti (13), Notre-Dame-des-Pins (18), Saint-Léon-de-Standon (10), Saint-Louis-de-Gonzague-du-Cap-Tourmente (4).
- artefacts non exploitables : La Pocatière et L’Épiphanie échouent à `pdftotext`; Saint-Jacques-de-Leeds échoue à `pdfunite` sur 31 chunks schema.
- tentatives sans source PDF officielle confirmée : Baie-des-Sables, Caplan, Cloridorme, Escuminac, La Reine, Padoue, Hope, Roquemaure, Saint-Bonaventure, Saint-Donat-de-la-Mitis, Saint-Joseph-de-Sorel, Saint-Majorique-de-Grantham. Aucun appel Mistral n’a été fait sur une URL inventée.
- Saint-Octave-de-Métis : les deux liens trouvés sont restés injoignables; aucun appel Mistral.
- Saint-Patrice-de-Beaurivage : PDF MRC identifié et confirmé auparavant, mais le téléchargement via le crawler a été refusé par la limite d’autorisation automatique de l’environnement; aucun contournement réseau.

## Découverte et intégrité

- PDF locaux réutilisés en priorité; puis crawler 2-hop, seeds officiels et recherche web sur domaines municipaux/MRC.
- Seeds dédiés : `discovered-shard-0-20260711-{c,d,e,f}.json` et seed Saint-Patrice `g`; aucun `discovered.json` partagé n’a été écrasé.
- Aucun fichier `.claude`, `.track` ou secret n’a été modifié volontairement.
- La dernière tentative de merge après les diagnostics schema n’a pas pu démarrer sans escalade (`tsx` : `listen EPERM /tmp/tsx-1000/14.pipe`); elle n’a révélé aucun dépôt supplémentaire avant cette tentative.

## Suite

Après ces 60 slugs, il reste 25 candidats productibles dans le shard selon la matrice au moment du repiquage. La boucle doit reprendre au lot suivant, en conservant le filtre global `index % 4 == 0` et les preuves ci-dessus pour éviter les répétitions.

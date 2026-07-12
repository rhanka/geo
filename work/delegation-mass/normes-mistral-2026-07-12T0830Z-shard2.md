# Normes Mistral — shard 2/4 — 2026-07-12

## Périmètre et provenance

- Shard appliqué sur la liste triée des villes éligibles (`zones.status=done` et `normes.status!=done`), avec la règle `index % 4 == 2`.
- Recalcul observé pendant la session : 257 villes éligibles, 64 dans ce shard.
- Lots examinés : premier lot jusqu'à Howick, puis lot suivant de 15 villes (`la-guadeloupe` à `poularies`). Les autres indices ont été ignorés.
- `loop-supervise.ts` exécuté au démarrage et entre les lots. Provenance : NORMES; heartbeat absent selon la politique du superviseur.
- Extraction exclusivement Mistral (`mistral-schema`, `document_annotation`), sans GPT-5.5 ni codex.

## Dépôts nets validés

| Ville | Source officielle | Résultat Mistral | Gates |
|---|---|---:|---|
| `saint-cyrille-de-lessard` | GestionWebLex, document officiel `#457-2025 — Règlement sur le zonage - Grille de spécification` | 41 codes, 41 lignes uniques, 51,8 % de champs publiés | `gridFound=true`, SIG 4, recouvrement 3, `gatesOk=true`; 0,03 USD observé |
| `saint-guillaume` | Page officielle d'urbanisme; trois PDF de grilles A–F, C–I–P–V et H assemblés pour l'ingestion | 55 codes, 55 lignes uniques, 63 % de champs publiés | SIG 56, recouvrement 53, `gridFound=true`; extraction sous le budget de 1 USD |

Les deux dépôts sont PARQUET-only. Les PDF temporaires ont été conservés hors dépôt sous `/tmp`; aucune donnée inventée n'a été ajoutée. La seconde extraction ciblée de Saint-Guillaume a coûté 0,048 USD; la passe complète finale a remplacé le dépôt partiel et ses métriques finales sont celles rapportées par le manifest merge.

## Contrôles et enrichissements

`zonage-norms-manifest-merge.ts --apply` a enregistré les deux dépôts du shard. Le merge a aussi vu un parquet concurrent préexistant pour `saint-eugene-de-ladriere`; il n'est pas revendiqué comme dépôt de cette session. Avertissement registry-key manquante conservé comme état préexistant.

Joins exécutés pour les deux villes :

- `saint-guillaume` : 1 232 lots, 100 % zonés, 98,13 % avec normes, 98,13 % de correspondance; enrichissement déposé.
- `saint-cyrille-de-lessard` : 1 246 lots, 0,24 % zonés et 0 % avec normes; le contrôle de dépôt reste valide (recouvrement SIG des normes = 3), mais le faible recoupement cadastral est signalé sans extrapolation.

## Preuves négatives / découverte bornée

- Le crawler a confirmé quelques documents mais a rejeté des règlements/amendements sans grille exploitable (`brebeuf`, `courcelles-saint-evariste`, et découverte incomplète de `gatineau`).
- Pour `la-guadeloupe`, les PDF officiels trouvés étaient des cartes/plans et un règlement de permis, pas la grille de zonage; aucun appel Mistral inutile n'a été lancé.
- Les recherches officielles du lot suivant n'ont pas fourni de grille exploitable pour plusieurs petites municipalités; les liens non vérifiés n'ont pas été utilisés.

## Fichiers et intégrité du worktree

- Ce rapport est le seul fichier local produit pour la traçabilité de cette session.
- Les modifications préexistantes, `.claude`, `.track`, les secrets et les artefacts d'autres agents n'ont pas été touchés ni ajoutés.

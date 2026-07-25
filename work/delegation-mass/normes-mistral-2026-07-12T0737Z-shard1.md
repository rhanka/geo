# NORMES via MISTRAL — shard 1/4 — 2026-07-12T0737Z

## Périmètre et supervision

- Branche : `feat/cadre-acquisition`.
- Sélecteur exécuté : `sorted-index % 4 == 1`, `zones.status == done`, `normes.status != done`.
- Sélection initiale : 73 candidats; le dernier passage en a montré 71 après les dépôts concurrents. Les 71 candidats du shard ont été parcourus en lots de 15, 15, 15, 15 et 11.
- `loop-supervise.ts` exécuté au démarrage, entre les lots et en fin de session.
- Découverte : crawler borné 2-hop sur les 15 premiers slugs (4 sites dans la registry PV, 0 PDF confirmé), puis portails municipaux/MRC et recherche web officielle. Tous les PDFs retenus ont été vérifiés HTTP 200 et `%PDF`.
- Extraction : uniquement `mistral-ocr-4-0` ou `mistral-schema` (`document_annotation`). Aucun GPT/codex.
- Dépôts : parquet-only, puis fusion du manifeste; aucune modification de `.claude`, `.track` ou secret.

## Dépôts nets

### Rapide-Danseur

- Source : `https://rapide-danseur.ao.ca/documents/pages/grilles-de-zones.pdf`.
- Route : `mistral-schema`, pages 1–10/11, coût estimé `$0.030`.
- Gates : 31 codes réels, 26/30 en overlap SIG, `publishedFieldPct=8.1%`.
- Dépôt : `registry/qc-zonage-norms/qc-zonage-norms-rapide-danseur.parquet`.
- Join : 527 lots, `assigned=99.81%`, `match=99.81%`, `without_norms=0.19%`.
- Lots enrichis : 527 lignes, normes `99.62%`, dépôt OK.

### Saint-Benjamin

- Source : endpoint PDF officiellement lié par `st-benjamin.qc.ca` : `https://www.csp20.com/Handlers/FileHandler.aspx?path=Reglements%5CClient-e78f6927-9499-4596-9a68-0b999b27a6c2%5C6c349f81-1daf-47ad-8d92-a16a9607cd22.pdf`.
- Route : `mistral-schema`, pages 57–62, coût estimé `$0.018`.
- Gates : 45 codes réels, 45/45 en overlap SIG, `publishedFieldPct=62.5%`.
- Dépôt parquet : `registry/qc-zonage-norms/qc-zonage-norms-saint-benjamin.parquet`.
- Join : 1 065 lots, `match=100%`, `without_norms=0%`.
- Lots enrichis : 1 065 lignes, normes `99.81%`, dépôt OK.

## Gates refusés / preuves

- Courcelles-Saint-Évariste : PDF HTTP 200, 159 pages, annexes explicatives mais aucune table de grille; OCR Mistral sur 80 pages : 0 zone.
- Dupuy : page 99 = page-titre blanche « GRILLE DES SPÉCIFICATIONS »; OCR 0 zone; schema a isolé seulement le faux code de pagination `92`; refus `<3 codes`, `publishedFieldPct=0`, overlap 0.
- L’Assomption : annexe téléchargée, pages 3–4 seulement pages-titres; OCR/schema : 0 zone; refus `<3 codes`.
- Fugèreville : règlement HTTP 200 mais aucune annexe/grille dans le PDF.
- Berry : URL trouvée mais GET non récupérable; aucun dépôt.
- Notre-Dame-des-Prairies : schema a extrait 59 zones et 76.9% de champs publiés, mais overlap SIG `0/155`; refus strict. Les codes du PDF (`RL-*`) ne recouvrent pas les codes SIG canonisés (`R-*`), sans recodage inventé.
- Macamic : source découverte devenue HTTP 404.
- Mont-Carmel, Pont-Rouge, Princeville, Saint-Élzéar-de-Témiscouata : règlement HTTP 200 avec page-titre d’annexe de grilles, mais sans cellules/table exploitable dans les PDFs fournis.
- Saint-Joseph-de-Coleraine et Saint-Joseph-des-Érables : règlements HTTP 200, sans annexe de grille dans les documents vérifiés.
- Valcourt : schema, 66 codes dont 7/20 overlap SIG, mais `publishedFieldPct=0`; refus anti-invention.
- Senneterre : règlement HTTP 200 sans annexe de grille; Trois-Rivières : fiche explicative sans zones; Saint-Pacôme : plan de zonage seulement.
- Les autres candidats du shard n’avaient ni PDF officiel local/découvert confirmé ni document de grille confirmé après fallback; aucun appel Mistral ni dépôt spéculatif.

## Coût Mistral de la session

Estimation runner : `$0.430` au total, sous `$1/ville`; l’essai auto-grid interrompu avant facturation a été relancé avec fenêtres explicites.

## État final observé

`loop-supervise.ts` final : scoreboard `normes=654`, `zones=821`; deux dépôts nets de ce shard et leurs enrichissements sont livrés. Les autres changements préexistants/concurrents du worktree sont conservés hors du commit ciblé.

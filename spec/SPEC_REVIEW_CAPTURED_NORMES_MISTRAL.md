---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: working-tree captured normes bridge
target-diff-sha256: 4b558937783c3308a287b3e710b8d6b9993867b1babc85019565a1ad6e16ad02
observed-failure: The active Codex runtime exposes neither an exact model identifier nor a declared reasoning effort. The harness review protocol forbids inferring them, so no eligible author-complementary h2a panel can be selected.
---

# Revue — pont CAS NORMES vers Mistral schéma

Le panel n'a pas été lancé. Le checksum couvre `git diff HEAD --no-ext-diff` à
l'ouverture de la revue; les nouveaux chemins non suivis font partie du même
pont mais ne peuvent pas être intégrés à cette empreinte sans modifier l'index.
La revue doit être relancée avec des métadonnées auteur exactes avant merge.

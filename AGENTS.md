# AGENTS — lire `CLAUDE.md` en premier

Ce dépôt a une guidance unique : **[`CLAUDE.md`](CLAUDE.md)**. Tout agent (Codex,
Gemini, Aider, OpenCode, Copilot CLI, …) la lit avant toute action ; ce fichier
n'est qu'un pointeur, il ne duplique rien.

Le principe fondateur, à ne pas contourner :

> **Rien ne doit exister uniquement sur une machine. Toute logique se capitalise
> dans la lib, toute donnée captée se dépose sur le stockage objet.**

Le détail (rejouabilité sur checkout propre, capture = donnée de production,
preuve par construction, « vert par omission = rouge ») est dans `CLAUDE.md`.

## ⛔ WP — premier niveau GELÉ

Les workpackages sont **sept, fixés** (ADR-0022, `docs/spec/SPEC_WORKPACKAGES.md`) :

> **wp1** cadastre · **wp2** zones · **wp3** reglements · **wp4** pv ·
> **wp5** jointures · **wp6** archi (règles/contrats, **pas de code**) · **wp7** socle (build + deploy).

**Aucun WP racine ne se crée sans l'accord explicite du propriétaire.** Un nouveau
besoin se raccroche à l'un des sept comme sous-item, jamais comme WP de premier
niveau. La QA n'a pas de WP à elle : chaque WP porte sa partition fermée (un refus
est un état, pas une absence) et son script de mesure committé.

**Les rôles sont gelés de même** : sept rôles de couche (`role:lot`, `role:zones`,
`role:reglement`, `role:pv`, `role:jointures`, `role:archi`, `role:socle`) + trois
transverses (conductor, qa, propriétaire). Une donnée ou exigence nouvelle devient
le **devoir d'un rôle existant**, jamais un rôle neuf, sauf accord du propriétaire.
La **PII (Loi 25)** est au gardien `lot`, la **conformité/licence** à `archi`.

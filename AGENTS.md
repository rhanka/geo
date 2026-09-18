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

**Les rôles de travail sont CINQ** (ADR-0033, consolidation de la liste ADR-0022 ;
`docs/spec/SPEC_WORKPACKAGES.md` §8) :

> **`role:socle`** (wp7, le build) · **`role:archi`** (wp6, règles/contrats **+ conformité/licence**) ·
> **`role:reglementaire`** (wp3+wp4 : le PV *détecte*, le règlement *qualifie*) ·
> **`role:geometrie`** (wp1+wp2 : les deux géométries servies ; **PII Loi 25** = état `PII_REFUSED`) ·
> **`role:consistance`** (wp5 + fonction qa : cohérence lot↔zone + vérification des mesures).

Transverses : **propriétaire**, **conductor**. **Les 7 WP restent** les unités de mesure — chaque WP
garde sa partition fermée + son script committé ; la consolidation est au niveau du **rôle**, pas du WP.
Une donnée ou exigence nouvelle devient le **devoir d'un rôle existant**, jamais un rôle neuf, sauf accord
du propriétaire. **Anti-auto-notation** : `consistance` vérifie les rôles producteurs ; sa propre jointure
est notée par `archi` (ou le propriétaire), jamais par elle-même.

# AGENTS — lire `CLAUDE.md` en premier

Ce dépôt a une guidance unique : **[`CLAUDE.md`](CLAUDE.md)**. Tout agent (Codex,
Gemini, Aider, OpenCode, Copilot CLI, …) la lit avant toute action ; ce fichier
n'est qu'un pointeur, il ne duplique rien.

Le principe fondateur, à ne pas contourner :

> **Rien ne doit exister uniquement sur une machine. Toute logique se capitalise
> dans la lib, toute donnée captée se dépose sur le stockage objet.**

Le détail (rejouabilité sur checkout propre, capture = donnée de production,
preuve par construction, « vert par omission = rouge ») est dans `CLAUDE.md`.

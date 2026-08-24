# col-20 — MILESTONE : qc-zoning-events consommable via geo-api OGC (2026-08-18)

## Résultat

Les collections `qc-zoning-events-*` déposées sur S3 (LIVE depuis des semaines,
capture vérifiée `_verify-zoning-events-served.ts` `68793772`) sont désormais
**servies ET consommables via l'API OGC** — le restart geo-api (owner-gated) a
rechargé l'index de collections au démarrage du pod.

Vérifié en lecture directe des endpoints `/items` (numberMatched exact = compte
d'événements attendu, byte-servi) :

| collection | endpoint | numberMatched | attendu | statut |
| --- | --- | ---: | ---: | --- |
| qc-zoning-events-saint-eustache | `/collections/qc-zoning-events-saint-eustache/items` | **377** | 377 | ✓ 404→200 |
| qc-zoning-events-saint-mathieu-de-beloeil | `/collections/qc-zoning-events-saint-mathieu-de-beloeil/items` | **37** | 37 | ✓ 404→200 |

## Portée

- **col-20 = ÉMET désormais** : les événements de zonage (dates d'entrée en vigueur,
  numéros de règlement) sont interrogeables via OGC, plus seulement présents comme
  octets S3. La boucle « mesure là où geo émet » peut consommer col-20.
- Transition mesurée : **404 (S3 déposé mais non exposé) → 200 (consommable)**.
  Le blocage était le rechargement de l'index côté geo-api (owner-gated), pas un
  défaut de dépôt jointures — le dépôt était correct depuis l'origine.
- Preuve de consommabilité = réponse OGC réelle (numberMatched exact), pas une
  assertion. Rejouable sur checkout propre : re-interroger les deux endpoints.

## Suite

- Le levier jointures sur col-20 (dépôt + stampage qc-zoning-events) est **livré et
  consommable**. Signal remonté à geo-cond (milestone col-20 consommable).
- Les autres slugs qc-zoning-events déposés suivent la même exposition (même index) ;
  vérification par slug à la demande.

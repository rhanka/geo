# FOCUS30 Lile-Dorval - preuve stricte 2026-07-07

Objectif: terminer le dernier focus30 `lile-dorval` uniquement avec une source officielle stricte. Decision: **aucun depot**.

## Etat focus30

- `npx tsx src/focus30-status.ts`: S3 `normalized/ca-qc-zonage` reste a 29/30; manquant confirme: `lile-dorval`.
- `npx tsx src/focus30-allayers.ts`: matrice locale a zones=30, normes=29, pv=29; `lile-dorval` manque normes et pv.
- `work/coverage/coverage-matrix.json` marque `zones.status=done` / `doneTrack=agol-account`, mais aucun objet S3 zones n'est servi pour ce slug.

## Source officielle inspectee

Source municipale officielle: `https://www.liledorvalisland.ca` (`qc-municipal-directory.json`, MAMH 66092).

Constats HTTP du site officiel:

- `robots.txt`: `Allow: /`, mais `Disallow: /*/portail`, `Disallow: /*/portal`, `Disallow: /*/operations`.
- `sitemap.xml`: pages publiques seulement (`/fr`, `/en`, conseil, avis publics, contact, confidentialite, conditions, gestion contractuelle). Aucun chemin public de zonage, urbanisme, carte, reglements ou documents.
- Les pages publiques autorisees (`/fr`, `/fr/avis-publics`, `/fr/conseil-administration`, `/fr/gestion-contractuelle`, `/fr/contact`) ne publient aucune carte/grille de zonage exploitable.
- Les routes `rules`, `documents`, `permits` et les telechargements d'avis sont sous `/fr/portail/...`; elles ne sont donc pas une surface automatisable propre pour un depot strict.
- Les titres publics d'avis contiennent des reglements generaux (occupation/entretien des batiments, permis et certificats, taxes, nuisances, ethique), mais aucun avis/titre public ne fournit une source `zonage`, `urbanisme`, `carte`, `lotissement`, `subdivision` ou grille cartographique.

## Faux positif AGOL

`work/delegation-mass/ZONES-ACQ.md` documente que les 22 cellules focus marquees `done` par candidate-track ne sont pas substantielles: aucune URL FeatureServer n'est enregistree, contrairement aux vrais depots AGOL, et aucun canal ouvert ArcGIS/WFS/CKAN n'a fourni une grille vecteur de zonage. Pour `lile-dorval`, la ligne dediee reste: verifier d'abord qu'un zonage reglementaire existe; sinon flag 0 servi, jamais d'id de remplissage.

## Verdict

Preuve suffisante pour ne pas deposer:

1. S3 confirme `lile-dorval` absent du serving zones.
2. La seule surface officielle publique indexee ne contient pas de plan/grille de zonage.
3. Le portail officiel est explicitement exclu de l'exploration automatisee par `robots.txt`.
4. Le `doneTrack=agol-account` local n'a pas de source officielle verifiable ni d'URL FeatureServer.

Conclusion: source officielle stricte indisponible dans les limites propres. Aucun depot zones/normes/pv n'a ete effectue.

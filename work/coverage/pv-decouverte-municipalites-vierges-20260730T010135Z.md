# Enquête de découverte PV — 2026-07-30

Le cardinal mesuré est **222**, pas 527. La liste committee est
[`pv-decouverte-municipalites-vierges-20260730T005234Z.json`](pv-decouverte-municipalites-vierges-20260730T005234Z.json).
Sur la référence de 1 106 communes: 377 sont couvertes, le corpus S3 contient 507 communes
canoniques candidates seulement, donc `1106 - 377 - 507 = 222`. L’écart de 305 vient du fait
que le corpus courant contient 507 candidates-only, et non les 202 implicites dans 527.
Un slug candidat hors référence (`hemmingford`) est conservé séparément dans la liste.

## Échantillon aléatoire

Échantillon SHA-256/Fisher-Yates de 30 sur les 222, seed `pv-decouverte-20260730T005234Z`;
partition fermée: **a=5, b=18, c=0, d=6, e=1, f=0**, somme **30**.

- a: site municipal et PDF PV lu (`%PDF-`) depuis un lien désignant les PV: 5.
- b: site HTML accessible, page/portail PV désigné mais aucun PDF lisible dans la fenêtre bornée: 18.
- c: PV MRC: 0.
- d: aucune URL MAMH identifiable, ou transport échoué sans site prouvé: 6 (2 URL absentes du répertoire, 4 `fetch failed` dont le DNS résout; 0 `ENOTFOUND`).
- e: site accessible, octets de navigation ouverts, aucun PV désigné: 1.
- f: 0.

Les octets, tailles, SHA-256, URL finale et diagnostics sont dans le [rapport JSON de
l’enquête](pv-decouverte-municipalites-vierges-20260730T010135Z-enquete.json). Les requêtes
sont toutes passées par `capturedFetch`, UA navigateur, retry explicite d’un 403, `store:false`,
store mémoire et plafond 5 MiB; aucune écriture `raw/` ou `capture/_runs/`.

## Portée de la conclusion

Dans l’échantillon, le site est atteignable pour **24/30 (80,0 %)**; un PV est prouvé par les
octets pour **5/30 (16,7 %)**; **23/30 (76,7 %)** sont soit prouvés soit potentiellement
atteignables après suivi du portail (`a+b+c`). Ces proportions sont une extrapolation
descriptive de **n=30**, non une mesure des 222: elle serait fausse si les communes absentes,
MRC, tailles ou hébergeurs sont disproportionnés. **Aucun plafond structurel “majorité sans PV
en ligne” n’est démontré**: l’absence vraie `e` n’est que 1/30; `b` et `d` mesurent surtout un
goulot de portail/découverte ou une joignabilité non établie.

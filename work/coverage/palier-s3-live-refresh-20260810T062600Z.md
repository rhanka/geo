# Palier 20×167 — rescan S3 courant post-#136/#137 et Lambton — 2026-08-10T06:26:00Z

La couverture est réconciliée depuis S3 après les merges #136 et #137 avec
`NODE_OPTIONS=--dns-result-order=ipv4first` et `AWS_MAX_ATTEMPTS=10`.
La passe fraîche (`2026-08-10T06:25:59.484Z`) donne `pv=1064`, `normes=818`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39`, tous `+0`.

Le Job Kubernetes `geo-capture-zones-20260810t060934z` est terminé. La sonde
S3 relit le run `zones-20260810T060934Z-0-a1fe20e2-e0f1-4e98-98d6-3434aad6b162`:
Lambton répond HTTP 200, 8245960 octets, dans
`raw/zones-v1-proof-url/cas/b32fb0f4cb8e84e72548534daf1d59a632ff0dc6c97869e7bab866aa3cd4c226.json`.
Le SHA-256 et la preuve v2 sont vérifiés sur S3; la tentative `robots.txt` 403
reste une ligne distincte sans octets.

Après régénération complète lot→zone, `palier-matrix-report.mjs --check`
réussit. Par rapport à la dernière passe S3 1645/3284, la mesure est
1646/3284 (50,122 %). Le gain net est col. 5 règlement : 86→87 complètes sur
163, Bois-des-Filion passant de `incomplete` à `complete`. Les colonnes 12 et
13 restent respectivement 24/163 et 4/163. Lambton demeure une capture
brute/CAS sans `normalized/` et ne reçoit aucun crédit KPI.

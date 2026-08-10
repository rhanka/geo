# Palier 20×167 — rescan S3 après Melbourne et merges récents — 2026-08-10T07:46:05Z

Le Job `geo-capture-zones-20260810t072610z` est terminé (1/1). Le run S3
`zones-20260810T072610Z-0-60c223e5-3952-4855-acd9-dc9a61a49014` prouve
Melbourne : HTTP 200, 5 193 517 octets,
`sha256:7a0c5c212a7473c7203e96dafa3363760193f72056ae8cd7e9eae31117b28acd`.
La relecture E2E depuis S3 vérifie manifeste, `run.json`, log, CAS, sidecar et
preuve v2. La tentative `robots.txt` HTTP 403 est isolée.

Après les merges récents sur `main`, la réconciliation S3 fraîche
(`generatedAt=2026-08-10T07:45:41.068Z`) et la matrice lot→zone 1 106 villes
sont régénérées avec les variables réseau requises. Le rapport validé par
`--check` donne 1 653/3 284 résolus (50,3350 %), soit +1 : la promotion
vérifiée est Richelieu en col. 5 (93 → 94/163). Col. 3 reste 107/163,
col. 12 24/163 et col. 13 4/163 complets.

Le gain vient de l'artefact règlement mergé. Le CAS Melbourne est bien sur S3
mais n'est pas encore une zone normalisée ni une ville pliée, donc sans crédit
Palier.

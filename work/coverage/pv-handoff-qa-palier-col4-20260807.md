# Handoff QA — PV capté/indexé, palier col-4

Deux lots cluster mono-ville/shard (`--memory-limit-mi 512`) ont été terminés,
classés depuis les octets S3 et foldés par `pv-octets-to-verdict.ts`.

| Run | Source | Municipalités promues `complete` | PV confirmés |
|---|---|---|---:|
| `pv-20260807T000100Z` | `pv-index` | saint-eustache, sainte-therese, vaudreuil-dorion | 8/9 tentatives |
| `pv-20260807T000200Z` | `pv-index` | saint-hippolyte, sainte-marthe-sur-le-lac, vaudreuil-sur-le-lac | 9/9 tentatives |

Re-mesure après le lot 2 : **681/1106** villes couvertes. Une promotion existe
seulement lorsqu'au moins un octet CAS est classé
`PV_LISIBLE_PROPRIETAIRE_CONFIRME` et transcrit `INDEXED`.

## Murs grandes villes : ne pas re-grinder

Les six murs de la cohorte 673→675 demeurent des blocages robots/infra réels,
pas des `N-A` et pas des couvertures fabriquées :

- terrebonne — WAF/IP datacenter, PDF en `HTTP_403`;
- saint-hyacinthe — chaîne TLS serveur incomplète;
- trois-rivieres et sherbrooke — PDFs Maruche hors domaine officiel, blocage de
  politique de rattachement;
- saguenay et quebec — SPA/XHR sans endpoint documentaire SSR capturable.

Référence de preuve : `work/coverage/pv-capture-grandes-villes-20260803T195800Z-run.md`.
Les options de déblocage (egress alternatif, CA bundle, politique Maruche ou
découverte headless) sont hors de ce lot.

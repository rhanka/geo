# Grand-Saint-Esprit — viewer GoNet6 et dominance d’usage (2026-08-10)

## Chaîne de découverte S3

La page municipale officielle de règlements déjà capturée sur S3 publie
littéralement le lien « Matrice graphique »
`https://www.goazimut.com/GOnet6/?m=50065&pl=1`. Trois captures unitaires ont
été exécutées sur le cluster OVH; tous les octets et manifestes sont sur S3.

| Élément dérivé | Run cluster | CAS S3 | Résultat |
| --- | --- | --- | --- |
| Viewer GoNet6 | `usage-dominant-20260810T081000Z-0-a6af1e25-df1a-460a-b19e-713218393103` | `raw/usage-dominant-matrix-viewer/cas/a2395a777a569244f485cb07c75b1ca819dc1ba65cca548cc36ec5745f9e8b2a.html` | HTML applicatif, sans légende ni service municipal directement déclaré. |
| Module `gonet/main` explicitement chargé | `usage-dominant-20260810T082700Z-0-25f95874-8f68-4af4-b6ef-c31c0424117c` | `raw/usage-dominant-matrix-viewer-module/cas/d58c7aff57c811950f757c2e9bcce54c09eaa186734d261eac2038a06331f34f.bin` | Charge `config/50065`, puis `validateVersion`. |
| Configuration `config/50065` explicitement chargée | `usage-dominant-20260810T082900Z-0-44056acf-4d3c-4d2a-ad2f-17f33d7008d6` | `raw/usage-dominant-matrix-viewer-config/cas/cc2e56e90bd01348eb480f92e39b9f2bf7d3a7804195cad960671b3aa66cbfcb.bin` | Identifie Grand-Saint-Esprit et le backend GoNetInternet. Elle stipule que le texte officiel prévaut sur le viewer. |
| Module `gonet/util` explicitement chargé | `usage-dominant-20260810T083100Z-0-2067b5fe-6831-441f-b413-720ab0a577c0` | `raw/usage-dominant-matrix-viewer-util/cas/34262986c5c892960ad156a320e9492d6bcb649ddaa2a1bd676da1b86e1b30d8.bin` | Établit que `validateVersion` est un POST `application/x-www-form-urlencoded`, pas une URL GET. |

Les worklists correspondantes sont committées sous
`acquisition/config/usage-dominant-capture-20260810-grand-saint-esprit-gonet-*.json`.

## Portée et refus

La configuration du viewer affirme que le texte officiel a préséance et ne
fournit ni règlement-base, ni légende de dominance, ni `sourceGrilles`. Le
module client montre qu'une éventuelle configuration de service serait obtenue
par POST formulaire. Le runner de capture de cette lane reçoit des worklists
d'URL GET; il n'est donc pas utilisé pour simuler ou inventer ce POST.

Cette piste ne justifie aucune correspondance `A-*`, `H-*` ou `HC-*` vers une
catégorie de dominance. `usage_dominant` reste **unknown**. Une étape future
nécessiterait un contrat explicite et testé de capture POST cluster→S3, ainsi
qu'une source qui établit réellement la dominance, pas seulement un viewer
informatif.

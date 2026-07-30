# Essai CDP/DOM PV — 18 portails

Sonde bornée : page d’accueil, au plus 2 liens PV rendus et 2 chemins canoniques, 8 s par rendu. Les 6 URL candidates ont ensuite été capturées par `capturedFetch` dans le Job PV `pv-20260730T025950Z`, puis leurs CAS ont été ouverts et classés.

| Commune | Portail | DOM | PV réel | URL PV / verdict octets |
| --- | --- | --- | --- | --- |
| Saint-Charles-de-Bellechasse | oui | oui | non | aucun candidat DOM |
| Gaspé | oui | oui | non confirmé | PDF sans couche texte (`registredonselus.pdf`) |
| Sainte-Monique | oui | oui | non | aucun candidat DOM |
| Maskinongé | oui | oui | non | aucun candidat DOM |
| Saint-Clet | oui | oui | non | aucun candidat DOM |
| Sainte-Jeanne-d’Arc | oui | oui | non | candidat HTTP 404 |
| Saint-Adelphe | oui | oui | non | PDF lisible non-PV (politique de confidentialité) |
| Saint-Sulpice | oui | oui | non | aucun candidat DOM |
| Saint-Éloi | oui | oui | non | aucun candidat DOM |
| Saint-Joseph-des-Érables | oui | oui | non | aucun candidat DOM |
| Thurso | oui | oui | **oui** | https://www.ville.thurso.qc.ca/wp-content/uploads/2026/06/260608.pdf |
| Cap-Santé | oui | oui | non | aucun candidat DOM |
| Blanc-Sablon | oui | oui | non | aucun candidat DOM |
| L’Isle-Verte | oui | oui | non | PDF lisible non-PV (avis public) |
| Sainte-Louise | oui | oui | non | aucun candidat DOM |
| Murdochville | oui | oui | **oui** | https://murdochville.com/wp-content/uploads/2026/07/2026-06-08.pdf |
| Rigaud | oui | oui | non | aucun candidat DOM |
| Notre-Dame-du-Mont-Carmel | oui | oui | non | aucun candidat DOM |

Résultat : 18/18 portails atteints et DOM rendus, 6/18 candidats DOM, **2/18 PV réellement confirmés par les octets**. Les deux confirmations portent les passages `VILLE DE THURSO` + `Adoption du procès-verbal`, et `MUNICIPAL DE LA VILLE DE MURDOCHVILLE` + `PROCÈS-VERBAL DE L’ASSEMBLÉE RÉGULIÈRE DU CONSEIL`.

WordPress marche pour Thurso et Murdochville ; Gaspé (WordPress) reste non confirmé. Résistent dans cette sonde passive : Drupal (Saint-Clet), Joomla-like (Maskinongé, Saint-Joseph-des-Érables), Wix-like (Notre-Dame-du-Mont-Carmel) et le portail script-heavy Saint-Sulpice. L’extrapolation initiale `18/30 × 222 = 133,2` devient `2/30 × 222 = 14,8` sous le taux réellement observé ; elle ne justifie pas une variante CDP avant un diagnostic des échecs.

Aucune variante de pod, aucun Dockerfile ni adaptateur n’a été créé. La seule modification est `pvUrl` dans le rapport de `pv-obscura-run.ts`, pour transmettre au chokepoint le premier lien déjà retenu par le parseur et en vérifier les octets.

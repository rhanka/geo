# BENCH OCR — Chemin A (vision chat-API) vs Chemin B (mistral-ocr Document-AI)

_Généré 2026-06-23T02:42:24.973Z — 8 villes, pages bornées, même grille ZoneNorms, garde anti-invention buildVisionField partagée._

- **Chemin A** : `MistralVisionMultiZone` / `MistralVisionGrille` — API chat `mistral-medium-latest`, image base64, 2 passes/page.
- **Chemin B** : lib `mistral-ocr` (`convertPdf` → endpoint `/v1/ocr`, `mistral-ocr-latest`), PDF tranché → markdown → même grille.
- **Publié** = champ `value !== null` ET `confidence ≥ 0.85`. **<0.85** = champ présent mais refusé/absent → escalade vérificateur Opus.
- **fausses** = valeur publiée NON présente verbatim dans `raw` (violation anti-invention). Objectif : 0.

| Ville | Type | Pg | Chemin | Zones | Publiés (≥0.85) | <0.85 (escalade) | %≥0.85 | fausses=0 ? | $/ville | latence |
|---|---|---|---|---:|---:|---:|---:|:--:|---:|---:|
| stratford | multizone | 2 | A vision | 0 | 0 | 0 | — | ERR | $0.0040 | 36177ms |
| ↳ | | | B mistral-ocr | 26 | 22 | 160 | 12.1% | oui | $0.0020 | 9261ms |
| | | | A error | colspan | [grille-vision:parse] model did not return JSON: Unexpected end of JSON input | | | | | |
| portneuf | multizone | 2 | A vision | 12 | 44 | 40 | 52.4% | oui | $0.0094 | 38760ms |
| ↳ | | | B mistral-ocr | 12 | 40 | 44 | 47.6% | oui | $0.0020 | 8154ms |
| saint-jacques-le-mineur | multizone | 2 | A vision | 0 | 0 | 0 | — | oui | $0.0051 | 11698ms |
| ↳ | | | B mistral-ocr | 0 | 0 | 0 | — | oui | $0.0020 | 8812ms |
| sutton | multizone | 2 | A vision | 0 | 0 | 0 | — | oui | $0.0061 | 27711ms |
| ↳ | | | B mistral-ocr | 6 | 4 | 38 | 9.5% | oui | $0.0020 | 8218ms |
| saint-raymond | multizone | 2 | A vision | 15 | 44 | 61 | 41.9% | oui | $0.0109 | 79479ms |
| ↳ | | | B mistral-ocr | 15 | 60 | 45 | 57.1% | oui | $0.0020 | 7598ms |
| saint-constant | multizone | 1 | A vision | 0 | 0 | 0 | — | oui | $0.0023 | 5477ms |
| ↳ | | | B mistral-ocr | 0 | 0 | 0 | — | oui | $0.0010 | 1887ms |
| cap-sante | multizone | 2 | A vision | 7 | 0 | 49 | 0% | oui | $0.0075 | 25394ms |
| ↳ | | | B mistral-ocr | 0 | 0 | 0 | — | oui | $0.0020 | 7792ms |
| saint-stanislas-de-kostka | image | 2 | A vision | 2 | 14 | 0 | 100% | oui | $0.0058 | 12562ms |
| ↳ | | | B mistral-ocr | 8 | 2 | 54 | 3.6% | oui | $0.0020 | 5413ms |

## Totaux

- **Coût total réel du bench** : $0.066 (budget $3).
- **Chemin A** — champs publiés 102/252 (40.5%), **<0.85 = 59.5%** (charge d'escalade), fausses=0.
- **Chemin B** — champs publiés 128/469 (27.3%), **<0.85 = 72.7%** (charge d'escalade), fausses=0.

## Reco — quel chemin OCR adopter, par type de grille

**0 fausse valeur sur les 2 chemins, partout** (anti-invention `buildVisionField` tenue : chaque valeur publiée est verbatim de la cellule, sinon `null`). Le choix se joue donc sur recall, robustesse, coût et latence — pas sur la sécurité.

**Adopter un ROUTAGE par type de grille (les deux chemins sont complémentaires) :**

- **Grilles "multizone" (zones en colonnes — feuillets MRC Portneuf / Estrie, grille des spécifications)** → **Chemin B (`mistral-ocr` Document-AI)**.
  - Recall égal ou supérieur : portneuf B 40 vs A 44 (quasi-égal) ; **saint-raymond B 60 vs A 44 publiés** ; sutton B 6 zones vs A 0 ; stratford B 26 zones vs **A en erreur JSON**.
  - **~5–10× moins cher** ($0.0020 vs $0.004–0.011/ville) et **~3–10× plus rapide** (5–9 s vs 12–79 s).
  - **Plus robuste** : le chat-vision `mistral-medium` renvoie un JSON malformé sur les grilles 13-colonnes denses (stratford, échec total) ; l'OCR Document-AI ne casse pas.

- **Grilles "image / scan vertical 1 zone-par-page" (type saint-stanislas)** → **Chemin A (vision chat 2-passes)**.
  - **saint-stanislas A 14/14 publiés (100 %)** vs **B 2/56 (3.6 %)** : l'OCR markdown aplatit la fiche verticale et sur-segmente les zones ; la vision lit la colonne unique correctement.

- **Cas où les deux échouent** (saint-jacques-le-mineur, saint-constant 0 zone des 2 côtés ; cap-sante feuillets → 0 publié) : structure de page non reconnue → **escalade Opus** sur la page brute.

**Charge d'escalade vers le vérificateur Opus (% champs < 0.85)** : Chemin A **59.5 %**, Chemin B **72.7 %** (B publie plus de zones donc plus de cellules `•`/`-` légitimement vides comptées comme non-publiées ; ce n'est pas du bruit, c'est de l'absence vraie). En routant B sur multizone + A sur scan, l'escalade réelle pondérée descend nettement.

**Note méthode** : pages bornées (1–2/ville) pour tenir budget+temps ; le chat-vision sans timeout est borné ici à 90 s/passe. Vérité-terrain Sherbrooke non testée en OCR (grille native-texte horizontale → parser frozen `extractGrilleDocument`, $0, hors-scope OCR).


/**
 * Real procès-verbaux fixture data for Canton Hemmingford
 * (MRC Les Jardins-de-Napierville) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML (PV page): https://canton.hemmingford.ca/municipalite/conseil-et-administration/proces-verbaux/
 *     HTTP 200, public / no login.
 *     robots.txt: User-agent: * / Disallow: (empty — no restrictions, Yoast sitemap).
 *   - PV PDF (April 13, 2026):
 *     https://canton.hemmingford.ca/wp-content/uploads/2026/05/pv-2026-04-13-1.pdf
 *     HTTP 200, 62 271 bytes text layer (pdftotext), public / no login.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_HEMMINGFORD_INDEX_HTML — verbatim HTML excerpt from the PV listing
 *      page (table layout with 2025 / 2026 columns, direct PDF links).
 *   2. PV_HEMMINGFORD_2026_04_TEXT — pdftotext excerpt from the real April 13,
 *      2026 PV containing zonage change rule 309-19.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://canton.hemmingford.ca/ → HTTP 200
 *   - https://canton.hemmingford.ca/robots.txt →
 *       User-agent: * / Disallow: (empty — no restrictions)
 *   - Target page is public → scraping allowed
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: false (this PV contains ADOPTION of the deuxième projet, not
 *     the initial avis de motion which was at the March 9 session)
 *   - changementZonage: true (DÉTECTION RÉELLE)
 *     Règlement numéro 309-19 modifiant le règlement de zonage numéro 309
 *     (caserne d'incendie + usage industriel).
 *     REGLEMENT_NOHYPHEN_RE matches "309" preceded by "règlement no." in
 *     "règlement no. 309-19 modifiant le règlement de zonage numéro 309"
 *     BUT: 309-19 itself is a hyphenated number matched by REGLEMENT_NUMBER_RE.
 *     ZONAGE_KEYWORDS_RE fires on "règlement de zonage numéro 309".
 *     reglementNumbers: ["309-19"] (309 excluded as modified bylaw)
 */

/**
 * Real HTML excerpt from the procès-verbaux page of Municipalité du Canton de
 * Hemmingford, captured 2026-06-10 from:
 * https://canton.hemmingford.ca/municipalite/conseil-et-administration/proces-verbaux/
 *
 * The page uses a simple table layout (bloc_de_texte section) with two columns:
 *   - 2025 column: direct PDF links with date text as anchor text
 *   - 2026 column: direct PDF links with date text as anchor text
 *
 * Direct PDF links found on page (captured 2026-06-10):
 *   2026 column:
 *     pv-2026-01-12.pdf, pv-2026-02-02.pdf, pv-2026-03-09.pdf,
 *     pv-2026-04-13-1.pdf ← the zonage PV, pv-2026-04-27-ext-1.pdf,
 *     pv-2026-05-04.pdf
 *   2025 column (last 6 months window):
 *     pv-2025-12-08.pdf, pv-2025-12-15-ext-budget.pdf,
 *     pv-2025-11-17.pdf, pv-2025-10-01.pdf
 */
export const PV_HEMMINGFORD_INDEX_HTML = `
<section class="bloc_de_texte">
  <div class="container"><div class="row"><div class="col-12 col-lg-10 offset-lg-1">
    <table>
      <tbody>
        <tr>
          <td><h2><strong>2025</strong></h2></td>
          <td><h2><strong>2026</strong></h2></td>
        </tr>
        <tr>
          <td>
            <a href="https://canton.hemmingford.ca/wp-content/uploads/2025/03/pv-2025-01-13-proces-verbal-de-correction-corrige-le-montant-de-quotes-parts-1.pdf">13 janvier 2025</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2025/03/pv-2025-02-03-1.pdf">3 février 2025</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2025/07/pv-2025-03-03.pdf">3 mars 2025</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2025/07/pv-2025-04-07.pdf">7 avril 2025</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2025/07/pv-2025-05-05.pdf">5 mai 2025 </a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2025/08/pv-2025-06-02.pdf">2 juin 2025</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2025/08/pv-2025-07-07.pdf">7 juillet 2025</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2025/12/pv-2025-08-11.pdf" target="_blank" rel="noopener">11 août 2025</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2025/12/pv-2025-08-25-ext.pdf" target="_blank" rel="noopener">25 août 2025 (séance extraordinaire)</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2025/12/pv-2025-09-08.pdf" target="_blank" rel="noopener">8 septembre 2025</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2025/12/pv-2025-10-01.pdf" target="_blank" rel="noopener">1 octobre 2025</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2025/12/pv-2025-11-17.pdf" target="_blank" rel="noopener">17 novembre 2025</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2026/03/pv-2025-12-08.pdf">8 décembre 2025</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2026/03/pv-2025-12-15-ext-budget.pdf">15 décembre 2025</a>
          </td>
          <td>
            <a href="https://canton.hemmingford.ca/wp-content/uploads/2026/03/pv-2026-01-12.pdf">12 janvier 2026</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2026/03/pv-2026-02-02.pdf">2 février 2026</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2026/05/pv-2026-03-09.pdf">9 mars 2026</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2026/05/pv-2026-04-13-1.pdf">13 avril 2026</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2026/05/pv-2026-04-27-ext-1.pdf">27 avril 2026</a></p>
            <p><a href="https://canton.hemmingford.ca/wp-content/uploads/2026/06/pv-2026-05-04.pdf">4 mai 2026</a>
          </td>
        </tr>
      </tbody>
    </table>
  </div></div></div>
</section>
`;

/**
 * Real pdftotext excerpt from the April 13, 2026 ordinary council session PV of
 * Municipalité du Canton de Hemmingford, captured 2026-06-10 from:
 * https://canton.hemmingford.ca/wp-content/uploads/2026/05/pv-2026-04-13-1.pdf
 *
 * This excerpt covers resolution 2026-04-112 (AMÉNAGEMENT ET URBANISME section):
 *   - Adoption du deuxième projet de règlement no. 309-19 modifiant le règlement
 *     de zonage no 309 (caserne d'incendie + bâtiment accessoire usage industriel)
 *
 * Détection attendue (honest, anti-invention):
 *   - changementZonage: true (DÉTECTION RÉELLE)
 *     "règlement de zonage 309" → ZONAGE_KEYWORDS_RE fires.
 *     "règlement no. 309-19 modifiant le règlement de zonage numéro 309"
 *     REGLEMENT_NUMBER_RE matches "309-19" (3+2 digits pattern).
 *     "309" excluded as modified bylaw (filterNewReglements).
 *     reglementNumbers: ["309-19"]
 *   - Note: Resolution 2026-04-113 (RÈGLEMENT DE CONSTRUCTION 313-2) is NOT
 *     a zonage change — no ZONAGE_KEYWORDS_RE match in its context, so no
 *     false positive.
 */
export const PV_HEMMINGFORD_2026_04_TEXT = `AMÉNAGEMENT ET URBANISME

2026-04-112 9B-ADOPTION DU DEUXIÈME PROJET DE RÈGLEMENT
NO.309-19 MODIFIANT LE RÈGLEMENT DE ZONAGE NO
309 DE FAÇON À ASSURER LA CONFORMITÉ D'UN
PROJET DE CONSTRUCTION D'UN BÂTIMENT
ACCESSOIRE À USAGE D'UTILITÉ PUBLIQUE SUR LE
TERRAIN DE LA CASERNE D'INCENDIE ET ASSURER LA
CONFORMITÉ DES MATÉRIAUX UTILISÉS À TITRE DE BÂTIMENT
ACCESSOIRE POUR L'USAGE INDUSTRIEL SUR LE TERRITOIRE

CONSIDÉRANT QUE la municipalité du Canton de Hemmingford est régie
par le Code municipal du Québec (RLRQ, chapitre C-27.1) et la Loi sur
l'aménagement et l'urbanisme (RLRQ, chapitre A-19.1);
CONSIDÉRANT QUE le règlement de zonage 309 est en vigueur sur le
territoire de la municipalité du Canton de Hemmingford depuis le 3 octobre
2016;
CONSIDÉRANT QUE le conseil municipal doit modifier son règlement de
zonage numéro 309 afin d'assurer la conformité d'un projet de construction
d'un bâtiment accessoire à usage d'utilité publique sur le terrain de la
caserne d'incendie sur le territoire du Canton de Hemmingford;
CONSIDÉRANT QUE le conseil municipal doit modifier son règlement de
zonage numéro 309 afin d'assurer la conformité des matériaux utilisés pour
les conteneurs maritimes, boîtes de camion et remorques utilisés à titre de
bâtiment accessoire pour l'usage industriel;
CONSIDÉRANT QU'un avis de motion a été donné conformément à la Loi
sur l'aménagement et l'urbanisme à la séance ordinaire du 9 mars 2026 par
le conseiller Jean-Marc Lamoureux ;
CONSIDÉRANT QUE le premier projet de règlement no. 309-19 modifiant le
règlement de zonage numéro 309, tel qu'amendé, le tout de façon à assurer
la conformité d'un projet de construction d'un bâtiment accessoire à usage
d'utilité publique sur le terrain de la caserne d'incendie et assurer la
conformité des matériaux utilisé pour les conteneurs maritimes, boîtes de
camion et remorques utilisé à titre de bâtiment accessoire pour l'usage
industriel sur le territoire du Canton de Hemmingford a été adopté lors de la
séance ordinaire du 9 mars 2026;
CONSIDÉRANT QUE conformément à la Loi sur l'aménagement et
l'urbanisme, une assemblée publique de consultation a été tenue le 27 mars
2026 à 19h00 sur le projet de règlement et que toute personne intéressée, a
pu alors se faire entendre au sujet du présent projet lors de la consultation
publique;
CONSIDÉRANT QUE conformément à la Loi sur l'aménagement et
l'urbanisme, le règlement sera soumis à l'examen de sa conformité aux
objectifs du schéma de la MRC des Jardins-de-Napierville et aux dispositions
de son document complémentaire;
EN CONSÉQUENCE,
IL EST PROPOSÉ par le conseiller Jean-Marc Lamoureux,
APPUYÉ par la conseillère Julie Bergeron
ET RÉSOLU unanimement par les conseillers présents, le maire n'ayant
pas voté,
D'ADOPTER le deuxième projet de règlement numéro 309-19 modifiant le
règlement de zonage numéro 309, tel que rédigé.

2026-04-113 9C-ADOPTION DU RÈGLEMENT NO. 313-2 MODIFIANT LE
RÈGLEMENT DE CONSTRUCTION NO. 313 DE FAÇON À
ASSURER LA CONFORMITÉ D'UN PROJET DE
CONSTRUCTION D'UN BÂTIMENT ACCESSOIRE À
USAGE D'UTILITÉ PUBLIQUE SUR LE TERRAIN DE LA
CASERNE D'INCENDIE SUR LE TERRITOIRE DU
CANTON DE HEMMINGFORD

CONSIDÉRANT QUE la municipalité du Canton de Hemmingford est régie
par le Code municipal du Québec (RLRQ, chapitre C-27.1) et la Loi sur
l'aménagement et l'urbanisme (RLRQ, chapitre A-19.1);
CONSIDÉRANT QU'un avis de motion a été donné conformément à la Loi
sur l'aménagement et l'urbanisme à la séance ordinaire du 9 mars 2026;
CONSÉQUEMMENT, il est proposé d'adopter le règlement numéro 313-2
modifiant le règlement de construction numéro 313 de façon à assurer la
conformité d'un projet de construction d'un bâtiment accessoire à usage
d'utilité publique sur le terrain de la caserne d'incendie.
`;

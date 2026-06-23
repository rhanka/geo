/**
 * Launcher de la FLOTTE zonage "cas durs" via `remote delegate` (k8s remote).
 *
 * Node/TS uniquement (ce repo est Node de bout en bout — jamais de Python).
 * Ne lance RIEN tant que des comptes ne sont pas enrôlés ET que `--go` n'est pas
 * passé : par défaut c'est un DRY-RUN qui imprime seulement le plan (garde-fou
 * crédit — le principal a été échaudé par des lancements non autorisés).
 *
 * Tiering voulu (cf. remote) : workers Sonnet 4.6 ~70 % + Codex o3 ~30 %, plus un
 * vérificateur Opus 4.8 xhigh déclenché a posteriori sur les sorties à
 * confidence < 0.85 (voir `flotte-verify`). Le pool `remote` route en round-robin
 * 1 session = 1 compte (sticky) ; on PIN explicitement via `--account <id>` pour
 * tenir le ratio 70/30 exact.
 *
 * Usage :
 *   # voir le plan (aucun lancement) :
 *   npx tsx src/flotte-zonage-run.ts --track <WP_ID>
 *   # lancer pour de vrai (comptes enrôlés requis) :
 *   npx tsx src/flotte-zonage-run.ts --track <WP_ID> --go
 *   # sous-ensemble :
 *   npx tsx src/flotte-zonage-run.ts --track <WP_ID> --only la-sarre,alma --go
 *
 * Un secret n'est JAMAIS imprimé. `remote delegate --from-credentials` ne copie
 * jamais de token en clair (cf. remote).
 */
import { spawnSync, spawn } from "node:child_process";

const ON_DONE = "claude:geo-quebec:9e9218fd9435";

type Tier = "sonnet" | "codex";

interface HardCase {
  slug: string;
  /** voie de recomposition (informe le prompt, pas le modèle) */
  voie:
    | "t2-ocr-labels-spatial-join"
    | "obscura-session"
    | "contour-calage-lots"
    | "t2-pdf-vectoriel-calage"
    | "t4-scan";
  /** indice de modèle souhaité ; le round-robin 70/30 prime si non forcé */
  tierHint?: Tier;
  /** consigne spécifique (le prompt commun est ajouté autour) */
  task: string;
}

/**
 * Les 12 cas durs zonage identifiés (immo en tête). Chaque `task` est concis :
 * le worker reçoit aussi le PROMPT COMMUN (anti-invention, S3, vérif spatiale).
 */
const HARD_CASES: HardCase[] = [
  {
    slug: "la-sarre",
    voie: "t2-ocr-labels-spatial-join",
    task:
      "GeoPDF Adobe du reglement 05-2024 (lasarre.ca, p301 plan rural / p302 plan urbain) : GDAL a deja extrait 368+202 polygones georeferences NAD83 TM SANS attribut. Les codes de zone sont du texte vectorise (couche Anno, police ArialMT). RECOMPOSE le vecteur : OCR des labels (Mistral) avec leurs positions, puis spatial-join de chaque label dans son polygone englobant -> zone_code par polygone. Publie qc-zonage-la-sarre.",
  },
  {
    slug: "alma",
    voie: "obscura-session",
    task:
      "JMap public geo.ville.alma.qc.ca/carte_publique/ : WMS GetFeatureInfo exige une session authentifiee (LayerNotDefined sinon), WFS=404. Ouvre une session headless (obscura) sur le viewer JMap, recupere l'export vecteur de la couche zonage (ou les GetFeatureInfo zone par zone). Publie qc-zonage-alma.",
  },
  {
    slug: "a-16-contour",
    voie: "contour-calage-lots",
    task:
      "immo a signale que le contour de la zone A-16 est imprecis. Recale le contour A-16 sur la geometrie des lots cadastraux (qc-cadastre-lots) pour un trace precis, et republie/corrige la collection zonage concernee. Coordonne le slug exact avec la matrice.",
  },
  ...[
    "saint-charles-borromee",
    "saint-mathieu-de-beloeil",
    "plaisance",
    "notre-dame-de-lourdes--lerable",
    "petite-riviere-saint-francois",
    "saint-boniface",
    "sainte-catherine",
  ].map(
    (slug): HardCase => ({
      slug,
      voie: "t2-pdf-vectoriel-calage",
      task:
        "PDF de zonage VECTORIEL (pas de marqueur GeoPDF). Vectorise le calque des zones et CALE-le sur les lots cadastraux (qc-cadastre-lots) / points de controle connus pour georeferencer, OCR des codes de zone, spatial-join. Publie qc-zonage-<slug>.",
    }),
  ),
  ...["champlain", "saint-come-liniere"].map(
    (slug): HardCase => ({
      slug,
      voie: "t4-scan",
      task:
        "Plan de zonage SCANNE (image, 0 texte) dans le reglement. Georefere le raster (calage sur lots / amers), OCR des codes de zone, recompose les polygones. Si la qualite est insuffisante pour un zone_code fiable, NE PUBLIE PAS et rapporte (anti-invention). Sinon publie qc-zonage-<slug>.",
    }),
  ),
];

/** Prompt commun ajoute a chaque worker (garde-fous non negociables). */
function fullPrompt(hc: HardCase): string {
  return [
    `Tu es un worker du pipeline geo-quebec (Node/TS uniquement, JAMAIS Python). Repo /home/antoinefa/src/geo, cwd acquisition/.`,
    `OBJECTIF (voie ${hc.voie}) pour ${hc.slug} : ${hc.task}`,
    `SCHEMA de sortie par feature: { zone_code (REEL, jamais invente), kind, affectation, num_zone, source, confidence (0..1) }. Ecris en S3 normalized/ca-qc-zonage/qc-zonage-${hc.slug}.geojson via acquisition/src/lib/s3.ts.`,
    `VERIF SPATIALE obligatoire (centre bbox < 5 km du centroide registre ; > 50 km -> rejette).`,
    `ANTI-INVENTION ABSOLUE : zone_code repris de la source. Si pas de code fiable -> NE PUBLIE PAS, rapporte la raison. Mets un champ confidence honnete par feature (moyenne < 0.85 => declenchera une verif Opus).`,
    `NE commit rien, ne touche pas .track, ne redemarre pas geo-api. Mets a jour work/coverage/coverage-matrix.json pour ${hc.slug} apres succes. JAMAIS echo de secret.`,
    `RAPPORT FINAL : PUBLIE (nb features, ex zone_code, confidence moyenne, verif spatiale km) ou ECHEC (raison + voie a tenter ensuite).`,
  ].join("\n");
}

interface Account {
  id: string;
  provider: string;
  label?: string;
  status?: string;
}

function listAccounts(): Account[] {
  const r = spawnSync("remote", ["account", "ls", "--json"], {
    encoding: "utf8",
  });
  if (r.status !== 0 || !r.stdout) return [];
  try {
    const j = JSON.parse(r.stdout) as unknown;
    const arr = Array.isArray(j)
      ? j
      : ((j as { accounts?: unknown }).accounts ?? []);
    return (arr as Account[]).filter((a) => a && a.id);
  } catch {
    return [];
  }
}

interface Plan {
  slug: string;
  tier: Tier;
  model: string;
  provider: "claude" | "codex";
  accountId: string;
  argv: string[];
}

/**
 * Assigne le tiering 70/30 en round-robin pondere et pin chaque job sur un
 * compte concret. ~70 % sonnet (claude) / ~30 % codex (o3).
 */
function buildPlan(cases: HardCase[], wp: string, accounts: Account[]): Plan[] {
  const claude = accounts.filter(
    (a) => a.provider === "claude-code" && (a.status ?? "active") === "active",
  );
  const codex = accounts.filter(
    (a) => a.provider === "codex" && (a.status ?? "active") === "active",
  );
  let ci = 0;
  let xi = 0;
  const plans: Plan[] = [];
  cases.forEach((hc, i) => {
    // ~30 % codex : 1 job sur ~3 (et seulement si un compte codex existe)
    const wantCodex = hc.tierHint === "codex" || (i % 10) >= 7;
    const useCodex = wantCodex && codex.length > 0;
    if (useCodex) {
      const acct = codex[xi++ % codex.length]!;
      plans.push({
        slug: hc.slug,
        tier: "codex",
        model: "o3",
        provider: "codex",
        accountId: acct.id,
        argv: [
          "delegate",
          "codex",
          fullPrompt(hc),
          "--remote",
          "--headless",
          "--model",
          "o3",
          "--account",
          acct.id,
          "--on-done",
          ON_DONE,
          "--track",
          wp,
        ],
      });
    } else {
      const acct = claude[ci++ % Math.max(claude.length, 1)];
      plans.push({
        slug: hc.slug,
        tier: "sonnet",
        model: "claude-sonnet-4-6",
        provider: "claude",
        accountId: acct?.id ?? "(aucun-compte)",
        argv: [
          "delegate",
          "claude",
          fullPrompt(hc),
          "--remote",
          "--headless",
          "--model",
          "claude-sonnet-4-6",
          ...(acct ? ["--account", acct.id] : []),
          "--on-done",
          ON_DONE,
          "--track",
          wp,
        ],
      });
    }
  });
  return plans;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const wp = arg("track") ?? process.env["FLOTTE_WP"];
  const go = process.argv.includes("--go");
  const only = arg("only")?.split(",").map((s) => s.trim());
  if (!wp) {
    console.error(
      "ERREUR: --track <WP_ID> requis (id du workpackage zonage dans track).",
    );
    process.exit(2);
  }
  let cases = HARD_CASES;
  if (only) cases = cases.filter((c) => only.includes(c.slug));

  const accounts = listAccounts();
  const active = accounts.filter((a) => (a.status ?? "active") === "active");
  console.error(
    `[flotte] comptes actifs: ${active.length} (claude=${active.filter((a) => a.provider === "claude-code").length}, codex=${active.filter((a) => a.provider === "codex").length})`,
  );

  const plans = buildPlan(cases, wp, accounts);
  console.error(`[flotte] ${plans.length} jobs planifies (WP=${wp}):`);
  for (const p of plans) {
    console.error(
      `  - ${p.slug.padEnd(32)} ${p.tier.padEnd(7)} ${p.model.padEnd(18)} account=${p.accountId}`,
    );
  }

  if (!go) {
    console.error(
      "\n[flotte] DRY-RUN (aucun lancement). Ajoute --go pour lancer (comptes requis).",
    );
    return;
  }
  if (active.length === 0) {
    console.error(
      "\n[flotte] REFUS: 0 compte enrole. Lance d'abord `remote account enroll ... --from-credentials`.",
    );
    process.exit(1);
  }

  let launched = 0;
  for (const p of plans) {
    const child = spawn("remote", p.argv, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    console.error(`[flotte] LANCE ${p.slug} (${p.tier}/${p.accountId})`);
    launched++;
  }
  console.error(
    `\n[flotte] ${launched} jobs lances en remote (cap concurrence 16, le reste en queue). Supervise: remote jobs conduct --watch 5`,
  );
}

main();

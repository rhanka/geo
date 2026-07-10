import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const gridFiles = [
  "work/zonage-plans/les-escoumins-grilles-territoire.pdf",
  "work/zonage-plans/les-escoumins-grilles-perimetre-urbain.pdf",
];

const plans = [
  {
    pdf: "work/zonage-plans/les-escoumins-plan1-zonage.pdf",
    out: "work/zonage-recalage/les-escoumins-plan1.reads.json",
  },
  {
    pdf: "work/zonage-plans/les-escoumins-plan2-zonage.pdf",
    out: "work/zonage-recalage/les-escoumins-plan2.reads.json",
  },
];

const dictOut = "work/zonage-dicts/les-escoumins.codes.json";

function textOfPdf(file) {
  return execFileSync("pdftotext", [file, "-"], {
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
  });
}

function bboxXmlOfPdf(file) {
  return execFileSync("pdftotext", ["-bbox-layout", file, "-"], {
    encoding: "utf8",
    maxBuffer: 200 * 1024 * 1024,
  });
}

function stripAccents(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeForSnap(s) {
  return String(s).replace(/[^A-Za-z0-9.]/g, "").toLowerCase();
}

function canonicalCode(num, dom) {
  return (num + dom.replace(/\s+/g, ""))
    .replace(/Diff$/, "diff")
    .replace(/diff$/i, "diff")
    .replace(/Pri$/, "pri")
    .replace(/pri$/i, "pri");
}

function extractDict() {
  const codes = [];
  for (const file of gridFiles) {
    const text = textOfPdf(file);
    for (const page of text.split("\f")) {
      const lines = page.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const idx = lines.findIndex((s) => /^Numero de zone:?$/i.test(stripAccents(s)));
      if (idx < 0) continue;
      let num = "";
      let dom = "";
      for (let i = idx - 1; i >= 0; i--) {
        if (!dom && /^[A-Za-z][A-Za-z0-9/ -]{0,16}$/.test(lines[i])) {
          dom = lines[i];
          continue;
        }
        if (!num && /^\d{1,3}$/.test(lines[i])) {
          num = lines[i];
          continue;
        }
        if (num && dom) break;
      }
      if (num && dom) codes.push(canonicalCode(num, dom));
    }
  }
  return [...new Set(codes)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

function decodeXmlText(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseWords(xml) {
  const pageMatch = xml.match(/page width="([\d.]+)"\s+height="([\d.]+)"/);
  if (!pageMatch) throw new Error("missing page size in bbox xml");
  const pageW = Number(pageMatch[1]);
  const pageH = Number(pageMatch[2]);
  const words = [];
  const wordRe = /xMin="([\d.]+)"\s+yMin="([\d.]+)"\s+xMax="([\d.]+)"\s+yMax="([\d.]+)">([^<]*)<\/word>/g;
  let m;
  let idx = 0;
  while ((m = wordRe.exec(xml)) !== null) {
    const text = decodeXmlText(m[5]).trim();
    if (!text) continue;
    const xMin = Number(m[1]);
    const yMin = Number(m[2]);
    const xMax = Number(m[3]);
    const yMax = Number(m[4]);
    words.push({
      idx: idx++,
      text,
      xMin,
      yMin,
      xMax,
      yMax,
      cx: (xMin + xMax) / 2,
      cy: (yMin + yMax) / 2,
    });
  }
  return { pageW, pageH, words };
}

function closeEnough(a, b) {
  const ah = Math.max(1, a.yMax - a.yMin);
  const bh = Math.max(1, b.yMax - b.yMin);
  const avgH = (ah + bh) / 2;
  const dx = Math.abs(a.cx - b.cx);
  const dy = Math.abs(a.cy - b.cy);
  const xOverlap = Math.max(0, Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin));
  const minW = Math.max(1, Math.min(a.xMax - a.xMin, b.xMax - b.xMin));
  return (dy <= avgH * 1.4 && dx <= avgH * 7) || (xOverlap >= minW * 0.25 && dy <= avgH * 3.5);
}

function candidateVariants(parts) {
  const joined = parts.join("");
  const compact = joined.replace(/\s+/g, "");
  return [
    compact,
    compact.replace(/-+/g, "-"),
    parts.join("-").replace(/-+/g, "-"),
    compact.replace(/^(\d{1,3})-?([A-Za-z].*)$/, "$1$2"),
  ];
}

function extractReadsFromPlan(pdf, validCodes) {
  const byNorm = new Map();
  for (const code of validCodes) {
    const k = normalizeForSnap(code);
    const arr = byNorm.get(k) ?? [];
    arr.push(code);
    byNorm.set(k, arr);
  }

  const { pageW, pageH, words } = parseWords(bboxXmlOfPdf(pdf));
  const candidates = [];
  for (let i = 0; i < words.length; i++) {
    const parts = [];
    const idxs = [];
    let last = null;
    for (let len = 1; len <= 4 && i + len - 1 < words.length; len++) {
      const w = words[i + len - 1];
      if (last && !closeEnough(last, w)) break;
      if (!/^[A-Za-z0-9/.-]{1,16}$/.test(w.text)) break;
      parts.push(w.text);
      idxs.push(i + len - 1);
      last = w;
      for (const variant of candidateVariants(parts)) {
        const matches = byNorm.get(normalizeForSnap(variant)) ?? [];
        if (matches.length !== 1) continue;
        const selected = idxs.map((j) => words[j]);
        const xMin = Math.min(...selected.map((p) => p.xMin));
        const yMin = Math.min(...selected.map((p) => p.yMin));
        const xMax = Math.max(...selected.map((p) => p.xMax));
        const yMax = Math.max(...selected.map((p) => p.yMax));
        candidates.push({
          code: matches[0],
          x: ((xMin + xMax) / 2) / pageW,
          y: ((yMin + yMax) / 2) / pageH,
          idxs: [...idxs],
          source: parts.join(" "),
        });
      }
    }
  }

  const used = new Set();
  const labels = [];
  for (const c of candidates.sort((a, b) => b.idxs.length - a.idxs.length || a.idxs[0] - b.idxs[0])) {
    if (c.idxs.some((i) => used.has(i))) continue;
    c.idxs.forEach((i) => used.add(i));
    labels.push({
      code: c.code,
      x: Number(c.x.toFixed(6)),
      y: Number(c.y.toFixed(6)),
    });
  }
  return labels;
}

const codes = extractDict();
writeFileSync(
  dictOut,
  JSON.stringify(
    {
      slug: "les-escoumins",
      source: [
        "https://www.escoumins.ca/wp-content/uploads/2024/11/Grilles-territoire_14-11-2023.pdf",
        "https://www.escoumins.ca/wp-content/uploads/2024/11/Grilles-perimetre-urbain_14-11-2023.pdf",
      ],
      codes,
    },
    null,
    2,
  ) + "\n",
);

for (const plan of plans) {
  const labels = extractReadsFromPlan(plan.pdf, codes);
  writeFileSync(plan.out, JSON.stringify({ labels }, null, 2) + "\n");
  console.error(`${plan.pdf}: ${labels.length} labels, ${new Set(labels.map((l) => l.code)).size} distinct codes`);
}
console.error(`${dictOut}: ${codes.length} official grid codes`);

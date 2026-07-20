#!/usr/bin/env npx tsx
/**
 * Audit de CONTAMINATION documentaire du corpus normes local.
 *
 * Motif prouve (passe provenance shard 1/2, 2026-07-20) : la famille de crawl
 * `discovery-1200-*` a depose le reglement de la VILLE DE SHERBROOKE (no 1200)
 * sous AU MOINS 2 slugs etrangers (`grand-saint-esprit`, `sainte-genevieve-de-berthier`).
 * Stamper le numero lu dans un tel document serait une INVENTION.
 *
 * Principe du gate, a 0 dollar et sans ouvrir un seul PDF :
 * deux slugs distincts qui portent le MEME octet-pour-octet document ne peuvent pas
 * en etre tous les deux proprietaires. Le hash SHA-1 du contenu suffit a lever la famille.
 *
 * Sortie : groupes de slugs partageant un document identique, + les noms de fichiers
 * portant un prefixe de crawl connu comme contaminant.
 *
 * Usage : npx tsx acquisition/src/_reglement-doc-contamination-audit.ts [--min-bytes N]
 */
import { createHash } from 'node:crypto'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'work/zonage-norms'
const argv = process.argv.slice(2)
const minBytes = Number(argv[argv.indexOf('--min-bytes') + 1]) || 20_000

type Doc = { slug: string; file: string; bytes: number; hash: string }

function listSlugDirs(): string[] {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

function sha1(path: string): string {
  return createHash('sha1').update(readFileSync(path)).digest('hex')
}

const docs: Doc[] = []
let scanned = 0
let skippedSmall = 0

for (const slug of listSlugDirs()) {
  const dir = join(ROOT, slug)
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    continue
  }
  for (const f of entries) {
    if (!f.toLowerCase().endsWith('.pdf')) continue
    const p = join(dir, f)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (!st.isFile()) continue
    scanned++
    if (st.size < minBytes) {
      skippedSmall++
      continue
    }
    try {
      docs.push({ slug, file: f, bytes: st.size, hash: sha1(p) })
    } catch {
      /* illisible : ignore */
    }
  }
}

console.log(`# dossiers de slug        = ${listSlugDirs().length}`)
console.log(`# PDF scannes             = ${scanned} (dont ${skippedSmall} < ${minBytes} o ignores)`)
console.log(`# PDF hashes              = ${docs.length}`)

// --- 1. documents identiques partages par PLUSIEURS slugs -------------------
const byHash = new Map<string, Doc[]>()
for (const d of docs) {
  const arr = byHash.get(d.hash) ?? []
  arr.push(d)
  byHash.set(d.hash, arr)
}

const shared = [...byHash.values()]
  .map((group) => ({ group, slugs: [...new Set(group.map((g) => g.slug))] }))
  .filter((x) => x.slugs.length > 1)
  .sort((a, b) => b.slugs.length - a.slugs.length)

const contaminatedSlugs = new Set<string>()
for (const s of shared) for (const g of s.slugs) contaminatedSlugs.add(g)

console.log(`\n## documents IDENTIQUES portes par plusieurs slugs = ${shared.length} groupe(s)`)
console.log(`   slugs impliques (au plus 1 proprietaire par groupe) = ${contaminatedSlugs.size}`)
for (const s of shared) {
  const d = s.group[0]
  console.log(`\n- sha1=${d.hash.slice(0, 12)} bytes=${d.bytes} slugs=${s.slugs.length}`)
  for (const g of s.group) console.log(`    ${g.slug}\t${g.file}`)
}

// --- 2. prefixes de crawl connus comme contaminants -------------------------
const SUSPECT = ['discovery-1200']
console.log(`\n## fichiers portant un prefixe de crawl contaminant connu (${SUSPECT.join(', ')})`)
const suspects = docs.filter((d) => SUSPECT.some((p) => d.file.startsWith(p)))
if (suspects.length === 0) console.log('   (aucun)')
for (const d of suspects) console.log(`   ${d.slug}\t${d.file}\t${d.bytes}o`)

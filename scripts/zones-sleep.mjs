#!/usr/bin/env node
// Attente temporisée non bloquante (run_in_background) : dort N secondes puis sort.
// Sert de réveil unique quand on sait que des workers vont finir sous peu, pour
// éviter le polling par-rapport. Usage: node scripts/zones-sleep.mjs <seconds>
const secs = Number(process.argv[2] ?? 150);
setTimeout(() => { console.log(`WAKE after ${secs}s`); process.exit(0); }, secs * 1000);

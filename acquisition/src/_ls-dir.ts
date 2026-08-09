// tiny committed ls: print files in a dir with sizes.
import { readdirSync, statSync } from 'node:fs';
const d = process.argv[2];
for (const f of readdirSync(d)) {
  let sz = 0;
  try { sz = statSync(`${d}/${f}`).size; } catch {}
  console.log(sz, f);
}

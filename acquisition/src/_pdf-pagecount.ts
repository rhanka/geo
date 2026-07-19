/** _pdf-pagecount.ts — print "<pages>\t<path>" for each PDF given. */
import { execFileSync } from "node:child_process";

for (const p of process.argv.slice(2)) {
  let pages = "?";
  try {
    const info = execFileSync("pdfinfo", [p], { encoding: "utf8" });
    pages = (info.match(/^Pages:\s*(\d+)/m) ?? [, "?"])[1]!;
  } catch {
    /* keep "?" */
  }
  console.log(`${pages}\t${p}`);
}

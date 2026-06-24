import { ALL_PV_CITIES } from '../../packages/qc-sources/src/sources/proces-verbaux-generic.js';

const bySlug = new Map(ALL_PV_CITIES.map(e => [e.config.citySlug, e.config]));
const slugs = [...bySlug.values()];
console.error('Total unique cities:', slugs.length);
const withUrl = slugs.filter(c => c.pvIndexUrl);
console.error('Cities with pvIndexUrl:', withUrl.length);
// Output slugs with their pvIndexUrl as JSON lines to stdout
for (const c of withUrl) {
  console.log(JSON.stringify({ slug: c.citySlug, pvIndexUrl: c.pvIndexUrl }));
}

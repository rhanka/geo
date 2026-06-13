import { CATALOG } from "$lib/catalog";
import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
  return {
    datasets: CATALOG.map((entry) => ({
      id: entry.id,
      title: entry.title,
      license: entry.license,
      attribution: entry.attribution,
      count: entry.count,
      level: entry.level,
    })),
  };
};

import { performance } from "node:perf_hooks";

import { getDirectoryCatalog, getDirectoryPage } from "../../src/lib/public-data";

async function measure<T>(name: string, task: () => Promise<T>) {
  const before = process.memoryUsage().rss;
  const started = performance.now();
  const result = await task();
  return {
    name,
    elapsedMs: Number((performance.now() - started).toFixed(1)),
    rssDeltaMiB: Number(((process.memoryUsage().rss - before) / 1024 / 1024).toFixed(1)),
    serializedKiB: Number((Buffer.byteLength(JSON.stringify(result)) / 1024).toFixed(1)),
  };
}

async function main() {
  const results = [];
  results.push(await measure("directory-filter-catalog", () => getDirectoryCatalog()));
  results.push(await measure("directory-first-page", () => getDirectoryPage({ page: 1 })));
  results.push(await measure("directory-town-category-page", () => getDirectoryPage({ page: 1, townSlugs: ["audit-town-0"], category: "restaurants" })));
  results.push(await measure("directory-partial-name-search", () => getDirectoryPage({ page: 1, query: "restaurants audit 99" })));
  results.push(await measure("directory-no-results-search", () => getDirectoryPage({ page: 1, query: "zzzz-no-result" })));
  console.log(JSON.stringify(results, null, 2));
}

main();

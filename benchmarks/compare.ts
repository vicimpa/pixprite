/** Compare raw artifacts or the checked-in compact baseline. Does not enforce noisy timing gates. */
type Stats = { n: number; p50: number | null; p95: number | null };
type Artifact = { schemaVersion: number; status: string; config: Record<string, unknown>; environment: Record<string, unknown>;
  summary: ({ scenario: string } & Record<string, Stats | string>)[] };
const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error('Usage: bun benchmarks/compare.ts <baseline.json> <candidate.json>');
const before: Artifact = await Bun.file(beforePath).json(), after: Artifact = await Bun.file(afterPath).json();
if (before.schemaVersion !== after.schemaVersion || before.status !== 'complete' || after.status !== 'complete') throw new Error('Only complete artifacts with matching schema versions can be compared');
for (const field of ['mode', 'steps', 'viewport', 'strictIDBDurability', 'warmups']) {
  if (JSON.stringify(before.config[field]) !== JSON.stringify(after.config[field])) console.warn(`Configuration differs: ${field}`);
}
for (const field of ['chromium', 'headless', 'platform', 'cpu']) {
  if (JSON.stringify(before.environment[field]) !== JSON.stringify(after.environment[field])) console.warn(`Environment differs: ${field}`);
}
console.log('scenario\tmetric\tp50 before → after\tp95 before → after\tp50 change\tn before/after');
for (const row of after.summary) {
  const original = before.summary.find(value => value.scenario === row.scenario);
  if (!original) { console.warn(`New scenario: ${row.scenario}`); continue; }
  for (const [key, value] of Object.entries(row)) {
    const previous = original[key];
    if (typeof value === 'string' || typeof previous === 'string' || !previous || value.p50 === null || previous.p50 === null) continue;
    const change = previous.p50 ? `${((value.p50 / previous.p50 - 1) * 100).toFixed(1)}%` : 'undefined (zero baseline)';
    console.log(`${row.scenario}\t${key}\t${previous.p50.toFixed(2)} → ${value.p50.toFixed(2)}\t${previous.p95?.toFixed(2)} → ${value.p95?.toFixed(2)}\t${change}\t${previous.n}/${value.n}`);
  }
}

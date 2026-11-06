// Writes sample/summary.json, the page's stand-in for bench/results/summary.json, from the
// committed run records of the given seeds, through the bench's own export. It draws no figures.
//
//   node sample/make-sample.mjs [--seeds 5,6,7]
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSummary, subjectFacts } from '../../../../bench/export.mjs';
import { BENCH_DIR, loadSubject } from '../../../../bench/lib/config.mjs';
import { loadPrices } from '../../../../bench/lib/prices.mjs';
import { readGrades, readRecords } from '../../../../bench/lib/record.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const results = resolve(BENCH_DIR, 'results');

const seedsAt = process.argv.indexOf('--seeds');
const seeds = new Set(
	(seedsAt > 0 ? process.argv[seedsAt + 1] : '5,6,7').split(',').map((s) => Number(s.trim()))
);

const records = readRecords(results).filter((r) => seeds.has(r.seed));
const summary = buildSummary({
	records,
	grades: readGrades(results),
	prices: loadPrices(join(BENCH_DIR, 'prices.json')),
	facts: (name, sha) => subjectFacts(loadSubject(name), sha)
});

writeFileSync(
	join(here, 'summary.json'),
	`${JSON.stringify({ ...summary, sample: true }, null, '\t')}\n`
);
console.log(
	`${summary.groups.length} groups from ${records.length} runs, seeds ${[...seeds].join(', ')}`
);

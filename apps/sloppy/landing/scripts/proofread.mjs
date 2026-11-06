// Reads the built site as a visitor would and fails the build where its words disagree with its
// own charts, run after `vite build`. Each check is one kind of mistake the pages have shipped.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { privateSubjects } from '../../../../bench/lib/private.mjs';

const BUILD = resolve(import.meta.dirname, '../build');
const HIDDEN = privateSubjects(resolve(import.meta.dirname, '../../../../bench/subjects'));

/** Visible words outside charts, tables, code and the site's header and footer. */
const BUDGET = [
	[/^index$/, 150],
	[/^results$/, 200],
	[/^how$/, 200],
	[/^methodology$/, 350],
	[/^projects\//, 200]
];

/** Words the pages once used for a difference their chart showed. */
const STALE = [
	/\blevel\b/i,
	/\bties\b/i,
	/\babout the same\b/i,
	/\bas good as\b/i,
	/\bnotes only\b/i
];

/** The small repositories the site leaves out, which only the methodology may mention, once. */
const SMALL = /\bsmall (?:repositor(?:y|ies)|repos?|codebases?|projects?)\b/i;

const NUMBERS = 'no one two three four five six seven eight nine ten eleven twelve'.split(' ');
const numberOf = (w) => (/^\d+$/.test(w) ? Number(w) : NUMBERS.indexOf(w.toLowerCase()));

const VOID = new Set(['br', 'img', 'meta', 'link', 'input', 'hr', 'source', 'wbr', 'col']);
const BLOCK = new Set(
	'p li h1 h2 h3 h4 tr td th div figcaption summary section ol ul table pre svg text title button a span'.split(
		' '
	)
);

const decode = (s) =>
	s
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&nbsp;/g, ' ')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');

/** The page's text in runs, each marked body, chart or chrome, and each table's header row. */
function read(html) {
	const doc = html
		.replace(/<head[\s\S]*?<\/head>/i, '')
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<!--[\s\S]*?-->/g, '');
	const runs = [];
	const stack = [];
	let text = '';
	const kind = () =>
		stack.some((t) => t.chart)
			? 'chart'
			: stack.some((t) => t.chrome)
				? 'chrome'
				: stack.some((t) => t.quoted)
					? 'quoted'
					: 'body';
	const flush = () => {
		const t = text.replace(/\s+/g, ' ').trim();
		if (t) runs.push({ kind: kind(), text: t });
		text = '';
	};
	for (const m of doc.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
		const [, close, name, attrs = '', selfClose, words] = m;
		if (words !== undefined) {
			text += decode(words);
			continue;
		}
		const tag = name.toLowerCase();
		if (BLOCK.has(tag)) {
			flush();
			text = ' ';
		}
		if (close) {
			while (stack.length && stack.pop().tag !== tag);
			continue;
		}
		if (VOID.has(tag) || selfClose) continue;
		stack.push({
			tag,
			chart:
				['svg', 'table', 'pre'].includes(tag) ||
				/\bdata-chart\b/.test(attrs) ||
				/svelte-flow/.test(attrs),
			chrome: ['header', 'footer', 'nav'].includes(tag),
			// The benchmark's own questions, answers and grading, quoted: the site's wording rules are not theirs.
			quoted: /\bdata-quoted\b/.test(attrs)
		});
	}
	flush();
	return { runs, tables: tablesIn(doc) };
}

/** Each table's header cells, in order, and how many rows its body has. */
const tablesIn = (doc) =>
	[...doc.matchAll(/<table[\s\S]*?<\/table>/gi)].map((t) => {
		const head = t[0].match(/<thead[\s\S]*?<\/thead>/i)?.[0] ?? '';
		const body = t[0].match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] ?? '';
		return {
			head: [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((c) =>
				decode(c[1].replace(/<[^>]+>/g, ''))
					.replace(/\s+/g, ' ')
					.trim()
			),
			rows: (body.match(/<tr\b/gi) ?? []).length
		};
	});

const pages = [];
(function walk(dir) {
	for (const name of readdirSync(dir)) {
		const file = join(dir, name);
		if (statSync(file).isDirectory()) walk(file);
		else pages.push(file);
	}
})(BUILD);

const failures = [];
const fail = (page, what) => failures.push(`${page}: ${what}`);

for (const file of pages) {
	const content = readFileSync(file, 'utf8');
	for (const name of HIDDEN.keys())
		if (new RegExp(`\\b${name}\\b`, 'i').test(content))
			fail(relative(BUILD, file), 'names a private project');
}

const html = Object.fromEntries(
	pages
		.filter((f) => f.endsWith('.html'))
		.map((f) => [relative(BUILD, f).replace(/\.html$/, ''), read(readFileSync(f, 'utf8'))])
);

const bodyOf = (page) =>
	html[page].runs
		.filter((r) => r.kind === 'body')
		.map((r) => r.text)
		.join(' ');

for (const [page, { runs }] of Object.entries(html)) {
	const body = bodyOf(page);
	const budget = BUDGET.find(([re]) => re.test(page))?.[1];
	const words = body.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length;
	if (budget && words > budget) fail(page, `${words} words, over its ${budget}`);

	for (const re of STALE) if (re.test(body)) fail(page, `says "${body.match(re)[0]}"`);

	for (const label of new Set(HIDDEN.values()))
		for (const r of runs.filter((r) => r.kind === 'body'))
			if (new RegExp(`[a-z,;:(]\\s+${label}`).test(r.text))
				fail(page, `"${label}" capitalised mid-sentence: "${r.text}"`);

	const sentences = runs
		.filter((r) => r.kind !== 'chart' && r.kind !== 'quoted')
		.flatMap((r) => r.text.split(/(?<=[.!?])\s+/))
		.filter((s) => s.split(' ').length >= 6);
	const seen = new Set();
	for (const s of sentences) {
		if (seen.has(s)) fail(page, `says twice: "${s}"`);
		seen.add(s);
	}
}

/** The projects a table of numbers is drawn over: its header, less the first cell. */
const projectsIn = (page) => {
	const counts = new Set(
		html[page].tables.filter((t) => t.head[0] === 'Approach').map((t) => t.head.length - 1)
	);
	if (counts.size !== 1) fail(page, `charts disagree on how many projects: ${[...counts]}`);
	return [...counts][0];
};

/** Every "six large codebases", "of the six", "across the six" and the like counts `expect`. */
function counted(page, body, expect, what) {
	const named = /\b(\w+)(?: large)?(?: open-source)? (?:projects|codebases)\b/gi;
	const outOf = /\b(?:all|of the|across the) (\w+)\b/gi;
	for (const m of [...body.matchAll(named), ...body.matchAll(outOf)]) {
		const n = numberOf(m[1]);
		if (n >= 0 && n !== expect) fail(page, `"${m[0]}" where ${what} shows ${expect}`);
	}
}

const averaged = (body) => {
	const m = body.match(/Averages across (.+?), each project/);
	return m ? m[1].split(/, | and /).length : null;
};

{
	const body = bodyOf('index');
	const shown = projectsIn('index');
	const listed = averaged(body);
	if (listed !== shown)
		fail('index', `the table averages ${listed} projects; the chart shows ${shown}`);
	counted('index', body, shown, 'the chart');
}

{
	const body = bodyOf('results');
	const shown = projectsIn('results');
	const title = body.match(/Results across (\w+)(?: large)? projects/);
	if (!title || numberOf(title[1]) !== shown)
		fail('results', `title counts ${title?.[1]}; the charts show ${shown}`);
	const large = body.match(/Averaged across the (\w+)/);
	if (!large || numberOf(large[1]) !== averaged(body))
		fail('results', `"${large?.[0]}" but the table averages ${averaged(body)}`);
	counted('results', body, averaged(body), 'the table');
}

{
	const shown = projectsIn('index');
	for (const page of ['how', 'methodology'].filter((p) => html[p]))
		counted(page, html[page].runs.map((r) => r.text).join(' '), shown, "the front page's chart");
}

{
	const approaches = new Set(
		Object.values(html).flatMap(({ tables }) =>
			tables.filter((t) => t.head[0] === 'Approach').map((t) => t.rows)
		)
	);
	if (approaches.size !== 1)
		fail('site', `charts disagree on how many approaches: ${[...approaches]}`);
	const [expect] = approaches;
	for (const [page, { runs }] of Object.entries(html)) {
		const text = runs
			.filter((r) => r.kind !== 'chart')
			.map((r) => r.text)
			.join(' ');
		for (const m of text.matchAll(/\b(\w+) (?:approaches|ways)\b/gi)) {
			const n = numberOf(m[1]);
			if (n >= 0 && n !== expect) fail(page, `"${m[0]}" where the charts draw ${expect}`);
		}
	}
}

{
	const mentions = Object.entries(html).flatMap(([page, { runs }]) =>
		runs.filter((r) => r.kind !== 'chart' && SMALL.test(r.text)).map((r) => [page, r.text])
	);
	for (const [page, text] of mentions.filter(([page]) => page !== 'methodology'))
		fail(page, `mentions the small repositories: "${text}"`);
	if (mentions.filter(([page]) => page === 'methodology').length > 1)
		fail('methodology', 'mentions the small repositories more than once');
}

const scores = (s) => [...s.matchAll(/[+−]\d\.\d{3}/g)].map((m) => m[0]);
const shares = (s) => [...s.matchAll(/\d+%/g)].map((m) => m[0]);

{
	const hero = html.index.runs.find((r) => r.kind === 'body' && /^On average/.test(r.text))?.text;
	const table = html.index.runs
		.filter((r) => r.kind === 'chart')
		.map((r) => r.text)
		.join(' ');
	for (const n of [...scores(hero ?? ''), ...shares(hero ?? '')])
		if (!table.includes(n)) fail('index', `the headline's ${n} is not in the table`);
	if (html.how) {
		const how = html.how.runs.map((r) => r.text).join(' ');
		for (const n of [...scores(how), ...shares(how)])
			if (!table.includes(n)) fail('how', `${n} is not in the front page's table`);
	}
}

const value = (s) => {
	const n = parseFloat(s.replace(/[$,]/g, ''));
	return /k\b/.test(s) ? n * 1e3 : /M\b/.test(s) ? n * 1e6 : n;
};

for (const page of Object.keys(html).filter((p) => p.startsWith('projects/'))) {
	const lines = html[page].runs.filter((r) => r.kind === 'body').map((r) => r.text);
	for (const m of lines.flatMap((l) => [
		...l.matchAll(/^With Sloppy ([^,]+), docs alone (.+?): ([^.]+(?:\.\d+\))?)\./g)
	])) {
		const [said, sloppy, plain, how] = [m[0], value(m[1]), value(m[2]), m[3]];
		const ahead = /higher|cheaper|faster|fewer/.test(how);
		const behind = /lower|more|slower/.test(how);
		const higherIsBetter = /^\d\.\d+$/.test(m[1]);
		const better = higherIsBetter ? sloppy >= plain : sloppy <= plain;
		const worse = higherIsBetter ? sloppy <= plain : sloppy >= plain;
		if ((ahead && !better) || (behind && !worse)) fail(page, `"${said}" reads the wrong way`);
	}
}

{
	const items = [
		...readFileSync(join(BUILD, 'results.html'), 'utf8').matchAll(
			/<a href="\.\/(projects\/[\w-]+)"[^>]*>([\s\S]*?)<\/a>/g
		)
	].map((m) => [m[1], decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')]);
	for (const [page, line] of items) {
		if (!html[page]) continue;
		const body = bodyOf(page);
		for (const n of [...scores(line), ...shares(line)])
			if (!body.includes(n)) fail('results', `${page} reads ${n} here and not on its own page`);
	}
}

if (failures.length) {
	console.error(`The site says things its charts do not:\n- ${failures.join('\n- ')}`);
	process.exit(1);
}
console.log(`Proofread ${Object.keys(html).length} pages: every count and number agrees.`);

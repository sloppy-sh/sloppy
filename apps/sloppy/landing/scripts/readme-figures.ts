// The README's benchmark charts as static SVG, one light and one dark, in docs/images/bench-*.svg.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scaleLinear, scalePoint } from 'd3-scale';
import {
	AGGREGATE_LABEL,
	AGGREGATE_METRICS,
	aggregateNote,
	aggregates,
	largeProjects
} from '$lib/aggregate';
import { ratioSaid, SCORE_LEVEL, scoreSaid } from '$lib/said';
import { approach, DRAW_ORDER, type ApproachId } from '$lib/approaches';
import { placeLabels } from '$lib/charts/endLabels';
import type { SeriesData } from '$lib/charts/types';
import { AXIS_FORMAT, chartTitle, FORMAT } from '$lib/metrics';
import {
	andList,
	approachesRun,
	BETTER,
	FAMILY,
	groupOf,
	modelOf,
	nameOf,
	subjectsWithRuns,
	type Metric
} from '$lib/readings';
import { axisOf, seriesOf, xsOf } from '$lib/series';
import { heroLine } from '$lib/front';
import { loadSummary } from '$lib/server/summary';
import { count, type PageSummary } from '$lib/summary';

const OUT = resolve(process.cwd(), '../../../docs/images');
const TIER = 'medium';
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`;

/** GitHub's own light and dark page inks; the series hues are the site's (src/app.css). */
const THEMES = {
	light: {
		ink: '#1f2328',
		muted: '#59636e',
		grid: '#d1d9e0',
		band: '#eff2f5',
		surface: '#ffffff',
		series: { plain: '#cf5a2b', agents: '#16916a', sloppy: '#4064b9', notes: '#4064b9' }
	},
	dark: {
		ink: '#e6edf3',
		muted: '#9198a1',
		grid: '#3d444d',
		band: '#1c2129',
		surface: '#0d1117',
		series: { plain: '#d95926', agents: '#199e70', sloppy: '#5c82da', notes: '#5c82da' }
	}
} satisfies Record<string, Theme>;

interface Theme {
	ink: string;
	muted: string;
	grid: string;
	band: string;
	surface: string;
	series: Record<ApproachId, string>;
}

const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const text = (
	x: number,
	y: number,
	s: string,
	fill: string,
	attrs: Record<string, string | number> = {}
) =>
	`<text x="${x}" y="${y}" fill="${fill}"${Object.entries(attrs)
		.map(([k, v]) => ` ${k}="${v}"`)
		.join('')}>${esc(s)}</text>`;

const svg = (width: number, height: number, title: string, body: string[]) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-size="13" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
${body.join('\n')}
</svg>
`;

/** Words wrapped to lines of at most `chars` characters. */
function wrap(s: string, chars: number): string[] {
	const lines: string[] = [];
	for (const word of s.split(' ')) {
		const last = lines.at(-1);
		if (last !== undefined && last.length + word.length + 1 <= chars)
			lines[lines.length - 1] += ` ${word}`;
		else lines.push(word);
	}
	return lines;
}

function aggregateFigure(summary: PageSummary, t: Theme) {
	const columns = aggregates(summary);
	const W = 760;
	const LABEL_X = 16;
	const PLOT = [230, 590] as const;
	const VALUE_X = W - 16;
	const BAR = 13;
	const ROW = 2 * BAR + 2 + 16;
	const out: string[] = [];
	let y = 22;

	out.push(text(LABEL_X, y, 'With Sloppy, on average, against', t.muted));
	let lx = 250;
	for (const c of columns) {
		out.push(
			`<rect x="${lx}" y="${y - 10}" width="12" height="12" rx="2" fill="${t.series[c.against.id]}"/>`
		);
		out.push(text(lx + 18, y, c.against.label, t.ink));
		lx += 18 + c.against.label.length * 7.2 + 24;
	}
	y += 30;

	const panel = (
		title: string,
		note: string,
		domain: [number, number],
		ticks: number[],
		tick: (v: number) => string,
		rows: { label: string; values: { id: ApproachId; v: number; said: string }[] }[],
		mark: 'dot' | 'bar',
		band?: number
	) => {
		const x = scaleLinear().domain(domain).range(PLOT);
		out.push(text(LABEL_X, y, title, t.ink, { 'font-weight': 600, 'font-size': 14 }));
		out.push(text(VALUE_X, y, note, t.muted, { 'text-anchor': 'end', 'font-size': 12 }));
		y += 14;
		const top = y;
		const bottom = top + rows.length * ROW;
		if (band !== undefined)
			out.push(
				`<rect x="${x(-band)}" y="${top}" width="${x(band) - x(-band)}" height="${bottom - top}" fill="${t.band}"/>`
			);
		for (const v of ticks)
			out.push(
				`<line x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${bottom}" stroke="${t.grid}" stroke-width="${v === 0 ? 1.5 : 1}"${v === 0 ? '' : ' stroke-dasharray="2 3"'}/>`,
				text(x(v), bottom + 15, tick(v), t.muted, { 'text-anchor': 'middle', 'font-size': 11 })
			);
		rows.forEach((row, r) => {
			const ry = top + r * ROW + 8;
			out.push(text(LABEL_X, ry + BAR + 5, row.label, t.ink));
			row.values.forEach((v, k) => {
				const by = ry + k * (BAR + 2);
				const colour = t.series[v.id];
				if (mark === 'bar') {
					const [a, b] = [x(0), x(v.v)].sort((p, q) => p - q);
					out.push(
						`<rect x="${a}" y="${by}" width="${Math.max(b - a, 1)}" height="${BAR}" rx="3" fill="${colour}"/>`
					);
				} else {
					out.push(
						`<circle cx="${x(v.v)}" cy="${by + BAR / 2}" r="5.5" fill="${colour}" stroke="${t.surface}" stroke-width="2"/>`
					);
				}
				out.push(
					text(VALUE_X, by + BAR - 2, v.said, t.ink, {
						'text-anchor': 'end',
						'font-variant-numeric': 'tabular-nums'
					})
				);
			});
		});
		y = bottom + 40;
	};

	const reach = Math.max(0.1, ...columns.map((c) => Math.abs(c.score)));
	const scoreTop = Math.ceil(reach * 20) / 20;
	panel(
		'Answer quality',
		"Sloppy's score less the other's, on a 0 to 1 scale",
		[-scoreTop, scoreTop],
		scaleLinear().domain([-scoreTop, scoreTop]).ticks(4),
		(v) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`),
		[
			{
				label: 'Score',
				values: columns.map((c) => ({
					id: c.against.id,
					v: c.score,
					said: scoreSaid(c.score)
				}))
			}
		],
		'dot',
		SCORE_LEVEL
	);

	const ratios = columns.flatMap((c) => AGGREGATE_METRICS.map((m) => c.ratio[m] ?? 0));
	const lo = Math.floor(Math.min(-0.1, ...ratios) * 10) / 10;
	const hi = Math.ceil(Math.max(0.1, ...ratios) * 10) / 10;
	panel(
		'What an answer took',
		'Change against the other — lower is better',
		[lo, hi],
		scaleLinear()
			.domain([lo, hi])
			.ticks(Math.round((hi - lo) * 10)),
		(v) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`),
		AGGREGATE_METRICS.map((m) => ({
			label: AGGREGATE_LABEL[m],
			values: columns.map((c) => ({
				id: c.against.id,
				v: c.ratio[m] ?? 0,
				said: ratioSaid(m, c.ratio[m])
			}))
		})),
		'bar'
	);

	const caption = aggregateNote(summary, columns) ?? '';
	for (const line of wrap(caption, 110)) {
		out.push(text(LABEL_X, y, line, t.muted, { 'font-size': 12 }));
		y += 16;
	}
	return {
		svg: svg(
			W,
			y + 4,
			'Sloppy against the docs alone and against subagents, on the large projects',
			out
		),
		caption
	};
}

function crossProjectFigure(summary: PageSummary, t: Theme) {
	const large = new Set(largeProjects(summary));
	const subjects = subjectsWithRuns(summary).filter((s) => large.has(s));
	const xs = xsOf(summary, subjects);
	const metrics: Metric[] = ['score', 'cost'];
	const W = 900;
	const LEFT = 56;
	const RIGHT = W - 190;
	const H = 210;
	const out: string[] = [];
	const x = scalePoint<number>()
		.domain(xs.map((_, i) => i))
		.range([LEFT + 40, RIGHT - 30]);
	let y = 22;

	const legend = approachesRun(summary);
	let lx = LEFT;
	for (const a of legend) {
		out.push(
			`<line x1="${lx}" x2="${lx + 22}" y1="${y - 4}" y2="${y - 4}" stroke="${t.series[a.id]}" stroke-width="${a.width + 0.5}" stroke-linecap="round"${a.dash ? ` stroke-dasharray="${a.dash}"` : ''}/>`
		);
		out.push(text(lx + 30, y, a.label, t.ink));
		lx += 30 + a.label.length * 7.2 + 26;
	}
	y += 30;

	let runs = 0;
	for (const metric of metrics) {
		const series: SeriesData[] = seriesOf(summary, subjects, TIER, metric);
		const { domain, ticks } = axisOf(metric, series);
		out.push(
			text(LEFT - 40, y, chartTitle(metric, domain), t.ink, { 'font-weight': 600, 'font-size': 14 })
		);
		out.push(
			text(RIGHT, y, `${BETTER[metric]} is better`, t.muted, {
				'text-anchor': 'end',
				'font-size': 12
			})
		);
		const top = y + 16;
		const ys = scaleLinear()
			.domain(domain)
			.range([top + H, top]);
		for (const v of ticks)
			out.push(
				`<line x1="${LEFT}" x2="${RIGHT}" y1="${ys(v)}" y2="${ys(v)}" stroke="${t.grid}"${v === domain[0] ? '' : ' stroke-dasharray="2 3"'}/>`,
				text(LEFT - 8, ys(v) + 4, AXIS_FORMAT[metric](v), t.muted, {
					'text-anchor': 'end',
					'font-size': 11
				})
			);
		const drawn = series
			.filter((s) => s.values.some((v) => v !== null))
			.sort((a, b) => DRAW_ORDER.indexOf(a.approach) - DRAW_ORDER.indexOf(b.approach));
		for (const s of drawn) {
			const colour = t.series[s.approach];
			const pts = s.values.flatMap((v, i) => (v ? [[x(i)!, ys(v.v)] as const] : []));
			out.push(
				`<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${colour}" stroke-width="${s.width}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`
			);
			for (const [px, py] of pts)
				out.push(
					`<circle cx="${px}" cy="${py}" r="4" fill="${s.dash ? t.surface : colour}" stroke="${s.dash ? colour : t.surface}" stroke-width="${s.dash ? 1.5 : 1.5}"/>`
				);
		}
		const ends = drawn.map((s) => {
			const i = s.values.findLastIndex((v) => v !== null);
			return { s, i, v: s.values[i]!.v };
		});
		const placed = placeLabels(
			ends.map((e) => ys(e.v)),
			16,
			top,
			top + H
		);
		ends.forEach((e, k) =>
			out.push(
				text(
					RIGHT + 8,
					placed[k] + 4,
					`${e.s.label} ${FORMAT[metric](e.v)}`,
					t.series[e.s.approach],
					{ 'font-size': 12, 'font-weight': 600 }
				)
			)
		);
		if (metric === 'score')
			runs = subjects.reduce(
				(n, subject) =>
					n +
					drawn.reduce(
						(m, s) => m + (groupOf(summary, subject, TIER, approach(s.approach))?.n ?? 0),
						0
					),
				0
			);
		y = top + H + 34;
	}
	y -= 18;
	xs.forEach((p, i) => {
		out.push(text(x(i)!, y, p.labelShort, t.ink, { 'text-anchor': 'middle', 'font-size': 12 }));
		out.push(
			text(x(i)!, y + 15, p.subShort, t.muted, { 'text-anchor': 'middle', 'font-size': 11 })
		);
	});
	y += 40;
	const caption = `Projects, smallest documentation first: ${andList(xs.map((p) => nameOf(summary, p.subject)))}. ${modelOf(summary, TIER) ?? FAMILY[TIER]}, ${count(runs)} runs; Sloppy as it ships.`;
	out.push(text(LEFT - 40, y, caption, t.muted, { 'font-size': 12 }));
	return {
		svg: svg(W, y + 12, 'Answer quality and cost per task across the projects', out),
		caption
	};
}

const { summary, isSample } = loadSummary(false);
if (isSample)
	throw new Error('bench/results/summary.json is missing; run `node bench.mjs export` first.');
mkdirSync(OUT, { recursive: true });
for (const [name, draw] of [
	['aggregate', aggregateFigure],
	['projects', crossProjectFigure]
] as const)
	for (const [mode, theme] of Object.entries(THEMES)) {
		const { svg: drawing, caption } = draw(summary, theme);
		writeFileSync(resolve(OUT, `bench-${name}-${mode}.svg`), drawing);
		if (mode === 'light') console.log(`bench-${name}: ${caption}`);
	}
console.log(`The README's measured line: ${heroLine(summary)}`);

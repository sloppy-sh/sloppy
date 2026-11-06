// The summary is read from disk at build rather than imported, so the server's own bundle carries
// none of it.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { forThePage, type Summary } from '$lib/summary';
import { withoutPrivate } from '../../../../../../bench/lib/private.mjs';
import { HIDDEN, namesHidden } from './private';

/** The builds run from this package's folder. */
const RESULTS = resolve(process.cwd(), '../../../bench/results');
const SAMPLE = resolve(process.cwd(), 'sample/summary.json');

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Summary;

/** A figure's drawing, read at build. */
export const figureSvg = (file: string) => readFileSync(join(RESULTS, file), 'utf8');

let loaded: { summary: Summary; isSample: boolean } | undefined;

/** The subject of each panel a notebook figure titles "<what>: <subject>[ · <backend> / <model>]". */
const panelSubjects = (svg: string) =>
	[...svg.matchAll(/>[^<>:]+: ([^<>·]+?)(?: · [^<>]*)?<\/text>/g)].map((m) => m[1]);

/**
 * The bench's export, or the committed sample where it has not been run. An export made before a
 * subject was marked private is hidden here too, and a figure is left out where it names one or
 * draws a subject the summary does not hold.
 */
function load() {
	if (loaded) return loaded;
	const file = join(RESULTS, 'summary.json');
	const real = existsSync(file) ? readJson(file) : undefined;
	const shown = withoutPrivate(real ?? readJson(SAMPLE), HIDDEN);
	const held = (svg: string) => panelSubjects(svg).every((subject) => subject in shown.subjects);
	const figures = real
		? shown.figures.filter((f) => {
				const svg = figureSvg(f.file);
				return !namesHidden(svg) && held(svg);
			})
		: [];
	return (loaded = { summary: { ...shown, figures }, isSample: !real });
}

export function loadSummary(withRuns: boolean) {
	const { summary, isSample } = load();
	return { summary: forThePage(summary, withRuns), isSample };
}

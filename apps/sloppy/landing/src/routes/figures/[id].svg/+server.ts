import { error } from '@sveltejs/kit';
import { figureSvg, loadSummary } from '$lib/server/summary';
import type { EntryGenerator, RequestHandler } from './$types';

export const prerender = true;

const shipped = () => loadSummary(false).summary.figures;

export const entries: EntryGenerator = () => shipped().map(({ id }) => ({ id }));

export const GET: RequestHandler = ({ params }) => {
	const figure = shipped().find((f) => f.id === params.id);
	if (!figure) error(404, 'No figure has that name.');
	return new Response(figureSvg(figure.file), { headers: { 'content-type': 'image/svg+xml' } });
};

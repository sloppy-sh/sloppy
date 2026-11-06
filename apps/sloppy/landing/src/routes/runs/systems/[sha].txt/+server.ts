import { error, text } from '@sveltejs/kit';
import { longSystems } from '$lib/server/runs';
import type { EntryGenerator, RequestHandler } from './$types';

export const prerender = true;

export const entries: EntryGenerator = () => [...longSystems().keys()].map((sha) => ({ sha }));

export const GET: RequestHandler = ({ params }) => {
	const system = longSystems().get(params.sha);
	if (system === undefined) error(404, 'No run was sent that prompt.');
	return text(system);
};

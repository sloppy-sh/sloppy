import { error, json } from '@sveltejs/kit';
import { runBundle, runIds } from '$lib/server/runs';
import type { EntryGenerator, RequestHandler } from './$types';

export const prerender = true;

export const entries: EntryGenerator = () => runIds().map((id) => ({ id }));

export const GET: RequestHandler = ({ params }) => {
	const bundle = runBundle(params.id);
	if (!bundle) error(404, 'No run has that id.');
	return json(bundle);
};

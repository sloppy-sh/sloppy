import { error, json } from '@sveltejs/kit';
import { questionDetail, questionRows } from '$lib/server/questions';
import type { EntryGenerator, RequestHandler } from './$types';

export const prerender = true;

export const entries: EntryGenerator = () => questionRows().map(({ task }) => ({ task }));

export const GET: RequestHandler = ({ params }) => {
	const detail = questionDetail(params.task);
	if (!detail) error(404, 'No question by that name.');
	return json(detail);
};

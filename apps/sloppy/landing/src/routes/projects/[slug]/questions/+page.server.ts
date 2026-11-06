import { error } from '@sveltejs/kit';
import { questionRows, questionsPage } from '$lib/server/questions';
import type { EntryGenerator, PageServerLoad } from './$types';

const slugs = () => [...new Set(questionRows().map((r) => r.slug))];

export const entries: EntryGenerator = () => slugs().map((slug) => ({ slug }));

export const load: PageServerLoad = ({ params }) => {
	if (!slugs().includes(params.slug)) error(404, 'No project by that name.');
	return { ...questionsPage(params.slug), slug: params.slug };
};

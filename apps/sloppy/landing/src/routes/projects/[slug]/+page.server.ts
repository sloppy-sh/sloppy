import { error } from '@sveltejs/kit';
import { PROJECTS } from '$lib/projects';
import { isSmallRepo } from '$lib/readings';
import { loadSummary } from '$lib/server/summary';
import type { EntryGenerator, PageServerLoad } from './$types';

const ran = () => {
	const { summary } = loadSummary(false);
	return PROJECTS.filter(
		(p) =>
			summary.subjects[p.subject] && !isSmallRepo(p.subject) && !summary.subjects[p.subject].private
	);
};

export const entries: EntryGenerator = () => ran().map(({ slug }) => ({ slug }));

export const load: PageServerLoad = ({ params }) => {
	if (!ran().some((p) => p.slug === params.slug)) error(404, 'No project by that name.');
	return { ...loadSummary(false), slug: params.slug };
};

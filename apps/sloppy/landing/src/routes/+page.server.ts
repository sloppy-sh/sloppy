import { featured } from '$lib/server/featured';
import { loadSummary } from '$lib/server/summary';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const { summary, isSample } = loadSummary(false);
	return { summary, isSample, featured: isSample ? [] : featured(summary) };
};

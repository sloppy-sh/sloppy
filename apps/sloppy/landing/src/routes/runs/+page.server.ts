import { loadSummary } from '$lib/server/summary';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => loadSummary(true);

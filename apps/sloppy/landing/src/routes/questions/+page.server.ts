import { questionsPage } from '$lib/server/questions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => questionsPage();

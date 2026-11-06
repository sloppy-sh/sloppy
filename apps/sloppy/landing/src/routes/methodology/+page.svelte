<script lang="ts">
	import { resolve } from '$app/paths';
	import { BENCH_README, REPORT, SURVEY } from '$lib/links';
	import { PROJECTS } from '$lib/projects';
	import {
		andList,
		approachesRun,
		FAMILY,
		inWords,
		labelOf,
		nameOf,
		runsNote,
		SMALL_REPOS,
		subjectsWithRuns,
		tiersWithRuns
	} from '$lib/readings';
	import PageHead from '$lib/sections/PageHead.svelte';
	import SiteFooter from '$lib/sections/SiteFooter.svelte';
	import SiteHeader from '$lib/sections/SiteHeader.svelte';
	import { count } from '$lib/summary';

	let { data } = $props();
	const summary = $derived(data.summary);

	const projects = $derived(
		subjectsWithRuns(summary).map((subject) => ({
			subject,
			slug: PROJECTS.find((p) => p.subject === subject)?.slug,
			label: labelOf(summary, subject),
			facts: summary.subjects[subject]
		}))
	);
	const approaches = $derived(approachesRun(summary));
	const models = $derived(andList(tiersWithRuns(summary).map((t) => FAMILY[t])));

	const TASKS = [
		['Why', 'explain why the code is built the way it is, from the documents.'],
		['Locate', 'find the files and functions where a rule lives.'],
		['Drift', 'notice code that no longer does what its documents say.'],
		['Brief', 'brief a newcomer, saying where each rule is written.'],
		['Handoff', 'one agent leaves a reason; a second, with no memory of it, needs it.']
	];

	const unpublished = $derived(
		subjectsWithRuns(summary)
			.filter((s) => summary.subjects[s].private)
			.map((s) => `${nameOf(summary, s)}'s`)
	);
	const runs = $derived(runsNote(summary) ?? '');
	const smallRepos = $derived(SMALL_REPOS.map((s) => labelOf(summary, s)));
	const fair = $derived([
		'The judge never sees which approach wrote an answer.',
		'Runs are interleaved in a seeded order, so no approach gets the quiet hour.',
		'Predictions were written down before the runs.',
		`The ${inWords(projects.length)} projects were chosen by written rules: open-source code, and at least 350,000 words of design documents spread over many files.`,
		unpublished.length
			? `Every run and transcript is published, except ${andList(unpublished)}.`
			: 'Every run and transcript is published.'
	]);

	const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;
	const h2 = 'text-2xl font-semibold tracking-tight';
	const link = 'underline underline-offset-2 hover:text-muted-foreground';
</script>

<svelte:head>
	<title>How Sloppy was tested</title>
	<meta
		name="description"
		content="How Sloppy's benchmark was run: the projects, the four approaches, the tasks, how answers were scored and how it was kept fair."
	/>
</svelte:head>

<div class="min-h-dvh bg-background text-foreground">
	<SiteHeader isSample={data.isSample} />
	<main>
		<PageHead trail={[{ label: 'Methodology' }]} title="How we tested.">
			<p>
				Each project's tasks went to Claude Code {inWords(approaches.length)} ways, and every answer was
				scored without knowing which way produced it.
			</p>
		</PageHead>

		<div class="type-body mx-auto max-w-6xl space-y-14 px-4 py-16 sm:px-8 [&>*]:max-w-3xl">
			<section aria-labelledby="projects">
				<h2 id="projects" class={h2}>The projects</h2>
				<div class="mt-5 overflow-x-auto">
					<table class="w-full text-sm tabular-nums">
						<thead class="text-muted-foreground">
							<tr class="border-b">
								<th scope="col" class="py-2 pr-3 text-left font-normal">Project</th>
								<th scope="col" class="px-2 py-2 text-right font-normal">Lines of code</th>
								<th scope="col" class="px-2 py-2 text-right font-normal">Words of docs</th>
								<th scope="col" class="py-2 pl-2 text-right font-normal">Doc files</th>
							</tr>
						</thead>
						<tbody>
							{#each projects as p (p.subject)}
								<tr class="border-b border-border/60">
									<th scope="row" class="py-2 pr-3 text-left font-medium">
										{#if p.slug}
											<a class={link} href={resolve('/projects/[slug]', { slug: p.slug })}
												>{p.label}</a
											>
										{:else}{p.label}{/if}
									</th>
									<td class="px-2 py-2 text-right">{count(p.facts.code_lines)}</td>
									<td class="px-2 py-2 text-right">{count(p.facts.docs_words)}</td>
									<td class="py-2 pl-2 text-right">{count(p.facts.docs_files)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="mt-4">Models: {models}, through Claude Code. {runs}</p>
				<p class="mt-4">
					{cap(inWords(smallRepos.length))} small repositories, {andList(smallRepos)}, were measured
					too. Their docs already reach the answers, so Sloppy did not help there, and they are left
					out of this site;
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- links off this site -->
					<a class={link} href={REPORT}>the report has them</a>.
				</p>
			</section>

			<section aria-labelledby="approaches">
				<h2 id="approaches" class={h2}>{cap(inWords(approaches.length))} approaches</h2>
				<ul class="mt-5 space-y-2">
					{#each approaches as a (a.id)}
						<li><span class="font-semibold">{a.label}:</span> {a.means}</li>
					{/each}
				</ul>
			</section>

			<section aria-labelledby="tasks">
				<h2 id="tasks" class={h2}>{cap(inWords(TASKS.length))} kinds of task</h2>
				<ul class="mt-5 space-y-2">
					{#each TASKS as [name, does] (name)}
						<li><span class="font-semibold">{name}:</span> {does}</li>
					{/each}
				</ul>
			</section>

			<section aria-labelledby="scoring">
				<h2 id="scoring" class={h2}>Scoring</h2>
				<p class="mt-5">
					Every answer is read by a blind judge against a written checklist, and most also get
					automatic checks for the facts or paths a right answer must have. The score, from 0 to 1,
					is the judge's, averaged with the checks where there are any. Tokens, cost and time come
					from each run's own record.
				</p>
			</section>

			<section aria-labelledby="fair">
				<h2 id="fair" class={h2}>Keeping it fair</h2>
				<ul class="mt-5 list-disc space-y-2 pl-5 marker:text-muted-foreground">
					{#each fair as line (line)}
						<li>{line}</li>
					{/each}
				</ul>
			</section>

			<p class="flex flex-wrap gap-x-6 gap-y-2 font-medium">
				<!-- eslint-disable svelte/no-navigation-without-resolve -- links off this site -->
				<a class={link} href={REPORT}>The full write-up</a>
				<a class={link} href={SURVEY}>How projects were chosen</a>
				<a class={link} href={BENCH_README}>The benchmark's code</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
				<a class={link} href={resolve('/runs')}>Every run</a>
			</p>
		</div>
	</main>
	<SiteFooter generatedAt={summary.generated_at} />
</div>

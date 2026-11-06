<script lang="ts">
	import { resolve } from '$app/paths';
	import { APPROACHES } from '$lib/approaches';
	import { BENCH_README, PROVENANCE } from '$lib/links';
	import { labelOf, modelLabel, subjectsWithRuns } from '$lib/readings';
	import { score, type PagePoint, type PageSummary } from '$lib/summary';

	let { summary }: { summary: PageSummary } = $props();

	const figures = $derived(
		summary.figures.map((f) => ({ ...f, url: resolve('/figures/[id].svg', { id: f.id }) }))
	);

	const SHORT: Record<string, string> = {
		...Object.fromEntries(APPROACHES.map((a) => [a.condition, a.label])),
		dump: 'All docs in prompt',
		nodocs: 'Nothing',
		pointed: 'Docs pointed at',
		'mcp+pointed': 'Sloppy, docs pointed at',
		'mcp+agents': 'Sloppy, subagents'
	};
	const conditions = $derived(summary.conditions.map((c) => c.id));

	type Row = Record<string, (PagePoint & { lean: boolean })[]>;

	/** One subject and model's runs by task, then by condition, each in the order it ran. */
	function matrix(subject: string, model: string): [string, Row][] {
		const tasks: Record<string, Row> = {};
		for (const curve of summary.curves.filter((c) => c.subject === subject && c.model === model))
			for (const point of curve.points) {
				const row = (tasks[point.task] ??= {});
				row[curve.condition] = [
					...(row[curve.condition] ?? []),
					{ ...point, lean: curve.config === 'lean' }
				];
			}
		return Object.entries(tasks).sort(([a], [b]) => a.localeCompare(b));
	}

	const sets = $derived(
		subjectsWithRuns(summary).flatMap((subject) =>
			[...new Set(summary.curves.filter((c) => c.subject === subject).map((c) => c.model))]
				.sort()
				.map((model) => ({ subject, model, rows: matrix(subject, model) }))
				.filter((s) => s.rows.length)
		)
	);
	const points = $derived(summary.curves.flatMap((c) => c.points));
	const mixed = $derived(new Set(summary.curves.map((c) => c.config === 'lean')).size > 1);
	const ungraded = $derived(points.some((p) => p.score === null));
	const used = (rows: [string, Row][]) =>
		conditions.filter((c) => rows.some(([, row]) => row[c]?.length));
	const link = 'underline underline-offset-2 hover:text-muted-foreground';
</script>

<div class="mx-auto max-w-6xl px-4 py-12 sm:px-8">
	<ul class="type-body max-w-[65ch] list-disc space-y-3 pl-5 marker:text-muted-foreground">
		<!-- eslint-disable svelte/no-navigation-without-resolve -- links off this site, and figure files -->
		<li>
			<a class={link} href={BENCH_README}>The benchmark</a>: the approaches, the tasks, how an
			answer is graded.
		</li>
		<li>
			<a class={link} href={PROVENANCE}>Who ran what, where and when</a>: one row per batch, with
			the commit each project was at and anything that differed from the protocol.
		</li>
		{#if figures.length}
			<li>
				The notebook's own figures, every approach on every project:
				{#each figures as figure, i (figure.id)}<a class={link} href={figure.url}
						>{figure.title.toLowerCase()}</a
					>{i < figures.length - 1 ? ', ' : '.'}
				{/each}
			</li>
		{/if}
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</ul>

	<p class="mt-10 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
		Each score below is one run: open it for what the agent was sent, its answer, its grades and its
		timings.{#if mixed}
			A score marked L ran with Sloppy as it ships.{/if}{#if ungraded}
			“…” is a run not graded yet.{/if}
	</p>
	<div class="mt-6 space-y-4">
		{#each sets as set (set.subject + set.model)}
			{@const cols = used(set.rows)}
			<details class="max-w-full overflow-hidden rounded-lg border bg-card">
				<summary class="cursor-pointer px-3 py-2 text-sm font-medium">
					{labelOf(summary, set.subject)}, {modelLabel(set.model)}
					<span class="font-normal text-muted-foreground"
						>· {set.rows.reduce((n, [, row]) => n + Object.values(row).flat().length, 0)} runs</span
					>
				</summary>
				<div class="overflow-x-auto border-t">
					<table class="text-xs tabular-nums">
						<thead class="text-muted-foreground">
							<tr class="border-b">
								<th scope="col" class="px-2 py-1.5 text-left font-normal">Task</th>
								{#each cols as condition (condition)}
									<th scope="col" class="px-2 py-1.5 text-left font-normal whitespace-nowrap"
										>{SHORT[condition] ?? condition}</th
									>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each set.rows as [task, row] (task)}
								<tr class="border-b border-border/60">
									<th
										scope="row"
										class="px-2 py-1.5 text-left font-mono font-normal whitespace-nowrap">{task}</th
									>
									{#each cols as condition (condition)}
										<td class="px-2 py-1.5 whitespace-nowrap">
											{#each row[condition] ?? [] as point, i (point.run_id ?? i)}
												{@const label = `${point.score === null ? '…' : score(point.score)}${mixed && point.lean ? ' L' : ''}`}
												{#if point.run_id}
													<a
														class="mr-1.5 underline underline-offset-2 hover:text-muted-foreground"
														href={resolve('/runs/[id].json', { id: point.run_id })}
														download>{label}</a
													>
												{:else}
													<span class="mr-1.5">{label}</span>
												{/if}
											{:else}
												<span class="text-muted-foreground">–</span>
											{/each}
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
		{/each}
	</div>
</div>

<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { APPROACHES } from '$lib/approaches';
	import { seconds, tokens } from '$lib/summary';
	import {
		CONDITIONS,
		FAMILY_LABEL,
		type Answer,
		type Condition,
		type Fact,
		type QuestionDetail,
		type QuestionRow
	} from './types';

	let { rows, labels }: { rows: QuestionRow[]; labels: Record<string, string> } = $props();

	const approachOf = (c: Condition) => APPROACHES.find((a) => a.condition === c)!;

	const FACT: Record<Fact['kind'], string> = {
		missing: 'Facts check, left out:',
		false: 'Facts check, said what is not so; the source says:',
		unnamed: 'Facts check, did not name:'
	};

	const score = (x: number) => x.toFixed(2);
	const gainSaid = (d: number) =>
		Math.abs(d) < 0.0005 ? 'level' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(3)}`;
	const dollars = (x: number | null) => (x === null ? '–' : `$${x.toFixed(2)}`);
	const stepsSaid = (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`;

	/** A handoff's steps under its two sessions; one session's under no heading. */
	function sessionsOf(ans: Answer) {
		const steps = ans.trace ?? [];
		const f = ans.firstSession;
		return f
			? [
					{ title: 'First session', start: 1, steps: steps.slice(0, f) },
					{ title: 'Second session', start: f + 1, steps: steps.slice(f) }
				]
			: [{ title: null, start: 1, steps }];
	}

	onMount(() => {
		const task = decodeURIComponent(location.hash.slice(1));
		const target = task && document.getElementById(task)?.querySelector('details');
		if (target) target.open = true;
	});

	let details: Record<string, QuestionDetail | 'loading' | 'failed'> = $state({});

	async function open(task: string) {
		if (details[task] && details[task] !== 'failed') return;
		details[task] = 'loading';
		try {
			const res = await fetch(resolve('/questions/[task].json', { task }));
			details[task] = res.ok ? ((await res.json()) as QuestionDetail) : 'failed';
		} catch {
			details[task] = 'failed';
		}
	}
</script>

<ol class="divide-y border-y [overflow-wrap:anywhere]">
	{#each rows as row (row.task)}
		<li id={row.task} data-quoted class="scroll-mt-16">
			<details
				class="group"
				ontoggle={(e) => (e.currentTarget as HTMLDetailsElement).open && open(row.task)}
			>
				<summary
					class="grid cursor-pointer list-none gap-3 py-5 [&::-webkit-details-marker]:hidden"
				>
					<span class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
						<span class="text-muted-foreground"
							>{labels[row.project] ?? row.project} · {FAMILY_LABEL[row.family] ?? row.family}</span
						>
						<span class="font-medium tabular-nums">
							Sloppy against docs alone: {gainSaid(row.gain)}
						</span>
					</span>
					<span class="line-clamp-3 group-open:line-clamp-none">{row.question}</span>
					<span class="grid grid-cols-3 gap-3 text-sm">
						{#each CONDITIONS as c (c)}
							{@const a = approachOf(c)}
							<span class="grid gap-1">
								<span class="text-muted-foreground">{a.label}</span>
								<span class="flex items-center gap-2 tabular-nums">
									<span class="font-semibold">{score(row.score[c])}</span>
									<span class="h-1.5 flex-1 rounded-full bg-muted" aria-hidden="true">
										<span
											class="block h-full rounded-full"
											style:width="{row.score[c] * 100}%"
											style:background={a.colour}
										></span>
									</span>
								</span>
							</span>
						{/each}
					</span>
					<span class="text-sm text-muted-foreground underline underline-offset-2 group-open:hidden"
						>Show the answers</span
					>
				</summary>

				<div class="grid grid-cols-1 gap-6 pb-8">
					{#if row.stageA}
						<p class="text-sm text-muted-foreground">
							Before this, another session was asked: “{row.stageA.change}” It alone was told why: {row
								.stageA.reason}
						</p>
					{/if}
					{#if row.why}
						<p class="type-body max-w-[70ch] font-medium">{row.why}</p>
					{/if}
					{#if details[row.task] === 'loading'}
						<p class="text-sm text-muted-foreground">Loading the answers…</p>
					{:else if details[row.task] === 'failed'}
						<p class="text-sm text-muted-foreground">
							The answers did not load. Close and open this question to try again.
						</p>
					{:else if details[row.task]}
						{@const detail = details[row.task] as QuestionDetail}
						<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
							{#each detail.answers as ans (ans.condition)}
								{@const a = approachOf(ans.condition)}
								<article
									class="grid min-w-0 grid-cols-1 content-start gap-3 rounded-lg border bg-card p-4"
								>
									<h3 class="flex items-center gap-2 font-semibold">
										<span
											class="size-2.5 rounded-full"
											style:background={a.colour}
											aria-hidden="true"
										></span>
										{a.label}
									</h3>
									<p class="text-sm text-muted-foreground">
										This run scored {score(ans.score)}, the closest of {row.runs[ans.condition]} to their
										mean of {score(ans.mean)}.
									</p>
									<dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
										<dt class="text-muted-foreground">Tokens read</dt>
										<dd>{tokens(ans.tokensIn)}</dd>
										<dt class="text-muted-foreground">Tokens written</dt>
										<dd>{tokens(ans.tokensOut)}</dd>
										<dt class="text-muted-foreground">Cost</dt>
										<dd>{dollars(ans.costUsd)}</dd>
										<dt class="text-muted-foreground">Time</dt>
										<dd>{seconds(ans.wallS)}</dd>
									</dl>
									{#if ans.trace}
										<details class="rounded-md border">
											<summary class="cursor-pointer px-3 py-2 text-sm font-medium">
												What it did · {stepsSaid(ans.trace.length)}{ans.subagentCalls
													? ` +${ans.subagentCalls} inside helpers`
													: ''}
											</summary>
											<div class="max-h-[24rem] overflow-y-auto border-t py-2 text-sm leading-snug">
												{#each sessionsOf(ans) as session, k (k)}
													{#if session.title}
														<h5 class="px-3 pt-1 text-xs text-muted-foreground">{session.title}</h5>
													{/if}
													<ol
														start={session.start}
														class="list-decimal pr-3 pl-9 marker:text-muted-foreground"
													>
														{#each session.steps as step, i (i)}
															<li class="py-0.5">
																<span class="font-medium">{step.tool}</span>
																{#if step.about}<span class="text-muted-foreground">
																		{step.about}</span
																	>{/if}
															</li>
														{/each}
													</ol>
												{/each}
											</div>
										</details>
									{:else}
										<p class="text-sm text-muted-foreground">
											This run was made before its steps were kept.
										</p>
									{/if}
									<details class="rounded-md border">
										<summary class="cursor-pointer px-3 py-2 text-sm font-medium"
											>The answer</summary
										>
										<div
											class="max-h-[32rem] overflow-y-auto border-t px-3 py-3 text-sm leading-relaxed whitespace-pre-wrap"
										>
											{ans.text}
										</div>
									</details>
									<a
										href={resolve('/runs/[id].json', { id: ans.runId })}
										download
										class="text-sm underline underline-offset-2">Download this run</a
									>
									{#if ans.items.length || ans.facts.length}
										<div class="grid gap-2 text-sm">
											<h4 class="font-medium">How it was graded</h4>
											{#each ans.facts as fact, i (i)}
												<p class="text-muted-foreground">
													{FACT[fact.kind]} “{fact.said}”
												</p>
											{/each}
											<ul class="grid gap-2">
												{#each ans.items as item, i (i)}
													<li class="grid grid-cols-[2.5rem_1fr] gap-2">
														<span class="font-semibold tabular-nums">{item.score}</span>
														<span>
															<span class="block">{item.criterion}</span>
															<span class="block text-muted-foreground">{item.reason}</span>
														</span>
													</li>
												{/each}
											</ul>
										</div>
									{/if}
								</article>
							{/each}
						</div>
					{/if}
				</div>
			</details>
		</li>
	{/each}
</ol>

<script lang="ts">
	let { better }: { better: 'higher' | 'lower' } = $props();
</script>

<span
	class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-foreground"
>
	<span aria-hidden="true">{better === 'higher' ? '↑' : '↓'}</span>
	{better === 'higher' ? 'Higher is better' : 'Lower is better'}
</span>

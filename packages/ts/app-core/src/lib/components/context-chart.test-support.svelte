<script lang="ts">
	// Standing in for the bar under the spend line, so the panel's own test is
	// about WHEN it is mounted and never about how it is drawn.
	import type { ContextUsage } from '@sloppy/types';

	let {
		usage,
		open = $bindable(false)
	}: {
		usage: ContextUsage | null;
		open?: boolean;
	} = $props();
</script>

<p data-slot="context-chart" data-open={open}>
	{usage === null ? 'no count' : `${usage.total} of ${usage.limit}`}
</p>

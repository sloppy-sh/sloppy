// When something happened, in the fewest words that still place it.

const DAY_MS = 86_400_000;

/** A time today, `yesterday`, or a date — the year only where it is not this
 *  one. `iso` is a timestamp as Sloppy's wire carries one. */
export function when(iso: string): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return '';
	const midnight = new Date();
	midnight.setHours(0, 0, 0, 0);
	if (at.getTime() >= midnight.getTime()) {
		return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
	}
	if (at.getTime() >= midnight.getTime() - DAY_MS) return 'yesterday';
	return at.toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'short',
		...(at.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' })
	});
}

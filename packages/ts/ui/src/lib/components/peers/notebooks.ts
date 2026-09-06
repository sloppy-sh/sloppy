// Grouping rows by the notebook their addresses are read in, which is what a
// list reaching more than one has to say — AI.md § "The Address Is the
// Protocol".

/** What decides which notebook a row belongs to, and what names it. */
export interface InNotebook {
	/** Whose notebook it is. Two people's notebooks are two notebooks, however
	 *  they are named. */
	whose?: string;
	/** The notebook itself, as a key and never a label. Absent is a home
	 *  notebook, which is one notebook like any other. */
	graph?: string;
	/** What it is called, where the name reached this surface. */
	notebook?: string;
}

export interface NotebookGroup<T> {
	key: string;
	/** What to head the group with, drawn only where there is more than one. */
	title: string;
	rows: T[];
}

/**
 * Rows by notebook, each group and each row in the order it first appeared. A
 * group whose notebook nobody named is headed `unnamed`, which is the only
 * thing left to tell two of them apart by: the key is an identifier and never
 * reaches a reader.
 */
export function byNotebook<T>(
	rows: readonly T[],
	of: (row: T) => InNotebook,
	unnamed: string
): NotebookGroup<T>[] {
	const groups: NotebookGroup<T>[] = [];
	const at = new Map<string, NotebookGroup<T>>();
	for (const row of rows) {
		const where = of(row);
		const key = `${where.whose ?? ''}\n${where.graph ?? ''}`;
		let group = at.get(key);
		if (!group) {
			group = { key, title: where.notebook || unnamed, rows: [] };
			at.set(key, group);
			groups.push(group);
		}
		group.rows.push(row);
	}
	return groups;
}

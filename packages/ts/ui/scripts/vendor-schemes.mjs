// Regenerates `src/lib/schemes/schemes.json` and `src/lib/schemes/LICENSE-tinted-theming`
// from the Tinted Theming collection — DESIGN.md § Schemes.
//
// Pinned to one commit rather than resolved at build time: a slug is what a
// person's saved look names, so a scheme that was there when they picked it has
// to still be there, spelled the same way, after the collection grows.
//
//   node packages/ts/ui/scripts/vendor-schemes.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const REPOSITORY = 'https://github.com/tinted-theming/schemes';
const COMMIT = 'a70da1dab18008023cfd55a94053f3b6cab4f86e';

const SYSTEMS = { base16: 16, base24: 24 };

const out = fileURLToPath(new URL('../src/lib/schemes/schemes.json', import.meta.url));
const licenceOut = fileURLToPath(
	new URL('../src/lib/schemes/LICENSE-tinted-theming', import.meta.url)
);

function clone() {
	const into = mkdtempSync(join(tmpdir(), 'tinted-schemes-'));
	const git = (...args) => execFileSync('git', ['-C', into, ...args], { stdio: 'pipe' });
	git('init', '-q');
	git('remote', 'add', 'origin', REPOSITORY);
	git('fetch', '-q', '--depth', '1', 'origin', COMMIT);
	git('checkout', '-q', 'FETCH_HEAD');
	const at = git('rev-parse', 'HEAD').toString().trim();
	if (at !== COMMIT) throw new Error(`asked for ${COMMIT} and got ${at}`);
	return into;
}

/** One `key: value` line's value, with the trailing comment the collection
 *  annotates its palettes with taken off an unquoted one. */
function unquote(raw) {
	const trimmed = raw.trim();
	const quoted = /^"([^"]*)"|^'([^']*)'/.exec(trimmed);
	if (quoted) return quoted[1] ?? quoted[2];
	return trimmed.replace(/\s+#.*$/, '').trim();
}

function scalar(text, key) {
	const found = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(text);
	return found ? unquote(found[1]) : null;
}

function paletteOf(text) {
	const palette = {};
	for (const line of text.matchAll(/^[ \t]+(base[0-9A-F]{2}):[ \t]*(.*)$/gm)) {
		const hex = /^#?([0-9a-fA-F]{6})$/.exec(unquote(line[2]));
		if (!hex) throw new Error(`${line[1]} is not a six-digit hex (${line[2]})`);
		palette[line[1]] = `#${hex[1].toLowerCase()}`;
	}
	return palette;
}

function schemeIn(system, file, text) {
	const slug = `${system}-${file.replace(/\.ya?ml$/, '')}`;
	const name = scalar(text, 'name');
	const variant = scalar(text, 'variant');
	if (!name) throw new Error(`${file} names no scheme`);
	if (variant !== 'light' && variant !== 'dark') throw new Error(`${file} variant ${variant}`);
	const palette = paletteOf(text);
	const want = SYSTEMS[system];
	if (Object.keys(palette).length !== want) {
		throw new Error(`${file} carries ${Object.keys(palette).length} of ${want} colours`);
	}
	// `author: ""` is in the collection, so an unattributed scheme is a scheme
	// rather than a parse failure.
	return { system, slug, name, author: scalar(text, 'author') ?? '', variant, palette };
}

/** By name, case-folded, with the slug breaking the ties two systems carrying
 *  the same scheme leave — a codepoint comparison rather than a collation, so
 *  the file is byte-identical whatever ICU the machine has. */
function order(a, b) {
	const key = (one) => `${one.name.toLowerCase()}\u0000${one.slug}`;
	return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
}

const working = clone();
try {
	const collection = [];
	const taken = new Set();
	for (const system of Object.keys(SYSTEMS)) {
		for (const file of readdirSync(join(working, system)).sort()) {
			const scheme = schemeIn(system, file, readFileSync(join(working, system, file), 'utf8'));
			if (taken.has(scheme.slug)) throw new Error(`two schemes at ${scheme.slug}`);
			taken.add(scheme.slug);
			collection.push(scheme);
		}
	}
	collection.sort(order);

	// Formatted here, or the next run leaves a file `format:check` fails on and
	// the person who regenerated it inherits a red build they did not cause.
	writeFileSync(
		out,
		await prettier.format(JSON.stringify(collection), {
			...(await prettier.resolveConfig(out)),
			filepath: out
		})
	);
	writeFileSync(
		licenceOut,
		`The schemes in schemes.json are the Tinted Theming collection, vendored from\n` +
			`${REPOSITORY} at commit ${COMMIT}.\n\n` +
			readFileSync(join(working, 'LICENSE'), 'utf8')
	);

	const byVariant = collection.reduce(
		(count, one) => ({ ...count, [one.variant]: (count[one.variant] ?? 0) + 1 }),
		{}
	);
	console.log(`${collection.length} schemes (${byVariant.light} light, ${byVariant.dark} dark)`);
} finally {
	rmSync(working, { recursive: true, force: true });
}

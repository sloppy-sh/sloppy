// Colour on code — in the writing, and in the sheet that reads a file a note
// points at (DESIGN.md § "An anchor into code"). Nothing here loads until code
// is drawn, so a note with none pays nothing for it.

import { Extension } from '@tiptap/core';
import { createHighlightPlugin, type Parser } from 'prosemirror-highlight';
import { createParser } from 'prosemirror-highlight/shiki';
import type { BundledLanguage, Highlighter } from 'shiki';

/** The same two schemes as the light and dark families; `.shiki` in app.css
 *  is what picks between them. */
const THEMES = { light: 'github-light', dark: 'github-dark' } as const;

let loading: Promise<Highlighter> | null = null;
function highlighter(): Promise<Highlighter> {
	loading ??= import('shiki').then((shiki) =>
		shiki.createHighlighter({
			themes: [THEMES.light, THEMES.dark],
			langs: [],
			engine: shiki.createJavaScriptRegexEngine({ forgiving: true })
		})
	);
	return loading;
}

/** File endings that are neither a grammar's id nor one of its own aliases. */
const ENDINGS: Record<string, string> = {
	h: 'c',
	hh: 'cpp',
	hpp: 'cpp',
	cc: 'cpp',
	cxx: 'cpp',
	ex: 'elixir',
	exs: 'elixir',
	ps1: 'powershell',
	gradle: 'groovy'
};

let names: Promise<Map<string, string>> | null = null;
/** Every name a grammar goes by, to the id it is loaded as. */
function known(): Promise<Map<string, string>> {
	names ??= import('shiki').then(({ bundledLanguagesInfo }) => {
		const map = new Map(Object.entries(ENDINGS));
		for (const info of bundledLanguagesInfo) {
			map.set(info.id, info.id);
			for (const alias of info.aliases ?? []) map.set(alias, info.id);
		}
		return map;
	});
	return names;
}

/** The grammar a name — an id, an alias, a file's ending — stands for; absent
 *  is plain text. */
export async function languageOf(said: string | undefined): Promise<string | undefined> {
	const name = said?.trim().toLowerCase();
	if (!name) return undefined;
	return (await known()).get(name);
}

/** The grammar a file is written in, read off its path; absent is plain text. */
export function languageOfPath(path: string): Promise<string | undefined> {
	const base = path.split('/').at(-1)?.toLowerCase() ?? '';
	const dot = base.lastIndexOf('.');
	return languageOf(dot === -1 ? base : base.slice(dot + 1));
}

async function withGrammar(id: string): Promise<Highlighter> {
	const held = await highlighter();
	if (!held.getLoadedLanguages().includes(id)) await held.loadLanguage(id as BundledLanguage);
	return held;
}

function styleOf(style: string | Record<string, string> | undefined): string {
	if (typeof style === 'string') return style;
	return Object.entries(style ?? {})
		.map(([key, value]) => `${key}:${value}`)
		.join(';');
}

/** One run of text in one colour per scheme, as the style its span carries. */
export interface Coloured {
	text: string;
	style: string;
}

/** Each line of `text` as coloured runs, in the order they read; absent where
 *  the language is one this build has no grammar for. */
export async function colourLines(
	text: string,
	language: string | undefined
): Promise<Coloured[][] | undefined> {
	const id = await languageOf(language);
	if (!id) return undefined;
	const held = await withGrammar(id);
	const { tokens } = held.codeToTokens(text, {
		lang: id as BundledLanguage,
		themes: THEMES,
		defaultColor: false
	});
	return tokens.map((line) =>
		line.map((token) => ({ text: token.content, style: styleOf(token.htmlStyle) }))
	);
}

/** What each name a code block has carried resolved to; `null` is a name no
 *  grammar answers to. */
const resolved = new Map<string, string | null>();

function editorParser(): Parser {
	let held: Highlighter | null = null;
	let parse: Parser | null = null;
	return (options) => {
		const said = options.language?.trim().toLowerCase();
		if (!said) return [];
		const id = resolved.get(said);
		if (id === undefined) {
			return languageOf(said).then((found) => {
				resolved.set(said, found ?? null);
			});
		}
		if (id === null) return [];
		if (!held || !parse) {
			return highlighter().then((ready) => {
				held = ready;
				parse = createParser(ready, { themes: THEMES, defaultColor: false });
			});
		}
		if (!held.getLoadedLanguages().includes(id)) return held.loadLanguage(id as BundledLanguage);
		return parse({ ...options, language: id });
	};
}

/** Colours the code blocks of whatever it is registered on. */
export const Highlighting = Extension.create({
	name: 'highlighting',
	addProseMirrorPlugins() {
		return [
			createHighlightPlugin({
				parser: editorParser(),
				languageExtractor: (node) =>
					typeof node.attrs.language === 'string' ? node.attrs.language : undefined
			})
		];
	}
});

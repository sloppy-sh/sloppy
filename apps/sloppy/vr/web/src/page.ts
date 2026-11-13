// The page's side of the headset: `window.sloppy.render(json)` in, messages
// out through the panel's `window.sloppy.send` where there is one.

import { drawDiagrams } from "./diagrams";
import { noteNamed, staysOnPage } from "./links";
import { isDark, lookProperties } from "./look";
import { toHtml } from "./markdown";
import type { Asked, Said } from "./wire";

export interface Sloppy {
  render(asked: Asked | string): Promise<void>;
  /** Takes a message, or one already written as JSON. */
  send(said: Said | string): void;
}

declare global {
  interface Window {
    /** This page's {@link Sloppy} once booted; before, the panel's own. */
    sloppy?: unknown;
  }
}

/** What carries a message to the headset: the panel's own `send`, which takes
 *  a JSON string, or a log where the page runs in a plain browser. */
function sender(view: Window): (said: Said | string) => void {
  const panel = view.sloppy as { send?: unknown } | undefined;
  const held = panel?.send;
  const toPanel =
    typeof held === "function"
      ? (json: string) => held.call(panel, json)
      : undefined;
  return (said) => {
    const json = typeof said === "string" ? said : JSON.stringify(said);
    if (toPanel) toPanel(json);
    else console.log("sloppy.send", json);
  };
}

/** Sets the page up in `view` around `root` and says it is ready. */
export function boot(view: Window, root: HTMLElement): Sloppy {
  const doc = view.document;
  const send = sender(view);
  let rendering = 0;

  const render = async (asked: Asked | string) => {
    const said: Asked = typeof asked === "string" ? JSON.parse(asked) : asked;
    const markdown = typeof said.markdown === "string" ? said.markdown : "";
    const mine = ++rendering;
    const html = await toHtml({ ...said, markdown }).catch(() => undefined);
    if (mine !== rendering) return;
    const style = doc.documentElement.style;
    for (const [name, value] of Object.entries(lookProperties(said.look)))
      style.setProperty(name, value);
    const dark = isDark(said.look);
    doc.documentElement.toggleAttribute("data-dark", dark);
    if (html === undefined) {
      root.replaceChildren(asWritten(doc, markdown));
      return;
    }
    root.innerHTML = html;
    await drawDiagrams(root, dark);
  };

  doc.addEventListener(
    "click",
    (event) => {
      const a = (event.target as Element | null)?.closest?.("a[href]");
      if (!a) return;
      event.preventDefault();
      const href = a.getAttribute("href") ?? "";
      if (staysOnPage(href)) {
        scrollTo(doc, href.slice(1));
        return;
      }
      send({ kind: "link", href, ...noteNamed(href) });
    },
    true,
  );

  let told = -1;
  const tellHeight = () => {
    const px = Math.ceil(doc.body.getBoundingClientRect().height);
    if (px === told) return;
    told = px;
    send({ kind: "height", px });
  };
  const { ResizeObserver } = view as Window & typeof globalThis;
  new ResizeObserver(tellHeight).observe(doc.body);

  const sloppy: Sloppy = { render, send };
  wear(view, sloppy);
  send({ kind: "ready" });
  return sloppy;
}

/** The panel may have put a `sloppy` of its own on the window that a plain
 *  assignment cannot replace. */
function wear(view: Window, sloppy: Sloppy) {
  view.sloppy = sloppy;
  if (view.sloppy === sloppy) return;
  Object.defineProperty(view, "sloppy", {
    value: sloppy,
    configurable: true,
    writable: true,
  });
}

/** The note as its author wrote it, where it would not render. */
function asWritten(doc: Document, markdown: string): HTMLElement {
  const shown = doc.createElement("pre");
  shown.className = "as-written";
  shown.textContent = markdown;
  return shown;
}

function scrollTo(doc: Document, id: string) {
  let named = id;
  try {
    named = decodeURIComponent(id);
  } catch {}
  doc.getElementById(named)?.scrollIntoView({ block: "start" });
}

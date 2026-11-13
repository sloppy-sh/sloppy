// Drawing the diagrams a rendered note holds, in place, the way the desk draws
// them (packages/ts/ui/src/lib/components/editor/diagrams.ts).

/** Said under a diagram's source where it will not draw. */
export const NOT_DRAWN = "This diagram didn't come out.";

type Mermaid = typeof import("mermaid").default;
let loading: Promise<Mermaid> | null = null;
function mermaid(): Promise<Mermaid> {
  loading ??= import("mermaid").then((module) => module.default);
  return loading;
}

let named = 0;

/** Told nowhere to draw, the renderer leaves what it drew in the body. */
function somewhereToDraw(): HTMLElement {
  const holding = document.createElement("div");
  holding.setAttribute("aria-hidden", "true");
  holding.style.cssText =
    "position:fixed;top:0;left:-10000px;pointer-events:none";
  document.body.append(holding);
  return holding;
}

/** Draws every `figure[data-diagram]` under `root`; one that will not draw
 *  keeps its source and says so. */
export async function drawDiagrams(root: HTMLElement, dark: boolean) {
  const figures = [
    ...root.querySelectorAll<HTMLElement>("figure[data-diagram]"),
  ];
  if (figures.length === 0) return;
  const face = getComputedStyle(root).getPropertyValue("--face-ui");
  // Labels are measured as they are drawn: a face still loading measures wrong.
  const [draw] = await Promise.all([
    mermaid(),
    document.fonts?.load(`16px ${face}`).catch(() => undefined),
  ]);
  draw.initialize({
    startOnLoad: false,
    // The labels are the author's text: this keeps them from being markup.
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: dark ? "dark" : "neutral",
    fontFamily: face,
  });
  for (const figure of figures) {
    if (!figure.isConnected) return;
    const source = figure.textContent ?? "";
    const holding = somewhereToDraw();
    try {
      await draw.parse(source);
      const { svg } = await draw.render(`diagram-${++named}`, source, holding);
      figure.innerHTML = svg;
      figure.dataset.drawn = "";
    } catch {
      const said = document.createElement("figcaption");
      said.textContent = NOT_DRAWN;
      figure.append(said);
    } finally {
      holding.remove();
    }
  }
}

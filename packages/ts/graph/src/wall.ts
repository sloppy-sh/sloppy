// The picture under the field, and the paper laid over it. DESIGN.md
// § "The wallpaper" is the doc of record: it is a ground, so it is drawn beneath
// everything the canvas draws and says nothing about any note.
//
// Plain elements rather than anything in the scene: the canvas clears
// transparent, so a layer behind it composites once and no frame pays for it.

import type { GraphPictures } from "./contract.js";

/** DESIGN.md § Motion. A picture only changes while nobody is looking at it, so
 *  this is what somebody coming back finds already under way. */
const FADE_MS = 200;

type Held = { src: string; release: () => void };

export class WallLayer {
  readonly element: HTMLElement;
  private readonly scrim: HTMLElement;
  private picture: HTMLElement | null = null;
  private held: Held | null = null;
  private wanted: string | null = null;
  private presence = 0;
  /** Bumped on every change, so a picture still arriving when the next one is
   *  asked for is dropped rather than drawn over it. */
  private era = 0;
  private destroyed = false;

  constructor(private readonly reduced: MediaQueryList) {
    this.element = document.createElement("div");
    this.element.dataset.graphWall = "";
    this.element.style.cssText =
      "position:absolute;inset:0;overflow:hidden;pointer-events:none;display:none";
    this.scrim = document.createElement("div");
    this.scrim.style.cssText =
      "position:absolute;inset:0;background:var(--graph-paper)";
    this.element.append(this.scrim);
  }

  /**
   * The picture to draw and how much of it reaches the reader, 0–1 — already
   * bounded by what the ground can carry. A picture that will not resolve or
   * will not decode leaves no wallpaper, which is what `null` draws too.
   */
  show(
    picture: string | null,
    pictures: GraphPictures | undefined,
    presence: number,
  ): void {
    this.presence = presence;
    this.scrim.style.opacity = `${1 - presence}`;
    this.settle();
    if (picture === this.wanted) return;
    // Asked for none of it, with none of it drawn: the bytes would be fetched
    // and decoded to be hidden. `wanted` is left alone, so raising the strength
    // later is a fresh attempt rather than a repeat that early-returns above.
    if (presence === 0 && this.picture === null) return;
    this.wanted = picture;
    this.era += 1;
    if (picture === null || pictures === undefined) {
      this.clear();
      return;
    }
    const mine = this.era;
    void pictures
      .read(picture)
      .then(async (held) => {
        if (held === null) return null;
        if (this.destroyed || mine !== this.era) {
          held.release();
          return null;
        }
        const decoding = new Image();
        decoding.src = held.src;
        try {
          await decoding.decode();
        } catch {
          held.release();
          return null;
        }
        return held;
      })
      .catch(() => null)
      .then((held) => {
        if (this.destroyed || mine !== this.era) {
          held?.release();
          return;
        }
        if (held === null) this.clear();
        else this.lay(held);
      });
  }

  destroy(): void {
    this.destroyed = true;
    this.held?.release();
    this.held = null;
    this.element.remove();
  }

  private settle(): void {
    this.element.style.display =
      this.picture !== null && this.presence > 0 ? "block" : "none";
  }

  /** Nothing is up and nothing is on its way, so the next ask for the same
   *  picture is a fresh attempt and not a repeat of one that never drew. */
  private clear(): void {
    this.wanted = null;
    this.picture?.remove();
    this.picture = null;
    this.held?.release();
    this.held = null;
    this.settle();
  }

  private lay(held: Held): void {
    const next = document.createElement("div");
    next.style.cssText =
      "position:absolute;inset:0;background-position:center;background-size:cover";
    next.style.backgroundImage = `url("${held.src.replace(/["\\]/g, "\\$&")}")`;
    const fading = !this.reduced.matches && this.picture !== null;
    next.style.opacity = fading ? "0" : "1";
    if (fading) next.style.transition = `opacity ${FADE_MS}ms ease-out`;

    const under = this.picture;
    const underHeld = this.held;
    this.element.insertBefore(next, this.scrim);
    this.picture = next;
    this.held = held;
    this.settle();

    // The bytes go with the element that was drawing them, and not before: a
    // picture released while it is still on screen is a picture that blanks.
    const drop = (): void => {
      under?.remove();
      underHeld?.release();
    };
    if (!fading) {
      drop();
      return;
    }
    requestAnimationFrame(() => {
      next.style.opacity = "1";
    });
    setTimeout(drop, FADE_MS * 2);
  }
}

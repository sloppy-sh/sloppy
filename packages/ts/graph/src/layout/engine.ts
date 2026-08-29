// The force pass. One implementation, run either in the worker or on the main
// thread — the fallback has to settle to the same place as the worker, so it
// cannot be a second simulation.

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { LayoutStart } from "./protocol.js";

interface Particle extends SimulationNodeDatum {
  index: number;
  radius: number;
  anchorX: number;
  anchorY: number;
  anchorStrength: number;
}

interface Spring {
  source: number | Particle;
  target: number | Particle;
  distance: number;
  strength: number;
}

const CHARGE_PER_RADIUS = -26;
const CHARGE_REACH = 1800;
const COLLIDE_PADDING = 1.45;
const ALPHA_MIN = 0.008;
const ALPHA_DECAY = 0.026;
const VELOCITY_DECAY = 0.42;
/** Enough for `ALPHA_DECAY` to cross `ALPHA_MIN`, with room for a pinned drag. */
const SETTLE_CAP = 600;
/** The energy a drag runs at, and how far through the edges it reaches. */
const DRAG_ALPHA = 0.18;
const DRAG_REACH = 2;

export class LayoutEngine {
  private readonly particles: Particle[];
  private readonly simulation: Simulation<Particle, Spring>;
  private readonly buffer: Float32Array;
  private readonly neighbours: number[][];
  private frozen: Particle[] = [];
  private frozenAround: number | null = null;

  constructor(start: LayoutStart) {
    this.particles = start.nodes.map((node, index) => ({
      index,
      x: node.x,
      y: node.y,
      radius: node.radius,
      anchorX: node.anchorX,
      anchorY: node.anchorY,
      anchorStrength: node.anchorStrength,
    }));
    this.buffer = new Float32Array(this.particles.length * 2);

    const springs: Spring[] = start.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      distance: edge.distance,
      strength: edge.strength,
    }));

    this.neighbours = this.particles.map(() => []);
    for (const edge of start.edges) {
      this.neighbours[edge.source]?.push(edge.target);
      this.neighbours[edge.target]?.push(edge.source);
    }

    this.simulation = forceSimulation(this.particles)
      .force(
        "genealogy",
        forceLink<Particle, Spring>(springs)
          .id((particle) => particle.index)
          .distance((spring) => spring.distance)
          .strength((spring) => spring.strength),
      )
      .force(
        "repel",
        forceManyBody<Particle>()
          .strength((particle) => CHARGE_PER_RADIUS * particle.radius)
          .distanceMax(CHARGE_REACH)
          .theta(0.9),
      )
      .force(
        "space",
        forceCollide<Particle>()
          .radius((particle) => particle.radius * COLLIDE_PADDING)
          .iterations(1),
      )
      .force(
        "anchorX",
        forceX<Particle>((particle) => particle.anchorX).strength(
          (particle) => particle.anchorStrength,
        ),
      )
      .force(
        "anchorY",
        forceY<Particle>((particle) => particle.anchorY).strength(
          (particle) => particle.anchorStrength,
        ),
      )
      .alphaMin(ALPHA_MIN)
      .alphaDecay(ALPHA_DECAY)
      .velocityDecay(VELOCITY_DECAY)
      .stop();
  }

  get alpha(): number {
    return this.simulation.alpha();
  }

  get settled(): boolean {
    return this.simulation.alpha() < ALPHA_MIN;
  }

  tick(times = 1): void {
    if (this.particles.length === 0) return;
    this.simulation.tick(times);
    if (this.settled) this.thaw();
  }

  /** Ticks until settled, bounded — a caller waiting on this cannot yield. */
  settle(): void {
    if (this.particles.length === 0) return;
    for (let step = 0; step < SETTLE_CAP && !this.settled; step++) {
      this.tick();
    }
  }

  /**
   * Hold one node where a drag put it, or let go of it. A held node keeps its
   * neighbours moving around it, which is what makes a drag read as a drag.
   *
   * A settle stops on a decayed alpha, not on a field with nowhere left to go,
   * so raising alpha again resumes every node's unfinished settle. Everything
   * past {@link DRAG_REACH} edges is held where the reader left it until the
   * field has settled again.
   */
  pin(index: number, x: number, y: number, held: boolean): void {
    const particle = this.particles[index];
    if (!particle) return;
    if (held) {
      this.freezeBeyond(index);
      particle.fx = x;
      particle.fy = y;
      if (this.simulation.alpha() < DRAG_ALPHA) {
        this.simulation.alpha(DRAG_ALPHA);
      }
    } else {
      particle.fx = null;
      particle.fy = null;
    }
  }

  private freezeBeyond(index: number): void {
    if (this.frozenAround === index) return;
    this.thaw();
    const moving = this.within(index, DRAG_REACH);
    for (const particle of this.particles) {
      if (moving.has(particle.index)) continue;
      particle.fx = particle.x ?? 0;
      particle.fy = particle.y ?? 0;
      this.frozen.push(particle);
    }
    this.frozenAround = index;
  }

  private thaw(): void {
    for (const particle of this.frozen) {
      particle.fx = null;
      particle.fy = null;
    }
    this.frozen = [];
    this.frozenAround = null;
  }

  private within(index: number, reach: number): Set<number> {
    const found = new Set([index]);
    let frontier = [index];
    for (let hop = 0; hop < reach && frontier.length > 0; hop++) {
      const next: number[] = [];
      for (const at of frontier) {
        for (const neighbour of this.neighbours[at] ?? []) {
          if (found.has(neighbour)) continue;
          found.add(neighbour);
          next.push(neighbour);
        }
      }
      frontier = next;
    }
    return found;
  }

  /** `[x0, y0, x1, y1, …]`. The array is reused; copy it to keep it. */
  positions(): Float32Array {
    for (const particle of this.particles) {
      this.buffer[particle.index * 2] = particle.x ?? 0;
      this.buffer[particle.index * 2 + 1] = particle.y ?? 0;
    }
    return this.buffer;
  }
}

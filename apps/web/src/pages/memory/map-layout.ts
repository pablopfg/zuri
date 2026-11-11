/**
 * Where each point of the memory map goes: a small force layout, run once and
 * to the end, so the same memories always draw the same map (the captures and
 * the tests depend on it). Linked points pull together, every pair pushes
 * apart, and a weak pull to the middle keeps the loose ones on the page.
 * No library: about two hundred points at most (MEMORY_GRAPH_NODES_MAX).
 */
export interface Point {
  x: number;
  y: number;
}

const ROUNDS = 220;
/** How hard the middle pulls: enough for a group of linked points to take a good share of the map. */
const PULL_IN = 1.5;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Positions inside the unit square (0 to 1 on both axes), by id. */
export function layout(ids: readonly string[], links: readonly { from: string; to: string }[]): Map<string, Point> {
  const n = ids.length;
  const out = new Map<string, Point>();
  if (n === 0) return out;
  if (n === 1) return out.set(ids[0] as string, { x: 0.5, y: 0.5 });
  const index = new Map(ids.map((id, i) => [id, i]));
  // A sunflower to start from: no two points on the same spot, no random numbers.
  const x = ids.map((_, i) => Math.sqrt((i + 0.5) / n) * Math.cos(i * GOLDEN));
  const y = ids.map((_, i) => Math.sqrt((i + 0.5) / n) * Math.sin(i * GOLDEN));
  const pairs = links.flatMap((link) => {
    const a = index.get(link.from);
    const b = index.get(link.to);
    return a === undefined || b === undefined || a === b ? [] : [[a, b] as const];
  });
  const ideal = 1.6 / Math.sqrt(n);
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let round = 0; round < ROUNDS; round++) {
    dx.fill(0);
    dy.fill(0);
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const ux = (x[a] as number) - (x[b] as number);
        const uy = (y[a] as number) - (y[b] as number);
        const d2 = Math.max(ux * ux + uy * uy, 1e-6);
        const push = (ideal * ideal) / d2;
        dx[a] = (dx[a] as number) + ux * push;
        dy[a] = (dy[a] as number) + uy * push;
        dx[b] = (dx[b] as number) - ux * push;
        dy[b] = (dy[b] as number) - uy * push;
      }
    }
    for (const [a, b] of pairs) {
      const ux = (x[a] as number) - (x[b] as number);
      const uy = (y[a] as number) - (y[b] as number);
      // A link rests a little longer than the gap between loose points: room for the names under each one.
      const pull = Math.sqrt(ux * ux + uy * uy) / (ideal * 2.2);
      dx[a] = (dx[a] as number) - ux * pull;
      dy[a] = (dy[a] as number) - uy * pull;
      dx[b] = (dx[b] as number) + ux * pull;
      dy[b] = (dy[b] as number) + uy * pull;
    }
    // Cooling: big steps first, small ones at the end.
    const step = 0.1 * (1 - round / ROUNDS) + 0.002;
    for (let i = 0; i < n; i++) {
      const fx = (dx[i] as number) - (x[i] as number) * PULL_IN;
      const fy = (dy[i] as number) - (y[i] as number) * PULL_IN;
      const size = Math.sqrt(fx * fx + fy * fy) || 1;
      const move = Math.min(size, step) / size;
      x[i] = (x[i] as number) + fx * move;
      y[i] = (y[i] as number) + fy * move;
    }
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, x[i] as number);
    maxX = Math.max(maxX, x[i] as number);
    minY = Math.min(minY, y[i] as number);
    maxY = Math.max(maxY, y[i] as number);
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  for (let i = 0; i < n; i++) out.set(ids[i] as string, { x: ((x[i] as number) - minX) / w, y: ((y[i] as number) - minY) / h });
  return out;
}

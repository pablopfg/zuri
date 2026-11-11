import type { MemoryGraph, MemoryHubKind } from "@zuri/shared";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { layout, type Point } from "./map-layout.ts";

/** Empty border around the points, in pixels: room for a label under the lowest one and for half a name at the sides. */
const PAD = 44;
const padX = (w: number) => Math.min(96, Math.max(PAD, w * 0.16));
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
/** A pointer that moved less than this was a click, not a drag. */
const CLICK_SLACK = 5;
/** A label on the map: the start of the text is enough; the panel has the whole of it. */
const LABEL_MAX = 30;
/**
 * The start of a text, ending at a whole word: a point's name for a screen reader has to contain
 * the words drawn under it (WCAG 2.5.3), and half a word is not one of them.
 */
function cut(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const head = chars.slice(0, max - 1).join("");
  const space = head.lastIndexOf(" ");
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`;
}

/**
 * The map's words, already in the owner's language, and the icons of its buttons: they come
 * from the page, and the map itself knows only points, lines and keys.
 */
export interface MapTexts {
  label: string;
  hint: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
  names: string;
  hubName: (kind: MemoryHubKind, name: string) => string;
  icons: { zoomIn: ReactNode; zoomOut: ReactNode; fit: ReactNode; names: ReactNode };
}

interface View {
  k: number;
  x: number;
  y: number;
}
const HOME: View = { k: 1, x: 0, y: 0 };

type Drag = { kind: "node"; id: string; moved: boolean; startX: number; startY: number } | { kind: "pan"; startX: number; startY: number; view: View };

/**
 * Memória › Mapa (Sinal, S06): the memories as points, with the folders,
 * conversations, tasks and notes they talk about as rings. The points settle
 * on their own; one can be dragged (its neighbours follow a little), the
 * background moves, the wheel and the buttons zoom. Every point is a button
 * with a name: Tab reaches the map once, the arrows walk the points and Enter
 * picks one. Names are the owner's text and only ever SVG text.
 * The list stays the accessible way; nothing here exists only on the map.
 */
export default function MemoryMap({ graph, selected, dimmed, onSelect, texts }: { graph: MemoryGraph; selected: string | null; dimmed: (id: string) => boolean; onSelect: (id: string) => void; texts: MapTexts }) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 640, h: 480 });
  const [view, setView] = useState<View>(HOME);
  const [names, setNames] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [moved, setMoved] = useState<Record<string, Point>>({});
  const drag = useRef<Drag | null>(null);

  const nodes = useMemo(
    () => [
      ...graph.hubs.map((hub) => ({ id: hub.id, hub: hub.kind as MemoryHubKind | null, text: hub.label, category: "" })),
      ...graph.memories.map((memory) => ({ id: memory.id, hub: null as MemoryHubKind | null, text: memory.content, category: memory.category })),
    ],
    [graph],
  );
  const order = nodes.map((node) => node.id).join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the same points and links give the same map, whatever object carries them.
  const settled = useMemo(() => layout(nodes.map((node) => node.id), graph.links), [order, graph.links.length]);
  // A new set of points starts from where the layout puts them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the set of points resets what was dragged.
  useEffect(() => setMoved({}), [order]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: Math.max(el.clientWidth, 200), h: Math.max(el.clientHeight, 200) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const at = (id: string): Point => {
    const unit = moved[id] ?? settled.get(id) ?? { x: 0.5, y: 0.5 };
    return { x: padX(size.w) + unit.x * (size.w - 2 * padX(size.w)), y: PAD + unit.y * (size.h - 2 * PAD) };
  };
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (a: string, b: string) => (map.get(a) ?? map.set(a, new Set()).get(a))?.add(b);
    for (const link of graph.links) {
      add(link.from, link.to);
      add(link.to, link.from);
    }
    return map;
  }, [graph.links]);
  const lit = hover ?? selected;
  const near = (id: string) => lit === id || neighbours.get(lit ?? "")?.has(id) === true;

  /** The pointer in the map's own coordinates, before zoom and pan. */
  const local = (event: { clientX: number; clientY: number }) => {
    const rect = svg.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };
  const zoom = (factor: number, around = { x: size.w / 2, y: size.h / 2 }) =>
    setView((v) => {
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * factor));
      const ratio = k / v.k;
      return { k, x: around.x - (around.x - v.x) * ratio, y: around.y - (around.y - v.y) * ratio };
    });

  // The wheel zooms where the pointer is. React's wheel listener is passive, so this one is set by hand.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `zoom` only reads the size, listed here.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, local(event));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [size.w, size.h]);

  /**
   * The point under the pointer: the nearest one within a fingertip (22 px on the screen at any zoom, a 44 px target).
   * Worked out from the positions, so a crowded map never hands the touch to the point drawn on top.
   */
  function nearest(event: { clientX: number; clientY: number }): string | undefined {
    const p = local(event);
    const x = (p.x - view.x) / view.k;
    const y = (p.y - view.y) / view.k;
    let found: string | undefined;
    let best = 22 / view.k;
    for (const node of nodes) {
      const c = at(node.id);
      const d = Math.hypot(c.x - x, c.y - y);
      if (d <= best) {
        best = d;
        found = node.id;
      }
    }
    return found;
  }

  function down(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const id = nearest(event);
    drag.current = id ? { kind: "node", id, moved: false, startX: event.clientX, startY: event.clientY } : { kind: "pan", startX: event.clientX, startY: event.clientY, view };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current) {
      // Hovering lights a point's links; a touch has no hover.
      if (event.pointerType === "mouse") {
        const over = nearest(event) ?? null;
        if (over !== hover) setHover(over);
      }
      return;
    }
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (current.kind === "pan") {
      setView({ ...current.view, x: current.view.x + dx, y: current.view.y + dy });
      return;
    }
    if (!current.moved && Math.hypot(dx, dy) < CLICK_SLACK) return;
    current.moved = true;
    current.startX = event.clientX;
    current.startY = event.clientY;
    const ux = dx / view.k / (size.w - 2 * padX(size.w));
    const uy = dy / view.k / (size.h - 2 * PAD);
    setMoved((before) => {
      const next = { ...before };
      const shift = (id: string, share: number) => {
        const from = before[id] ?? settled.get(id);
        if (from) next[id] = { x: from.x + ux * share, y: from.y + uy * share };
      };
      shift(current.id, 1);
      // The neighbours come along a little, as if tied by a rubber band.
      for (const other of neighbours.get(current.id) ?? []) shift(other, 0.25);
      return next;
    });
  }
  function up(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (current?.kind === "node" && !current.moved) pick(current.id);
  }
  function pick(id: string) {
    setFocus(id);
    onSelect(id);
  }

  // One Tab stop for the whole map: the point last used, the chosen one, or the first.
  const stop = focus && nodes.some((node) => node.id === focus) ? focus : selected && nodes.some((node) => node.id === selected) ? selected : nodes[0]?.id;
  function key(event: KeyboardEvent<SVGGElement>, id: string) {
    const index = nodes.findIndex((node) => node.id === id);
    const go = (to: number) => {
      const next = nodes[(to + nodes.length) % nodes.length];
      if (!next) return;
      event.preventDefault();
      setFocus(next.id);
      svg.current?.querySelector<SVGGElement>(`[data-node="${CSS.escape(next.id)}"]`)?.focus();
    };
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(id);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") go(index + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") go(index - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(nodes.length - 1);
  }

  const tools = [
    { label: texts.zoomIn, icon: texts.icons.zoomIn, run: () => zoom(1.3) },
    { label: texts.zoomOut, icon: texts.icons.zoomOut, run: () => zoom(1 / 1.3) },
    { label: texts.fit, icon: texts.icons.fit, run: () => setView(HOME) },
  ];

  return (
    <div ref={box} className="zuri-memory-map">
      {/* biome-ignore lint/a11y/useSemanticElements: a <fieldset> can't hold SVG points; the group names the map for the buttons inside it. */}
      <svg ref={svg} role="group" aria-label={texts.label} aria-describedby="zuri-memory-map-hint" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => setHover(null)}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {graph.links.map((link) => {
            const a = at(link.from);
            const b = at(link.to);
            const on = lit !== null && (link.from === lit || link.to === lit);
            return <line key={`${link.from} ${link.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} data-kind={link.kind} data-on={on || undefined} data-off={(lit !== null && !on) || undefined} />;
          })}
          {nodes.map((node) => {
            const p = at(node.id);
            const chosen = selected === node.id;
            const shown = names || node.hub !== null || near(node.id) || focus === node.id;
            const name = node.hub ? texts.hubName(node.hub, node.text) : cut(node.text, 120);
            return (
              // biome-ignore lint/a11y/useSemanticElements: an SVG point can't be a <button>; it has the role, the name, the focus and the keys of one.
              <g
                key={node.id}
                role="button"
                tabIndex={node.id === stop ? 0 : -1}
                aria-label={name}
                aria-pressed={chosen}
                data-node={node.id}
                data-hub={node.hub ?? undefined}
                data-cat={node.category || undefined}
                data-off={(node.hub === null && dimmed(node.id)) || (lit !== null && !near(node.id)) || undefined}
                transform={`translate(${p.x} ${p.y})`}
                onKeyDown={(event) => key(event, node.id)}
                onFocus={() => setFocus(node.id)}
              >
                {/* The touch target, 44 px across: where the focus ring is drawn. The pointer is matched by distance (nearest). */}
                <circle r={22} className="hit" />
                {chosen && <circle r={node.hub ? 19 : 14} className="ring" />}
                <circle r={node.hub ? 13 : 8} className="dot" />
                {shown && (
                  <text y={node.hub ? 30 : 24} textAnchor="middle" data-always={names || chosen || undefined}>
                    {cut(node.text, LABEL_MAX)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <p id="zuri-memory-map-hint" className="sr-only">
        {texts.hint}
      </p>
      <div className="zuri-memory-map-tools">
        {tools.map((tool) => (
          <button key={tool.label} type="button" aria-label={tool.label} title={tool.label} onClick={tool.run}>
            {tool.icon}
          </button>
        ))}
        <button type="button" aria-label={texts.names} title={texts.names} aria-pressed={names} onClick={() => setNames((on) => !on)}>
          {texts.icons.names}
        </button>
      </div>
    </div>
  );
}

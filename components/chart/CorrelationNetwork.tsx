"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

import { chartPalette } from "@/lib/theme";
import { useThemeVersion } from "@/lib/hooks/theme-context";
import { cn } from "@/lib/utils";

/**
 * A force-directed map of what moves with what.
 *
 * Every instrument is a node; every pair whose correlation clears the
 * threshold is a spring pulling them together. Left to settle, the layout
 * arranges itself into the market's actual structure — Indian names cluster,
 * US names cluster, and the handful of instruments that bridge the two end up
 * physically between them. That bridging position is the whole point: it is
 * the thing a correlation *matrix* contains but cannot show you.
 *
 * ── The simulation ────────────────────────────────────────────────────────
 * Three forces, applied per tick:
 *
 *   repulsion  every node pushes every other apart, inverse-square, so nodes
 *              never overlap and unconnected ones drift to the edges
 *   springs    correlated pairs pull together with a rest length that shortens
 *              as correlation rises
 *   centring   a weak pull toward the middle, so the graph cannot wander off
 *              the canvas
 *
 * Velocity is damped each tick and the loop parks once the whole system falls
 * below an energy floor — a settled graph costs no frames.
 */

export interface NetworkNode {
  id: string;
  label: string;
  /** Drives node size — market cap, typically. */
  weight: number;
  region: "IN" | "US" | "GLOBAL";
  changePercent: number;
}

export interface NetworkEdge {
  source: string;
  target: string;
  /** Pearson correlation, −1 to 1. */
  correlation: number;
}

interface Body {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  node: NetworkNode;
}

const REGION_COLOUR: Record<NetworkNode["region"], string> = {
  IN: "#f0a63c",
  US: "#7ba7f0",
  GLOBAL: "#4fd1c5",
};

export function CorrelationNetwork({
  nodes,
  edges,
  height = 460,
  threshold,
  onSelect,
  className,
}: {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  height?: number;
  threshold: number;
  onSelect?: (id: string) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bodiesRef = useRef<Body[]>([]);
  const hoverRef = useRef<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const shouldReduceMotion = useReducedMotion();

  useThemeVersion();
  const palette = chartPalette();

  // Only edges above the threshold participate, and each node's degree decides
  // how prominent it is.
  const active = useMemo(
    () => edges.filter((e) => Math.abs(e.correlation) >= threshold),
    [edges, threshold],
  );

  const degree = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of active) {
      map.set(e.source, (map.get(e.source) ?? 0) + 1);
      map.set(e.target, (map.get(e.target) ?? 0) + 1);
    }
    return map;
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let dpr = 1;
    let raf = 0;
    let destroyed = false;
    let settled = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(rect.width));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();

    // Seed positions on a circle rather than at random: a ring untangles far
    // more reliably than a random cloud, which can start knotted.
    const maxWeight = Math.max(1, ...nodes.map((n) => n.weight));
    bodiesRef.current = nodes.map((node, i) => {
      const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      const spread = Math.min(width, height) * 0.32;
      return {
        id: node.id,
        x: width / 2 + Math.cos(angle) * spread,
        y: height / 2 + Math.sin(angle) * spread,
        vx: 0,
        vy: 0,
        // Square-root scaling: area, not radius, should track weight.
        radius: 6 + Math.sqrt(node.weight / maxWeight) * 14,
        node,
      };
    });

    const byId = new Map(bodiesRef.current.map((b) => [b.id, b]));

    const step = () => {
      const bodies = bodiesRef.current;
      let energy = 0;

      // Repulsion, every pair.
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i]!;
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j]!;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.hypot(dx, dy);
          // Two nodes exactly on top of each other have no direction to
          // separate along; nudge them apart deterministically.
          if (dist < 0.01) {
            dx = (i - j) * 0.5;
            dy = 0.5;
            dist = Math.hypot(dx, dy);
          }
          const minDist = a.radius + b.radius + 6;
          const force = (2600 / (dist * dist)) + (dist < minDist ? (minDist - dist) * 0.9 : 0);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      // Springs along correlated edges.
      for (const edge of active) {
        const a = byId.get(edge.source);
        const b = byId.get(edge.target);
        if (!a || !b) continue;

        const strength = Math.abs(edge.correlation);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(0.01, Math.hypot(dx, dy));
        // Stronger correlation, shorter rest length: tightly-coupled names sit
        // closer together, which is the entire visual grammar of the graph.
        const rest = 190 - strength * 120;
        const force = (dist - rest) * 0.012 * strength;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      // Centring and integration.
      for (const body of bodies) {
        body.vx += (width / 2 - body.x) * 0.004;
        body.vy += (height / 2 - body.y) * 0.004;

        body.vx *= 0.86;
        body.vy *= 0.86;

        body.x += body.vx;
        body.y += body.vy;

        // Keep everything inside the frame.
        body.x = Math.max(body.radius + 2, Math.min(width - body.radius - 2, body.x));
        body.y = Math.max(body.radius + 2, Math.min(height - body.radius - 2, body.y));

        energy += Math.abs(body.vx) + Math.abs(body.vy);
      }

      return energy / Math.max(1, bodies.length);
    };

    const draw = () => {
      const bodies = bodiesRef.current;
      ctx.clearRect(0, 0, width, height);
      const hoverId = hoverRef.current;

      const connected = new Set<string>();
      if (hoverId) {
        for (const e of active) {
          if (e.source === hoverId) connected.add(e.target);
          if (e.target === hoverId) connected.add(e.source);
        }
      }

      // Edges first, so nodes sit on top.
      for (const edge of active) {
        const a = byId.get(edge.source);
        const b = byId.get(edge.target);
        if (!a || !b) continue;

        const involved = !hoverId || edge.source === hoverId || edge.target === hoverId;
        const strength = Math.abs(edge.correlation);

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        // Negative correlation is drawn dashed and red: a pair that moves
        // *opposite* is a different relationship, not a weaker one.
        ctx.setLineDash(edge.correlation < 0 ? [3, 4] : []);
        ctx.strokeStyle = withAlpha(
          edge.correlation < 0 ? palette.down : palette.up,
          (involved ? 0.14 + strength * 0.4 : 0.04) * (hoverId ? 1 : 0.85),
        );
        ctx.lineWidth = 0.6 + strength * 2.2;
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Nodes.
      for (const body of bodies) {
        const dimmed = hoverId != null && body.id !== hoverId && !connected.has(body.id);
        const colour = REGION_COLOUR[body.node.region];

        ctx.globalAlpha = dimmed ? 0.22 : 1;

        // A soft halo makes size differences readable at a glance.
        ctx.beginPath();
        ctx.arc(body.x, body.y, body.radius + 4, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(colour, 0.12);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(body.x, body.y, body.radius, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(colour, body.id === hoverId ? 0.95 : 0.7);
        ctx.fill();
        ctx.strokeStyle = palette.surface;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Labels only where they will not collide into mush.
        if (!dimmed && (body.radius > 9 || body.id === hoverId || (degree.get(body.id) ?? 0) > 2)) {
          ctx.font = '500 10px var(--font-plex-mono), ui-monospace, monospace';
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = palette.pillText;
          ctx.fillText(body.node.label, body.x, body.y + body.radius + 9);
        }

        ctx.globalAlpha = 1;
      }
    };

    const loop = () => {
      if (destroyed) return;
      if (!settled) {
        const energy = step();
        // Park once the system stops moving meaningfully.
        if (energy < 0.05) settled = true;
      }
      draw();
      // Keep ticking while hovering so the highlight stays responsive.
      if (!settled || hoverRef.current) raf = requestAnimationFrame(loop);
      else raf = 0;
    };

    if (shouldReduceMotion) {
      // Run the simulation to convergence without animating it.
      for (let i = 0; i < 320; i++) step();
      draw();
    } else {
      raf = requestAnimationFrame(loop);
    }

    const wake = () => {
      if (raf === 0 && !destroyed) raf = requestAnimationFrame(loop);
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      let found: string | null = null;
      for (const body of bodiesRef.current) {
        if (Math.hypot(body.x - px, body.y - py) <= body.radius + 4) {
          found = body.id;
          break;
        }
      }

      if (found !== hoverRef.current) {
        hoverRef.current = found;
        setHovered(found);
        canvas.style.cursor = found ? "pointer" : "default";
        wake();
      }
    };

    const onPointerLeave = () => {
      hoverRef.current = null;
      setHovered(null);
      wake();
    };

    const onClick = () => {
      if (hoverRef.current && onSelect) onSelect(hoverRef.current);
    };

    const observer = new ResizeObserver(() => {
      resize();
      settled = false;
      wake();
    });
    observer.observe(canvas);

    canvas.addEventListener("pointermove", onPointerMove, { passive: true });
    canvas.addEventListener("pointerleave", onPointerLeave, { passive: true });
    canvas.addEventListener("click", onClick);

    return () => {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("click", onClick);
    };
  }, [nodes, active, degree, height, palette, shouldReduceMotion, onSelect]);

  const hoveredNode = hovered ? nodes.find((n) => n.id === hovered) : null;
  const hoveredLinks = useMemo(() => {
    if (!hovered) return [];
    return active
      .filter((e) => e.source === hovered || e.target === hovered)
      .map((e) => ({
        other: e.source === hovered ? e.target : e.source,
        correlation: e.correlation,
      }))
      .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
      .slice(0, 6);
  }, [hovered, active]);

  return (
    <div className={cn("relative w-full", className)} style={{ height }}>
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />

      {hoveredNode && (
        <div className="pointer-events-none absolute left-3 top-3 w-[210px] rounded-md border border-line-strong bg-ink-850/96 p-3 backdrop-blur-sm">
          <p className="num-mono text-[13px] text-ivory">{hoveredNode.label}</p>
          <p className="label-micro mt-1 text-ivory-40">
            {hoveredNode.region === "IN" ? "India" : hoveredNode.region === "US" ? "United States" : "Crypto"}
          </p>

          {hoveredLinks.length > 0 && (
            <>
              <p className="label-micro mt-3 text-ivory-40">Moves with</p>
              <ul className="mt-1.5 space-y-1">
                {hoveredLinks.map((l) => (
                  <li key={l.other} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="num-mono truncate text-ivory-80">
                      {nodes.find((n) => n.id === l.other)?.label ?? l.other}
                    </span>
                    <span
                      className={cn("num-mono shrink-0", l.correlation >= 0 ? "text-up" : "text-down")}
                    >
                      {l.correlation >= 0 ? "+" : ""}
                      {l.correlation.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {active.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="label-micro text-ivory-40">
            No pairs above {threshold.toFixed(2)} — lower the threshold
          </p>
        </div>
      )}
    </div>
  );
}

function withAlpha(colour: string, alpha: number): string {
  const hex = colour.trim().replace("#", "");
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const m = colour.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})` : colour;
}

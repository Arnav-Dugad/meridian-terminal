"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

/**
 * The hero backdrop.
 *
 * A field of drifting ribbons, warm on one side and cool on the other, that
 * meet and interfere down the middle of the viewport. It is the product thesis
 * rendered as a texture: two markets, one continuous surface, a seam where
 * they overlap.
 *
 * The curves are fractal noise rather than sine waves — sine reads as
 * decoration, layered noise reads as data. Colour is composited with `lighter`
 * so the amber and blue families genuinely mix where they cross instead of one
 * painting over the other, which is what produces the pale seam at the
 * meridian without a single hand-placed gradient stop.
 *
 * Cost control: the loop runs at a capped 30fps, pauses entirely when the
 * section scrolls out of view or the tab is hidden, and renders exactly one
 * frame under `prefers-reduced-motion`.
 */

const RIBBON_COUNT = 11;
const TARGET_FPS = 30;

interface Ribbon {
  seed: number;
  y: number;
  amplitude: number;
  frequency: number;
  speed: number;
  width: number;
  warm: number;
  alpha: number;
}

function latticeNoise(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 4294967295) * 2 - 1;
}

function valueNoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = latticeNoise(seed, i);
  const b = latticeNoise(seed, i + 1);
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

function fbm(seed: number, x: number): number {
  return (
    valueNoise(seed, x) * 0.55 +
    valueNoise(seed + 101, x * 2.07) * 0.27 +
    valueNoise(seed + 211, x * 4.13) * 0.13 +
    valueNoise(seed + 331, x * 8.31) * 0.05
  );
}

export function MeridianField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let running = true;
    let lastFrame = 0;
    let destroyed = false;

    // Pointer influence, eased toward the target so the field never snaps.
    const pointer = { x: 0.5, y: 0.5 };
    const eased = { x: 0.5, y: 0.5 };

    const ribbons: Ribbon[] = Array.from({ length: RIBBON_COUNT }, (_, i) => {
      const t = i / (RIBBON_COUNT - 1);
      return {
        seed: 1013 + i * 7919,
        y: 0.12 + t * 0.78,
        amplitude: 0.035 + Math.abs(0.5 - t) * 0.13,
        frequency: 1.1 + t * 1.9,
        speed: 0.008 + t * 0.017,
        width: 1 + (1 - Math.abs(0.5 - t) * 2) * 1.5,
        // Warmth crosses over mid-field: the top runs amber, the bottom blue.
        warm: 1 - t,
        alpha: 0.10 + (1 - Math.abs(0.5 - t) * 2) * 0.18,
      };
    });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);

      eased.x += (pointer.x - eased.x) * 0.045;
      eased.y += (pointer.y - eased.y) * 0.045;

      const t = time / 1000;
      const step = Math.max(6, Math.floor(width / 130));

      ctx.globalCompositeOperation = "lighter";

      for (const r of ribbons) {
        const parallax = (eased.x - 0.5) * 44 * (0.4 + r.warm);
        const lift = (eased.y - 0.5) * 26 * (0.5 + r.frequency * 0.2);

        ctx.beginPath();
        for (let px = -step; px <= width + step; px += step) {
          const nx = (px / Math.max(width, 1)) * r.frequency;
          const n = fbm(r.seed, nx * 2.4 + t * r.speed * 6);
          const y = r.y * height + n * r.amplitude * height + lift;
          const x = px + parallax * (0.2 + n * 0.5);
          if (px <= 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        // Warm-to-cool along the ribbon's own length, so no two lines share a
        // gradient and the field never looks like a repeated asset.
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        const warm = `240, 166, 60`;
        const cool = `123, 167, 240`;
        gradient.addColorStop(0, `rgba(${r.warm > 0.5 ? warm : cool}, 0)`);
        gradient.addColorStop(0.28, `rgba(${warm}, ${r.alpha * r.warm})`);
        gradient.addColorStop(0.55, `rgba(244, 242, 236, ${r.alpha * 0.5})`);
        gradient.addColorStop(0.78, `rgba(${cool}, ${r.alpha * (1 - r.warm)})`);
        gradient.addColorStop(1, `rgba(${r.warm > 0.5 ? warm : cool}, 0)`);

        ctx.strokeStyle = gradient;
        ctx.lineWidth = r.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
      }

      ctx.globalCompositeOperation = "source-over";
    };

    const loop = (now: number) => {
      if (destroyed) return;
      if (running && now - lastFrame >= 1000 / TARGET_FPS) {
        lastFrame = now;
        draw(now);
      }
      raf = requestAnimationFrame(loop);
    };

    const onPointerMove = (e: PointerEvent) => {
      pointer.x = e.clientX / window.innerWidth;
      pointer.y = e.clientY / window.innerHeight;
    };

    const onVisibility = () => {
      running = document.visibilityState === "visible";
    };

    resize();

    if (shouldReduceMotion) {
      draw(0);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        running = entry?.isIntersecting ?? false;
      },
      { threshold: 0 },
    );
    observer.observe(canvas);

    const resizeObserver = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    resizeObserver.observe(canvas);

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(loop);

    return () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [shouldReduceMotion]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}

import type { Candle } from "@/lib/twelvedata/types";
import type { MaybeNumber } from "@/lib/analytics/indicators";
import { chartPalette } from "@/lib/theme";

/**
 * The price chart renderer.
 *
 * Written against Canvas2D rather than pulled from a charting library, for
 * three reasons that all show up on screen:
 *
 *  1. Range switches morph. Every library redraws; here the outgoing series is
 *     resampled to the incoming one's length and interpolated, so 1M to 1Y is
 *     a continuous deformation of the same curve rather than a flash.
 *  2. The render loop is demand-driven. It runs only while an animation is in
 *     flight or the pointer is moving, then parks. An idle chart costs zero
 *     frames, which is what makes ten of them on one dashboard viable.
 *  3. Device-pixel-ratio handling is exact, and every stroke is snapped to the
 *     physical pixel grid. Half-pixel gridlines are the single clearest tell
 *     that a chart was not drawn carefully.
 *
 * The engine owns pixels only. Tooltips and legends are React, positioned from
 * the hover callback, so text stays selectable and screen-readable.
 */

export type ChartStyle = "area" | "candles";

export interface OverlaySeries {
  id: string;
  values: MaybeNumber[];
  color: string;
  width?: number;
  dashed?: boolean;
  /** Fills to the paired series — used for the Bollinger channel. */
  fillTo?: string;
  fillOpacity?: number;
}

export interface ChartHover {
  index: number;
  candle: Candle;
  /** Position in CSS pixels, relative to the canvas. */
  x: number;
  y: number;
}

/**
 * A dated event drawn on the time axis.
 *
 * The reason this exists: a stock going ex-dividend drops by roughly the
 * dividend on the open, and a split rebases the whole series. Both look
 * identical to a crash on a bare price chart. Marking them where the drop
 * happens makes the chart explain itself.
 */
export interface ChartEvent {
  /** Epoch milliseconds. */
  t: number;
  /** Single character drawn in the marker — D for dividend, S for split. */
  glyph: string;
  label: string;
  color: string;
}

export interface ChartOptions {
  style: ChartStyle;
  showVolume: boolean;
  showGrid: boolean;
  events?: ChartEvent[];
  /** Baseline for the area gradient — the previous close, typically. */
  baseline?: number | null;
  overlays?: OverlaySeries[];
  levels?: { price: number; label: string; color: string; dashed?: boolean }[];
  onHover?: (hover: ChartHover | null) => void;
  /** Format a price for the axis. */
  formatPrice?: (value: number) => string;
  /** Format a timestamp for the axis. */
  formatTime?: (t: number, interval: "intraday" | "daily") => string;
  intraday?: boolean;
  /** Suppress entrance and morph animation. */
  reducedMotion?: boolean;
}

/**
 * Canvas has no cascade, so the palette is resolved from the CSS custom
 * properties on every draw. `chartPalette()` memoises per theme, making this a
 * map lookup rather than a `getComputedStyle` call per frame — and it means a
 * theme switch repaints the chart correctly with no code here knowing that
 * themes exist.
 */
type Palette = ReturnType<typeof chartPalette>;

/** Gutters, in CSS pixels. */
const PAD = { top: 14, right: 62, bottom: 26, left: 8 };
const VOLUME_FRACTION = 0.17;
const AXIS_FONT = '500 10px var(--font-mono, ui-monospace), ui-monospace, monospace';

const EASE_EXPO = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

export class ChartEngine {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private width = 0;
  private height = 0;

  private candles: Candle[] = [];
  /** The frame currently being drawn — interpolated during a transition. */
  private frame: Candle[] = [];
  private from: Candle[] = [];
  private options: ChartOptions;

  private animStart = 0;
  private animDuration = 0;
  private animating = false;
  private rafId: number | null = null;

  private pointer: { x: number; y: number } | null = null;
  private hoverIndex: number | null = null;
  private lastHoverEmitted: number | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;

  /** Re-resolved at the top of every draw; cached per theme upstream. */
  private palette: Palette = chartPalette();

  constructor(
    private canvas: HTMLCanvasElement,
    options: ChartOptions,
  ) {
    const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    this.options = options;

    this.observeResize();
    this.attachPointer();
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────────── */

  private observeResize() {
    const parent = this.canvas.parentElement ?? this.canvas;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(parent);
    this.resize();
  }

  resize() {
    if (this.destroyed) return;
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (w === this.width && h === this.height && dpr === this.dpr) return;

    this.width = w;
    this.height = h;
    this.dpr = dpr;

    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.draw();
  }

  destroy() {
    this.destroyed = true;
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    this.detachPointer();
  }

  /* ── Data ───────────────────────────────────────────────────────────────── */

  setOptions(options: Partial<ChartOptions>) {
    this.options = { ...this.options, ...options };
    this.draw();
  }

  /**
   * Install a new series. When the previous one is non-empty the chart morphs
   * between them, resampling the outgoing series onto the incoming index space
   * so ranges of different lengths still interpolate one-to-one.
   */
  setData(candles: Candle[], { animate = true }: { animate?: boolean } = {}) {
    const previous = this.frame.length ? this.frame : this.candles;
    this.candles = candles;

    const shouldAnimate =
      animate && !this.options.reducedMotion && previous.length > 1 && candles.length > 1;

    if (!shouldAnimate) {
      this.frame = candles;
      this.from = candles;
      this.animating = false;
      this.draw();
      return;
    }

    this.from = resample(previous, candles.length, candles);
    this.frame = this.from;
    this.animStart = performance.now();
    // Longer series get a slightly longer morph; it reads as weight.
    this.animDuration = candles.length > 200 ? 760 : 620;
    this.animating = true;
    this.requestFrame();
  }

  /** Update only the most recent candle — the live-tick path, no morph. */
  updateLast(candle: Candle) {
    if (this.candles.length === 0) return;
    this.candles[this.candles.length - 1] = candle;
    if (!this.animating) {
      this.frame = this.candles;
      this.draw();
    }
  }

  /* ── Pointer ────────────────────────────────────────────────────────────── */

  private onPointerMove = (e: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.draw();
  };

  private onPointerLeave = () => {
    this.pointer = null;
    this.hoverIndex = null;
    if (this.lastHoverEmitted !== null) {
      this.lastHoverEmitted = null;
      this.options.onHover?.(null);
    }
    this.draw();
  };

  private attachPointer() {
    this.canvas.addEventListener("pointermove", this.onPointerMove, { passive: true });
    this.canvas.addEventListener("pointerleave", this.onPointerLeave, { passive: true });
    this.canvas.addEventListener("pointercancel", this.onPointerLeave, { passive: true });
  }

  private detachPointer() {
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("pointercancel", this.onPointerLeave);
  }

  /* ── Loop ───────────────────────────────────────────────────────────────── */

  private requestFrame() {
    if (this.rafId != null || this.destroyed) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.step();
    });
  }

  private step() {
    if (this.destroyed) return;
    if (this.animating) {
      const elapsed = performance.now() - this.animStart;
      const t = Math.min(1, elapsed / this.animDuration);
      const eased = EASE_EXPO(t);
      this.frame = interpolate(this.from, this.candles, eased);
      if (t >= 1) {
        this.animating = false;
        this.frame = this.candles;
      }
    }
    this.draw();
    if (this.animating) this.requestFrame();
  }

  /* ── Drawing ────────────────────────────────────────────────────────────── */

  private draw() {
    if (this.destroyed || this.width === 0 || this.height === 0) return;
    const { ctx } = this;
    this.palette = chartPalette();
    const data = this.frame.length ? this.frame : this.candles;

    ctx.clearRect(0, 0, this.width, this.height);
    if (data.length < 2) {
      this.drawEmpty();
      return;
    }

    const plot = this.plotRect();
    const scale = this.priceScale(data, plot);

    if (this.options.showGrid) this.drawGrid(plot, scale);
    if (this.options.showVolume) this.drawVolume(data, plot);

    this.drawLevels(plot, scale);
    this.drawOverlayFills(plot, scale, data.length);

    if (this.options.style === "candles") this.drawCandles(data, plot, scale);
    else this.drawArea(data, plot, scale);

    this.drawOverlayLines(plot, scale, data.length);
    this.drawEvents(data, plot);
    this.drawPriceAxis(plot, scale);
    this.drawTimeAxis(data, plot);
    this.drawLastMarker(data, plot, scale);
    this.drawCrosshair(data, plot, scale);
  }

  private drawEmpty() {
    const { ctx } = this;
    ctx.save();
    ctx.font = AXIS_FONT;
    ctx.fillStyle = this.palette.textDim;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("NO DATA", this.width / 2, this.height / 2);
    ctx.restore();
  }

  private plotRect() {
    const volumeH = this.options.showVolume ? (this.height - PAD.top - PAD.bottom) * VOLUME_FRACTION : 0;
    return {
      x: PAD.left,
      y: PAD.top,
      w: Math.max(1, this.width - PAD.left - PAD.right),
      h: Math.max(1, this.height - PAD.top - PAD.bottom - volumeH),
      volumeY: this.height - PAD.bottom - volumeH,
      volumeH,
    };
  }

  private priceScale(data: Candle[], plot: ReturnType<typeof this.plotRect>) {
    let min = Infinity;
    let max = -Infinity;

    const useWicks = this.options.style === "candles";
    for (const c of data) {
      const lo = useWicks ? c.l : c.c;
      const hi = useWicks ? c.h : c.c;
      if (lo < min) min = lo;
      if (hi > max) max = hi;
    }

    // Overlays must fit inside the frame or a Bollinger band clips at the edge.
    for (const o of this.options.overlays ?? []) {
      for (const v of o.values) {
        if (v == null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    for (const l of this.options.levels ?? []) {
      if (l.price < min) min = l.price;
      if (l.price > max) max = l.price;
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0;
      max = 1;
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }

    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;

    const toY = (price: number) => plot.y + plot.h - ((price - min) / (max - min)) * plot.h;
    const toPrice = (y: number) => min + ((plot.y + plot.h - y) / plot.h) * (max - min);
    return { min, max, toY, toPrice };
  }

  private xAt(index: number, count: number, plot: { x: number; w: number }) {
    if (count <= 1) return plot.x + plot.w / 2;
    return plot.x + (index / (count - 1)) * plot.w;
  }

  /** Snap to the physical pixel grid so hairlines stay hairlines. */
  private snap(v: number) {
    return Math.round(v * this.dpr) / this.dpr + 0.5 / this.dpr;
  }

  private drawGrid(plot: ReturnType<typeof this.plotRect>, scale: ReturnType<typeof this.priceScale>) {
    const { ctx } = this;
    const ticks = niceTicks(scale.min, scale.max, Math.max(3, Math.floor(plot.h / 52)));

    ctx.save();
    ctx.strokeStyle = this.palette.grid;
    ctx.lineWidth = 1 / this.dpr;
    ctx.beginPath();
    for (const t of ticks) {
      const y = this.snap(scale.toY(t));
      if (y < plot.y - 1 || y > plot.y + plot.h + 1) continue;
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.w, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawArea(
    data: Candle[],
    plot: ReturnType<typeof this.plotRect>,
    scale: ReturnType<typeof this.priceScale>,
  ) {
    const { ctx } = this;
    const first = data[0]!.c;
    const lastC = data[data.length - 1]!.c;
    const rising = lastC >= first;
    const stroke = rising ? this.palette.up : this.palette.down;

    ctx.save();

    // Fill.
    ctx.beginPath();
    ctx.moveTo(this.xAt(0, data.length, plot), scale.toY(data[0]!.c));
    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(this.xAt(i, data.length, plot), scale.toY(data[i]!.c));
    }
    ctx.lineTo(plot.x + plot.w, plot.y + plot.h);
    ctx.lineTo(plot.x, plot.y + plot.h);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.h);
    gradient.addColorStop(0, withAlpha(stroke, 0.26));
    gradient.addColorStop(0.55, withAlpha(stroke, 0.07));
    gradient.addColorStop(1, withAlpha(stroke, 0));
    ctx.fillStyle = gradient;
    ctx.fill();

    // Stroke, with a soft bloom underneath. Two passes are cheaper and cleaner
    // than a shadowBlur, which blurs the fill too.
    ctx.beginPath();
    ctx.moveTo(this.xAt(0, data.length, plot), scale.toY(data[0]!.c));
    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(this.xAt(i, data.length, plot), scale.toY(data[i]!.c));
    }
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.strokeStyle = withAlpha(stroke, 0.20);
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.restore();
  }

  private drawCandles(
    data: Candle[],
    plot: ReturnType<typeof this.plotRect>,
    scale: ReturnType<typeof this.priceScale>,
  ) {
    const { ctx } = this;
    const slot = plot.w / data.length;
    const body = Math.max(1, Math.min(11, slot * 0.66));
    const half = body / 2;
    const thin = slot < 2.4;

    ctx.save();
    ctx.lineWidth = Math.max(1 / this.dpr, Math.min(1.4, slot * 0.14));

    for (let i = 0; i < data.length; i++) {
      const c = data[i]!;
      const x = this.xAt(i, data.length, plot);
      const up = c.c >= c.o;
      const color = up ? this.palette.up : this.palette.down;

      // Below ~2px per slot, bodies collapse into noise; draw the range only.
      if (thin) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(this.snap(x), scale.toY(c.h));
        ctx.lineTo(this.snap(x), scale.toY(c.l));
        ctx.stroke();
        continue;
      }

      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(this.snap(x), scale.toY(c.h));
      ctx.lineTo(this.snap(x), scale.toY(c.l));
      ctx.stroke();

      const yOpen = scale.toY(c.o);
      const yClose = scale.toY(c.c);
      const top = Math.min(yOpen, yClose);
      const height = Math.max(1, Math.abs(yClose - yOpen));

      // Hollow bodies for up bars: the convention on institutional terminals,
      // and it keeps a green wall from flattening into a solid block.
      if (up) {
        ctx.fillStyle = withAlpha(color, 0.18);
        ctx.fillRect(x - half, top, body, height);
        ctx.strokeRect(x - half, top, body, height);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(x - half, top, body, height);
      }
    }
    ctx.restore();
  }

  private drawVolume(data: Candle[], plot: ReturnType<typeof this.plotRect>) {
    const { ctx } = this;
    if (plot.volumeH <= 0) return;

    let maxV = 0;
    for (const c of data) if (c.v > maxV) maxV = c.v;
    if (maxV <= 0) return;

    const slot = plot.w / data.length;
    const barW = Math.max(1, slot * 0.62);

    ctx.save();
    for (let i = 0; i < data.length; i++) {
      const c = data[i]!;
      const h = (c.v / maxV) * plot.volumeH * 0.92;
      const x = this.xAt(i, data.length, plot) - barW / 2;
      ctx.fillStyle = withAlpha(c.c >= c.o ? this.palette.up : this.palette.down, 0.26);
      ctx.fillRect(x, plot.volumeY + plot.volumeH - h, barW, h);
    }
    ctx.restore();
  }

  private drawOverlayFills(
    plot: ReturnType<typeof this.plotRect>,
    scale: ReturnType<typeof this.priceScale>,
    count: number,
  ) {
    const overlays = this.options.overlays ?? [];
    const { ctx } = this;

    for (const o of overlays) {
      if (!o.fillTo) continue;
      const partner = overlays.find((p) => p.id === o.fillTo);
      if (!partner) continue;

      ctx.save();
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < count; i++) {
        const v = o.values[i];
        if (v == null) continue;
        const x = this.xAt(i, count, plot);
        const y = scale.toY(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      for (let i = count - 1; i >= 0; i--) {
        const v = partner.values[i];
        if (v == null) continue;
        ctx.lineTo(this.xAt(i, count, plot), scale.toY(v));
      }
      ctx.closePath();
      ctx.fillStyle = withAlpha(o.color, o.fillOpacity ?? 0.06);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawOverlayLines(
    plot: ReturnType<typeof this.plotRect>,
    scale: ReturnType<typeof this.priceScale>,
    count: number,
  ) {
    const { ctx } = this;
    for (const o of this.options.overlays ?? []) {
      ctx.save();
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.width ?? 1.2;
      ctx.lineJoin = "round";
      if (o.dashed) ctx.setLineDash([3, 4]);

      ctx.beginPath();
      let started = false;
      for (let i = 0; i < count; i++) {
        const v = o.values[i];
        if (v == null) {
          started = false;
          continue;
        }
        const x = this.xAt(i, count, plot);
        const y = scale.toY(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawLevels(
    plot: ReturnType<typeof this.plotRect>,
    scale: ReturnType<typeof this.priceScale>,
  ) {
    const { ctx } = this;
    for (const level of this.options.levels ?? []) {
      const y = this.snap(scale.toY(level.price));
      if (y < plot.y || y > plot.y + plot.h) continue;

      ctx.save();
      ctx.strokeStyle = withAlpha(level.color, 0.5);
      ctx.lineWidth = 1 / this.dpr;
      if (level.dashed !== false) ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.w, y);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.font = AXIS_FONT;
      ctx.fillStyle = withAlpha(level.color, 0.75);
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(level.label, plot.x + 6, y - 3);
      ctx.restore();
    }
  }

  /**
   * Corporate actions on the time axis.
   *
   * Each event is snapped to the nearest bar rather than interpolated, so the
   * marker sits on the session the drop actually happened in. Events outside
   * the visible range are skipped, which is why switching to a shorter range
   * quietly removes them instead of bunching them at the edge.
   */
  private drawEvents(data: Candle[], plot: ReturnType<typeof this.plotRect>) {
    const events = this.options.events;
    if (!events || events.length === 0 || data.length < 2) return;

    const { ctx } = this;
    const first = data[0]!.t;
    const last = data[data.length - 1]!.t;
    const baseline = plot.y + plot.h;

    ctx.save();
    for (const event of events) {
      if (event.t < first || event.t > last) continue;

      // Nearest bar by time. A binary search is overkill for a handful of
      // events against a few hundred bars.
      let index = 0;
      let best = Infinity;
      for (let i = 0; i < data.length; i++) {
        const d = Math.abs(data[i]!.t - event.t);
        if (d < best) {
          best = d;
          index = i;
        }
      }

      const x = this.snap(this.xAt(index, data.length, plot));

      ctx.strokeStyle = withAlpha(event.color, 0.34);
      ctx.lineWidth = 1 / this.dpr;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, baseline);
      ctx.stroke();
      ctx.setLineDash([]);

      // A small filled disc at the foot of the line, with its initial inside.
      ctx.beginPath();
      ctx.arc(x, baseline + 1, 6, 0, Math.PI * 2);
      ctx.fillStyle = event.color;
      ctx.fill();
      ctx.strokeStyle = this.palette.surface;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.font = '600 8px var(--font-plex-mono), ui-monospace, monospace';
      ctx.fillStyle = this.palette.surface;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(event.glyph, x, baseline + 1.5);
    }
    ctx.restore();
  }

  private drawPriceAxis(
    plot: ReturnType<typeof this.plotRect>,
    scale: ReturnType<typeof this.priceScale>,
  ) {
    const { ctx } = this;
    const ticks = niceTicks(scale.min, scale.max, Math.max(3, Math.floor(plot.h / 52)));
    const fmt = this.options.formatPrice ?? ((v: number) => v.toFixed(2));

    ctx.save();
    ctx.font = AXIS_FONT;
    ctx.fillStyle = this.palette.textDim;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    for (const t of ticks) {
      const y = scale.toY(t);
      if (y < plot.y - 1 || y > plot.y + plot.h + 1) continue;
      ctx.fillText(fmt(t), plot.x + plot.w + 8, y);
    }
    ctx.restore();
  }

  private drawTimeAxis(data: Candle[], plot: ReturnType<typeof this.plotRect>) {
    const { ctx } = this;
    const fmt =
      this.options.formatTime ??
      ((t: number) => new Date(t).toLocaleDateString(undefined, { day: "2-digit", month: "short" }));

    // Aim for a label roughly every 92px, then round to a whole stride.
    const target = Math.max(2, Math.floor(plot.w / 92));
    const stride = Math.max(1, Math.floor(data.length / target));

    ctx.save();
    ctx.font = AXIS_FONT;
    ctx.fillStyle = this.palette.textDim;
    ctx.textBaseline = "top";

    for (let i = 0; i < data.length; i += stride) {
      const x = this.xAt(i, data.length, plot);
      // Keep the first and last labels inside the frame.
      ctx.textAlign = i === 0 ? "left" : x > plot.x + plot.w - 40 ? "right" : "center";
      ctx.fillText(fmt(data[i]!.t, this.options.intraday ? "intraday" : "daily"), x, this.height - PAD.bottom + 8);
    }
    ctx.restore();
  }

  private drawLastMarker(
    data: Candle[],
    plot: ReturnType<typeof this.plotRect>,
    scale: ReturnType<typeof this.priceScale>,
  ) {
    if (this.options.style !== "area") return;
    const { ctx } = this;
    const last = data[data.length - 1]!;
    const first = data[0]!.c;
    const color = last.c >= first ? this.palette.up : this.palette.down;

    const x = this.xAt(data.length - 1, data.length, plot);
    const y = scale.toY(last.c);

    ctx.save();
    // A slow halo pulse, driven off the wall clock so it needs no state.
    const phase = (Math.sin(Date.now() / 620) + 1) / 2;
    ctx.beginPath();
    ctx.arc(x, y, 4 + phase * 4.5, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(color, 0.10 + phase * 0.10);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = this.palette.surface;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    // Keep the pulse alive without spinning the loop when nothing else moves.
    if (!this.animating && !this.destroyed) {
      setTimeout(() => {
        if (!this.animating && !this.destroyed) this.requestFrame();
      }, 90);
    }
  }

  private drawCrosshair(
    data: Candle[],
    plot: ReturnType<typeof this.plotRect>,
    scale: ReturnType<typeof this.priceScale>,
  ) {
    const p = this.pointer;
    if (!p) return;
    if (p.x < plot.x || p.x > plot.x + plot.w) return;

    const ratio = (p.x - plot.x) / plot.w;
    const index = Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1))));
    const candle = data[index];
    if (!candle) return;

    this.hoverIndex = index;
    const x = this.snap(this.xAt(index, data.length, plot));
    const y = scale.toY(candle.c);

    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = this.palette.crosshair;
    ctx.lineWidth = 1 / this.dpr;
    ctx.setLineDash([2, 3]);

    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.h + plot.volumeH);
    ctx.stroke();

    const hy = this.snap(Math.max(plot.y, Math.min(plot.y + plot.h, p.y)));
    ctx.beginPath();
    ctx.moveTo(plot.x, hy);
    ctx.lineTo(plot.x + plot.w, hy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Price pill on the axis, tracking the pointer rather than the close.
    const fmt = this.options.formatPrice ?? ((v: number) => v.toFixed(2));
    const label = fmt(scale.toPrice(hy));
    ctx.font = AXIS_FONT;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = this.palette.pillBg;
    roundRect(ctx, plot.x + plot.w + 4, hy - 8, tw + 10, 16, 3);
    ctx.fill();
    ctx.fillStyle = this.palette.pillText;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, plot.x + plot.w + 9, hy);

    // Dot on the series itself.
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = this.palette.surface;
    ctx.fill();
    ctx.strokeStyle = candle.c >= candle.o ? this.palette.up : this.palette.down;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    if (this.lastHoverEmitted !== index) {
      this.lastHoverEmitted = index;
      // The interpolated frame is for pixels; the tooltip must report the
      // real candle, so index back into the committed series.
      const real = this.candles[index] ?? candle;
      this.options.onHover?.({ index, candle: real, x, y });
    }
  }

  get currentHoverIndex() {
    return this.hoverIndex;
  }
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * Resample `source` onto `length` points with linear interpolation, borrowing
 * timestamps from `template` so the morph target shares an x-axis.
 */
function resample(source: Candle[], length: number, template: Candle[]): Candle[] {
  if (source.length === 0) return template.slice(0, length);
  const out: Candle[] = new Array(length);

  for (let i = 0; i < length; i++) {
    const pos = length === 1 ? 0 : (i / (length - 1)) * (source.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(source.length - 1, lo + 1);
    const f = pos - lo;
    const a = source[lo]!;
    const b = source[hi]!;
    out[i] = {
      t: template[i]?.t ?? a.t,
      o: a.o + (b.o - a.o) * f,
      h: a.h + (b.h - a.h) * f,
      l: a.l + (b.l - a.l) * f,
      c: a.c + (b.c - a.c) * f,
      v: a.v + (b.v - a.v) * f,
    };
  }
  return out;
}

function interpolate(from: Candle[], to: Candle[], t: number): Candle[] {
  const n = to.length;
  const out: Candle[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = from[i] ?? to[i]!;
    const b = to[i]!;
    out[i] = {
      t: b.t,
      o: a.o + (b.o - a.o) * t,
      h: a.h + (b.h - a.h) * t,
      l: a.l + (b.l - a.l) * t,
      c: a.c + (b.c - a.c) * t,
      v: a.v + (b.v - a.v) * t,
    };
  }
  return out;
}

/**
 * Axis ticks on human-friendly values. Steps snap to 1, 2, 2.5 or 5 times a
 * power of ten, which is why the labels read 24,800 / 24,900 rather than
 * 24,837 / 24,941.
 */
function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const raw = (max - min) / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / magnitude;
  const step = (norm >= 5 ? 5 : norm >= 2.5 ? 2.5 : norm >= 2 ? 2 : 1) * magnitude;

  const out: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + step * 0.001; v += step) {
    // Floating-point accumulation leaves 24799.999999996; round to the step.
    out.push(Math.round(v / step) * step);
  }
  return out;
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (color.startsWith("rgb(")) return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  return color;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

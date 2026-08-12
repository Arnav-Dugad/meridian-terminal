import type { NextRequest } from "next/server";

import { getQuotes } from "@/lib/twelvedata/service";
import { sessionState } from "@/lib/market/exchanges";
import { findBySlug } from "@/lib/market/universe";
import type { Quote } from "@/lib/twelvedata/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Streams live for just under a minute, then closes cleanly. EventSource
 * reconnects on its own, which keeps us inside serverless execution limits
 * without the client ever noticing a gap. Raise this on a platform with
 * long-lived connections.
 */
export const maxDuration = 60;

const STREAM_MS = 52_000;
const HEARTBEAT_MS = 15_000;

/**
 * Server-sent events for the live tape.
 *
 * Twelve Data's own WebSocket feed is a paid add-on, so rather than exposing a
 * socket we cannot guarantee, the server polls on the client's behalf and
 * pushes only what changed. That inverts the usual cost curve: one hundred
 * open dashboards share a single upstream poll through the request cache
 * instead of each running its own timer.
 *
 * Only deltas go over the wire — a tick that did not move sends nothing, so an
 * idle overnight market costs a heartbeat every fifteen seconds.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => findBySlug(s))
    .slice(0, 40);

  if (symbols.length === 0) {
    return new Response("Provide ?symbols=", { status: 400 });
  }

  // Poll faster while a relevant exchange is trading; overnight, back off hard.
  const anyLive = symbols.some((s) => {
    const inst = findBySlug(s);
    return inst ? sessionState(inst.exchange).isLive : false;
  });
  const intervalMs = anyLive ? 4_000 : 20_000;

  const encoder = new TextEncoder();
  const started = Date.now();
  const lastSent = new Map<string, number>();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const shutdown = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      };

      req.signal.addEventListener("abort", shutdown);

      // Tell the browser how long to wait before reconnecting.
      controller.enqueue(encoder.encode(`retry: 2000\n\n`));

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          shutdown();
        }
      }, HEARTBEAT_MS);

      const tick = async () => {
        if (closed) return;

        try {
          const { data, source } = await getQuotes(symbols);
          const changed: Quote[] = [];
          for (const q of data) {
            const prev = lastSent.get(q.slug);
            if (prev === undefined || prev !== q.price) {
              lastSent.set(q.slug, q.price);
              changed.push(q);
            }
          }
          if (changed.length > 0) send("quotes", { data: changed, source, asOf: Date.now() });
        } catch (err) {
          send("degraded", { message: err instanceof Error ? err.message : "stream error" });
        }

        if (Date.now() - started > STREAM_MS) {
          send("bye", { reason: "window-elapsed" });
          shutdown();
          return;
        }
        if (!closed) timer = setTimeout(tick, intervalMs);
      };

      await tick();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and some CDN layers buffer streams unless told not to.
      "X-Accel-Buffering": "no",
    },
  });
}

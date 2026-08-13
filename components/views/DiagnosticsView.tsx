"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { Badge, Button, Panel, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { IconExternal, IconRefresh } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Provider diagnostics.
 *
 * The answer to "how do I know my keys are working". Every row is a real
 * request made just now, with the upstream's own error text when it fails —
 * because the failure modes that matter here (wrong plan, decommissioned
 * endpoint version, spent budget) are indistinguishable from the outside and
 * only the provider's own message tells them apart.
 */

interface ProbeResult {
  id: string;
  label: string;
  homepage: string;
  status: "ok" | "failed" | "not-configured";
  probe: string;
  latencyMs: number | null;
  detail: string;
  role: string;
  envVar: string | null;
  coverage: string[];
  budget: { minute: number | null; day: number | null };
}

interface Payload {
  summary: { healthy: number; configured: number; total: number; verdict: string };
  results: ProbeResult[];
  asOf: string;
}

export function DiagnosticsView() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/diagnostics", { cache: "no-store" });
      if (!res.ok) throw new Error(`Diagnostics returned ${res.status}`);
      setData((await res.json()) as Payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run diagnostics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const summary = data?.summary;

  return (
    <>
      <PageHeader
        eyebrow="Diagnostics"
        title="Are my providers working?"
        description="Each row below is a live request made when this page loaded — not a config check. If a key is wrong, out of plan, or rate-limited, the provider's own message appears here."
        meta={
          summary && (
            <>
              <Badge tone={summary.healthy === summary.configured ? "up" : summary.healthy > 0 ? "signal" : "down"}>
                {summary.healthy} of {summary.configured} answering
              </Badge>
              <span className="text-[11px] text-ivory-40">{summary.verdict}</span>
            </>
          )
        }
        actions={
          <Button variant="primary" size="md" icon={<IconRefresh />} onClick={run} loading={loading}>
            Re-run probes
          </Button>
        }
      />

      <PageBody className="space-y-5">
        {error && (
          <Panel className="border-down/35 bg-down/[0.06]">
            <p className="text-[13px] text-down">{error}</p>
          </Panel>
        )}

        <Panel flush>
          <PanelHeader
            title="Provider probes"
            subtitle={data ? `Run at ${new Date(data.asOf).toLocaleTimeString()}` : "Running…"}
          />

          {loading && !data ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-line/60">
              <AnimatePresence initial={false}>
                {data?.results.map((r, i) => (
                  <motion.li
                    key={r.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.04 }}
                    className="px-4 py-3.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <StatusLamp status={r.status} />

                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2">
                            <a
                              href={r.homepage}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group text-[13px] text-ivory transition-colors hover:text-signal"
                            >
                              {r.label}
                              <IconExternal className="ml-1.5 inline h-3 w-3 align-[-1px] opacity-0 transition-opacity group-hover:opacity-60" />
                            </a>
                            {r.coverage.map((c) => (
                              <Badge
                                key={c}
                                tone={
                                  c === "IN" ? "india" : c === "US" ? "usa" : c === "CRYPTO" ? "crypto" : "neutral"
                                }
                              >
                                {c}
                              </Badge>
                            ))}
                          </p>

                          <p
                            className={cn(
                              "num-mono mt-1.5 text-[12px]",
                              r.status === "ok"
                                ? "text-up"
                                : r.status === "failed"
                                  ? "text-down"
                                  : "text-ivory-40",
                            )}
                          >
                            {r.detail}
                          </p>

                          <p className="mt-1.5 max-w-[70ch] text-[11px] leading-relaxed text-ivory-40">
                            {r.role}
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="label-micro text-ivory-40">probe {r.probe}</p>
                        <p className="num-mono mt-1 text-[12px] text-ivory-60">
                          {r.latencyMs != null ? `${r.latencyMs} ms` : "—"}
                        </p>
                        {(r.budget.minute != null || r.budget.day != null) && r.status !== "not-configured" && (
                          <p className="num-mono mt-1 text-[10px] text-ivory-40">
                            {r.budget.minute != null && `${r.budget.minute}/min`}
                            {r.budget.day != null && ` · ${r.budget.day}/day`}
                          </p>
                        )}
                      </div>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </Panel>

        <Panel>
          <p className="label-micro mb-3 text-ivory-40">Reading this page</p>
          <dl className="space-y-3 text-[12px] leading-relaxed">
            <Row
              term="Green"
              def="The provider answered with real data just now. Anything it covers will show as Live in the terminal."
            />
            <Row
              term="Red"
              def="A live request failed. The message is the provider's own — most often a plan restriction, a wrong key, or a spent budget."
            />
            <Row
              term="Grey"
              def="No key configured. Add the named environment variable in Vercel and redeploy."
            />
            <Row
              term="Why India can still read Simulated"
              def="Twelve Data's free tier returns a plan error for NSE and BSE. Yahoo Finance covers them instead and needs no key — so if Yahoo is green, Indian prices are real."
            />
          </dl>
        </Panel>
      </PageBody>
    </>
  );
}

function StatusLamp({ status }: { status: ProbeResult["status"] }) {
  const tone =
    status === "ok" ? "bg-up" : status === "failed" ? "bg-down" : "bg-ivory-40";

  return (
    <span className="relative mt-1 flex h-2 w-2 shrink-0" aria-label={status}>
      {status === "ok" && (
        <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", tone)} />
      )}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", tone)} />
    </span>
  );
}

function Row({ term, def }: { term: string; def: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-ivory sm:w-[220px]">{term}</dt>
      <dd className="text-ivory-40">{def}</dd>
    </div>
  );
}

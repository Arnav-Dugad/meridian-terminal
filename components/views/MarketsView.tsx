"use client";

import { useMemo, useState } from "react";

import type { OverviewPayload } from "@/lib/twelvedata/overview";
import type { IndexSeed } from "@/components/market/IndexStrip";
import { IndexStrip } from "@/components/market/IndexStrip";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { BreadthMeter } from "@/components/market/BreadthMeter";
import { SectorRotation } from "@/components/market/SectorRotation";
import { SessionDial } from "@/components/market/SessionDial";
import { QuoteTable } from "@/components/market/QuoteTable";
import { DataSourceNotice } from "@/components/market/DataSourceNotice";
import { Badge, Panel, PanelHeader, Segmented } from "@/components/ui/primitives";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { instrumentsByRegion } from "@/lib/market/universe";
import { formatRelative } from "@/lib/format";
import type { Region } from "@/lib/market/exchanges";

export function MarketsView({
  overview,
  seeds,
}: {
  overview: OverviewPayload;
  seeds: IndexSeed[];
}) {
  const [region, setRegion] = useState<Region>("IN");

  // The constituent table is capped: each visible symbol is a credit, and a
  // 130-row table would cost more than the information is worth.
  const constituents = useMemo(
    () =>
      instrumentsByRegion(region)
        .sort((a, b) => b.seedCap - a.seedCap)
        .slice(0, 40)
        .map((i) => i.slug),
    [region],
  );

  return (
    <>
      <PageHeader
        eyebrow="Markets"
        title="Both tapes, one scale"
        description="Indices, participation and sector rotation for India and the United States, drawn against a shared axis so the comparison is a read rather than a calculation."
        meta={
          <>
            <DataSourceNotice source={overview.source} notice={overview.notice} />
            <span className="text-[11px] text-ivory-40">
              Snapshot {formatRelative(overview.asOf)}
            </span>
          </>
        }
        actions={
          <div className="flex items-baseline gap-2 rounded-sm border border-line bg-ink-900 px-3 py-2">
            <span className="label-micro text-ivory-40">USD/INR</span>
            <span className="num-mono text-[13px] text-ivory">
              <AnimatedNumber value={overview.fx.rate} format={(v) => v.toFixed(3)} feel="soft" />
            </span>
          </div>
        }
      />

      <PageBody className="space-y-5">
        <IndexStrip seeds={seeds} columns={3} className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" />

        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <Panel flush>
            <PanelHeader
              title="Sector rotation"
              subtitle="Cap-weighted move by sector, India and the US back to back"
            />
            <div className="py-3">
              <SectorRotation sectors={overview.sectors} />
            </div>
          </Panel>

          <div className="space-y-5">
            <Panel>
              <p className="label-micro mb-5 text-ivory-40">Sessions</p>
              <SessionDial exchanges={["NSE", "NASDAQ"]} />
            </Panel>

            <Panel flush>
              <PanelHeader title="Breadth" subtitle="Participation behind each index" />
              <div className="space-y-7 p-5">
                <BreadthMeter breadth={overview.breadth.IN} />
                <div className="border-t border-line pt-7">
                  <BreadthMeter breadth={overview.breadth.US} />
                </div>
              </div>
            </Panel>
          </div>
        </div>

        <Panel flush>
          <PanelHeader
            title="Constituents"
            subtitle={`Largest ${constituents.length} names by capitalisation`}
            action={
              <div className="flex items-center gap-2">
                <Badge tone={region === "IN" ? "india" : "usa"}>
                  {region === "IN" ? "NSE" : "US"}
                </Badge>
                <Segmented
                  value={region}
                  onChange={setRegion}
                  layoutIdSuffix="markets-region"
                  options={[
                    { value: "IN", label: "India" },
                    { value: "US", label: "United States" },
                  ]}
                />
              </div>
            }
          />
          <QuoteTable symbols={constituents} defaultSort="turnover" />
        </Panel>
      </PageBody>
    </>
  );
}

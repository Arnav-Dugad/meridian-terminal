import { ImageResponse } from "next/og";

/**
 * The social card, generated at the edge.
 *
 * Deliberately typographic rather than a screenshot: a scaled-down terminal is
 * illegible at the size these are actually seen, whereas a headline and the
 * two market accents survive a thumbnail in a group chat.
 */

export const alt = "Meridian — cross-market intelligence for India and the United States";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#08080a",
          padding: "72px",
          position: "relative",
        }}
      >
        {/* Meridian seam: warm to the left, cool to the right. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(60% 90% at 12% 0%, rgba(240,166,60,0.16) 0%, transparent 62%), radial-gradient(60% 90% at 92% 100%, rgba(123,167,240,0.14) 0%, transparent 62%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 1,
            background: "rgba(244,242,236,0.14)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              border: "2px solid rgba(244,242,236,0.28)",
              borderLeftColor: "#f0a63c",
              borderRightColor: "#7ba7f0",
              display: "flex",
            }}
          />
          <div style={{ color: "#f4f2ec", fontSize: 30, letterSpacing: "-0.01em" }}>Meridian</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              color: "#f4f2ec",
              fontSize: 82,
              lineHeight: 1.02,
              letterSpacing: "-0.03em",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>Two markets.</span>
            <span>
              <span style={{ color: "#f0a63c" }}>Ten and a half</span> hours apart.
            </span>
          </div>
          <div
            style={{
              marginTop: 30,
              color: "#94918a",
              fontSize: 27,
              lineHeight: 1.4,
              maxWidth: 860,
            }}
          >
            Live NSE, BSE, Nasdaq and NYSE data in one terminal — with cross-market
            correlation, portfolio analytics and alerts.
          </div>
        </div>

        <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
          {["NSE", "BSE", "NASDAQ", "NYSE"].map((code, i) => (
            <div
              key={code}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: "#6a6862",
                fontSize: 19,
                letterSpacing: "0.14em",
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: i < 2 ? "#f0a63c" : "#7ba7f0",
                }}
              />
              {code}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}

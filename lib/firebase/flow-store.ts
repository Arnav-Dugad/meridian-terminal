import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import type { FlowDay } from "@/lib/providers/nse";

/**
 * Institutional flow history.
 *
 * NSE publishes only the latest session — there is no free endpoint for the
 * back series. So the terminal builds its own: every time flows are fetched,
 * that day is written to Firestore keyed by date, and the history grows on its
 * own from ordinary use. After a few weeks it is something no free source
 * offers at all, which is precisely why it is worth storing.
 *
 * Keyed by date, so writing repeatedly in a day overwrites rather than
 * duplicating, and it needs no scheduled job.
 */

const COLLECTION = "institutionalFlows";
const MAX_HISTORY = 180;

export async function saveFlowDay(day: FlowDay): Promise<void> {
  const db = await adminDb();
  if (!db) return;
  try {
    await db.collection(COLLECTION).doc(day.date).set({ ...day, savedAt: Date.now() });
  } catch {
    // Never fail a request over a history write.
  }
}

export async function readFlowHistory(limit = MAX_HISTORY): Promise<FlowDay[]> {
  const db = await adminDb();
  if (!db) return [];
  try {
    const snap = await db
      .collection(COLLECTION)
      // Document ids are ISO dates, so ordering by id is chronological and
      // needs no composite index.
      .orderBy("__name__", "desc")
      .limit(Math.min(limit, MAX_HISTORY))
      .get();

    const out: FlowDay[] = [];
    snap.forEach((doc) => {
      const d = doc.data() as FlowDay | undefined;
      if (d?.date && d.fii && d.dii) out.push(d);
    });
    return out.reverse(); // Oldest first, as every chart here expects.
  } catch {
    return [];
  }
}

export async function isFlowHistoryAvailable(): Promise<boolean> {
  return (await adminDb()) !== null;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { usePersonal } from "@/lib/store/personal";
import { formatRelative } from "@/lib/format";
import { Badge, Button, Panel, PanelHeader } from "@/components/ui/primitives";
import { IconTrash } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Per-instrument research notes.
 *
 * The reason to own a terminal rather than use a screener is that a view
 * accumulates: why you are watching something, what level you decided mattered,
 * what you concluded last quarter. A note attached to the instrument keeps that
 * next to the chart it refers to.
 *
 * Saving is debounced rather than manual. A Save button on a notes field is a
 * way to lose work — people close tabs. Two seconds of quiet commits, and the
 * status line says plainly which state the text is in.
 */

const AUTOSAVE_MS = 1600;

type SaveState = "idle" | "dirty" | "saved";

export function InstrumentNotes({
  slug,
  symbol,
  className,
}: {
  slug: string;
  symbol: string;
  className?: string;
}) {
  const { noteFor, saveNote, removeNote, mode, ready } = usePersonal();
  const existing = noteFor(slug);

  const [body, setBody] = useState("");
  const [status, setStatus] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  // Hydrate once the store has loaded, and again if the instrument changes.
  // Guarded so a cloud snapshot arriving mid-edit cannot clobber typing.
  useEffect(() => {
    if (!ready) return;
    hydrated.current = false;
    setBody(existing?.body ?? "");
    setStatus("idle");
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, ready]);

  useEffect(() => {
    if (!hydrated.current) return;
    if (body === (existing?.body ?? "")) return;

    setStatus("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveNote(slug, body);
      setStatus("saved");
    }, AUTOSAVE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  // Commit immediately if the tab is closed or hidden mid-edit.
  useEffect(() => {
    const flush = () => {
      if (status === "dirty") saveNote(slug, body);
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [status, body, slug, saveNote]);

  const chars = body.trim().length;

  return (
    <Panel flush className={className}>
      <PanelHeader
        title="Your notes"
        subtitle={`Private to you · ${mode === "cloud" ? "synced to your account" : "saved on this device"}`}
        action={
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={status}
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 3 }}
              transition={{ duration: 0.14 }}
              className={cn(
                "label-micro-tight",
                status === "dirty" ? "text-signal" : status === "saved" ? "text-up" : "text-ivory-40",
              )}
            >
              {status === "dirty"
                ? "Saving…"
                : status === "saved"
                  ? "Saved"
                  : existing
                    ? `Edited ${formatRelative(existing.updatedAt)}`
                    : ""}
            </motion.span>
          </AnimatePresence>
        }
      />

      <div className="p-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 4000))}
          placeholder={`Why are you watching ${symbol}? Levels that matter, the thesis, what would change your mind…`}
          rows={6}
          className={cn(
            "w-full resize-y rounded-sm border border-line bg-ink-850 px-3 py-2.5",
            "text-[13px] leading-relaxed text-ivory outline-none transition-colors",
            "placeholder:text-ivory-40 focus:border-signal/50 focus:bg-ink-800",
          )}
          aria-label={`Notes on ${symbol}`}
        />

        <div className="mt-2.5 flex items-center justify-between gap-3">
          <span className="text-[10px] text-ivory-40">
            {chars > 0 ? `${chars.toLocaleString()} / 4,000 characters` : "Autosaves as you type"}
          </span>

          {existing && (
            <Button
              variant="ghost"
              size="sm"
              icon={<IconTrash />}
              onClick={() => {
                if (timer.current) clearTimeout(timer.current);
                removeNote(slug);
                setBody("");
                setStatus("idle");
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}

/** Compact index of every note, for a future notes overview. */
export function NotesSummary() {
  const { notes } = usePersonal();
  if (notes.length === 0) return null;
  return <Badge tone="neutral">{notes.length} notes</Badge>;
}

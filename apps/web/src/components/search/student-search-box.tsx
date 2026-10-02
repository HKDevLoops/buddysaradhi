"use client";

// Implements: docs/design/overhaul-plan.md §3 — "one combobox, keyboard-first", the single
// search surface for Students, Fees, Attendance and the shell ⌘K palette.
// Rules: AGENTS.md §2 Rule 2 (ranking is local — no request is issued while typing; the
// component only ever reads the candidate array it is handed), Rule 10 (WCAG 2.1 AA combobox
// pattern: role/aria-activedescendant/aria-expanded, a polite live count, 44px rows, visible
// focus) and §6.1 (no `any`, typed props). Principle: P5 (offline-first).
//
// Tokens only — the surface tokens the token wave publishes, with the current glass token as
// the fallback value so the box still renders correctly before/without the new set. No new
// colours are introduced and globals.css is not touched from here.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { fuzzySearch } from "@buddysaradhi/shared";
import { cn } from "@/lib/utils";

/** Debounce for the query the parent sees; ranking itself is synchronous and local. */
const QUERY_DEBOUNCE_MS = 120;

/** Rows rendered at once — enough to scan, bounded so a 2000-candidate sweep stays cheap. */
const MAX_VISIBLE_RESULTS = 25;

export interface SearchCandidate<T = unknown> {
  item: T;
  /** The string ranked against the query and rendered; `positions` index into it. */
  text: string;
  /** Optional secondary line (student code, batch, grade). */
  meta?: string;
}

export interface StudentSearchBoxProps<T> {
  /** Accessible name for the input. */
  label: string;
  /** Controlled query. The box debounces what it pushes up. */
  value: string;
  onValueChange: (value: string) => void;
  /**
   * Called with the selected candidate's `item`. Omit where the screen has no
   * jump-to-row affordance (Attendance filters a grid, it does not navigate).
   */
  onSelect?: (item: T) => void;
  candidates: readonly SearchCandidate<T>[];
  placeholder?: string;
  /** Shown above the list when ranking is active but nothing matched. */
  emptyLabel?: string;
  /** Typed, user-facing failure text. Driver detail must never reach this prop. */
  error?: string | null;
  /** Extra classes for the input (the callers own their own width). */
  className?: string;
  /** Focuses the input on mount — used by the ⌘K palette. */
  autoFocus?: boolean;
}

/** Wraps every matched character in `<mark>` using the engine's ascending positions. */
function HighlightedText({ text, positions }: { text: string; positions: number[] }) {
  if (positions.length === 0) return <>{text}</>;
  const marked = new Set(positions);
  const runs: { text: string; hit: boolean }[] = [];
  let buffer = "";
  let bufferHit = marked.has(0);
  for (let i = 0; i < text.length; i++) {
    const hit = marked.has(i);
    if (hit !== bufferHit || buffer === "") {
      if (buffer !== "") runs.push({ text: buffer, hit: bufferHit });
      buffer = "";
      bufferHit = hit;
    }
    buffer += text[i];
  }
  if (buffer !== "") runs.push({ text: buffer, hit: bufferHit });
  return (
    <>
      {runs.map((run, index) =>
        run.hit ? (
          <mark
            key={index}
            style={{
              background: "color-mix(in srgb, var(--accent-primary) 24%, transparent)",
              color: "inherit",
              borderRadius: "var(--radius-sm)",
            }}
          >
            {run.text}
          </mark>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  );
}

export function StudentSearchBox<T>({
  label,
  value,
  onValueChange,
  onSelect,
  candidates,
  placeholder = "Search…",
  emptyLabel,
  error = null,
  className,
  autoFocus = false,
}: StudentSearchBoxProps<T>) {
  const listId = useId();
  const optionIdPrefix = `${listId}-option`;
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // The typed text is local so the field stays responsive; the parent receives it
  // debounced so a controlled parent is not re-rendered on every keystroke.
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    if (draft === lastEmitted.current) return;
    const timer = setTimeout(() => {
      lastEmitted.current = draft;
      onValueChange(draft);
    }, QUERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, onValueChange]);

  const results = useMemo(
    () => fuzzySearch(candidates, draft, { limit: MAX_VISIBLE_RESULTS }),
    [candidates, draft],
  );

  // The engine returns `{ item, text, score, positions }`; `meta` is display-only, so it
  // is resolved by item identity rather than threaded through the ranking result.
  const metaByItem = useMemo(() => {
    const map = new Map<unknown, string>();
    for (const candidate of candidates) map.set(candidate.item, candidate.meta ?? "");
    return map;
  }, [candidates]);

  useEffect(() => {
    setActiveIndex(0);
  }, [draft]);

  const activeId = results.length > 0 ? `${optionIdPrefix}-${activeIndex}` : undefined;
    const trimmed = draft.trim();
  // Focus alone never dumps the whole roster over the page: the list opens once there
  // is something to rank, or when there is provably nothing to show.
  const showList = open && (trimmed !== "" || candidates.length === 0);

  const select = useCallback(
    (index: number) => {
      const chosen = results[index];
      if (!chosen) return;
      setOpen(false);
      inputRef.current?.blur();
      onSelect?.(chosen.item);
    },
    [results, onSelect],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (results.length === 0 ? 0 : (index + 1) % results.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) =>
        results.length === 0 ? 0 : (index - 1 + results.length) % results.length,
      );
      return;
    }
    if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(Math.max(results.length - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      if (open && results.length > 0) {
        event.preventDefault();
        select(activeIndex);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      // First Escape clears; a second one on an empty field closes the list.
      if (trimmed !== "") {
        setDraft("");
        setOpen(false);
      } else {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
  };

  // Focus moves via aria-activedescendant, never by moving DOM focus, so the caret in
  // the input survives arrow-key navigation.
  useEffect(() => {
    if (!open || !activeId) return;
    const active = document.getElementById(activeId);
    // jsdom (and older engines) have no layout, so `scrollIntoView` may be absent.
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeId]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const emptyMessage = emptyLabel ?? `No match for “${trimmed}”`;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search
          className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: "var(--text-muted)" }}
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          autoFocus={autoFocus}
          aria-label={label}
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList ? activeId : undefined}
          aria-autocomplete="list"
          aria-describedby={`${listId}-count`}
          placeholder={placeholder}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            "w-full pl-9 pr-9 text-sm focus:outline-none",
            className ?? "neumo-inset h-11",
          )}
          style={{
            background: "var(--surface-inset, var(--bg-surface-inset))",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
            color: "var(--text-primary)",
            minHeight: "44px",
          }}
        />
        {trimmed !== "" && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setDraft("");
              setOpen(false);
              inputRef.current?.focus();
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center cursor-pointer"
            style={{ color: "var(--text-muted)", background: "transparent", border: "none" }}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <p
        id={`${listId}-count`}
        role="status"
        aria-live="polite"
        className="sr-only"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}
      >
        {trimmed === ""
          ? "Search ready"
          : `${results.length} of ${candidates.length} students match ${trimmed}`}
      </p>

      {error !== null && (
        <p role="alert" className="mt-2 text-xs" style={{ color: "var(--accent-danger, var(--accent-flare))" }}>
          {error}
        </p>
      )}

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-30 mt-1 w-full max-h-80 overflow-y-auto rounded-xl py-1"
          style={{
            background: "var(--surface-overlay, var(--surface-glass-strong))",
            backdropFilter: "blur(24px) saturate(160%)",
            border: "1px solid var(--border-default)",
            boxShadow: "var(--shadow-overlay, 0 18px 40px rgba(0,0,0,0.28))",
          }}
        >
          {results.length === 0 ? (
            <li
              role="option"
              aria-selected={false}
              aria-disabled="true"
              className="px-3 flex items-center min-h-[44px] text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              {emptyMessage}
            </li>
          ) : (
            results.map((result, index) => (
              <li
                key={String(index)}
                id={`${optionIdPrefix}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  select(index);
                }}
                className="px-3 flex flex-col justify-center gap-0.5 min-h-[44px] cursor-pointer"
                style={
                  index === activeIndex
                    ? {
                        background: "color-mix(in srgb, var(--accent-primary) 14%, transparent)",
                        borderLeft: "2px solid var(--accent-primary)",
                      }
                    : { background: "transparent", borderLeft: "2px solid transparent" }
                }
              >
                <span className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
                  <HighlightedText text={result.text} positions={result.positions} />
                </span>
                {result.item !== undefined && (metaByItem.get(result.item) ?? "") !== "" && (
                  <span className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                    {metaByItem.get(result.item)}
                  </span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// Implements: docs/design/overhaul-plan.md §4.1 (the front door answers on every
// state, including the transient one) + AGENTS.md §2 Rule 9 (a state that shows
// nothing is a silent failure) and Rule 10 (the wait is announced, not implied).
//
// Next.js 16 shape, read from the bundled docs rather than from memory
// (next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md):
//   · a Server Component by default — no `"use client"` here, so this ships zero
//     JavaScript;
//   · it takes NO parameters;
//   · it is automatically wrapped in a `<Suspense>` boundary around this
//     segment's `page.js`, `not-found.js` and any nested layouts — it does NOT
//     wrap the layout or the error boundary in the same segment, so the shell
//     stays interactive and a real error still reaches `app/error.tsx`;
//   · the fallback UI is prefetched, so navigation normally shows nothing at all
//     and this only appears when the segment is genuinely slow.
//
// WHAT IS ACTUALLY LOADING, said honestly. Every route on this site is static or
// a fast server read — `/` is `force-static` with a 1h revalidate, `/pricing`,
// `/platforms` and `/request-access` render no data at all, and only `/` reads
// the marketing API. So this is not a spinner promising a long job: it names the
// real operation and it promises nothing except that the page will arrive. No
// invented progress bar, no invented time estimate, no skeleton that lies about
// the shape of the content (craft-floor.md: "soft-shadowed rounded rectangles
// standing in for content" is on the refuse list).
//
// It is a ROOT-level loading file, so it also covers `/admin/**`. That is why the
// copy and the markup here are neutral: one `.panel`, one heading, no marketing
// claim, no route link that an operator would not want. `/admin` is
// `force-dynamic` and its segments are quick, so in practice this shows for the
// marketing routes only; the console has its own vocabulary and its own error
// boundary (`src/app/admin/error.tsx`).

export default function Loading() {
  return (
    <div
      // `status` rather than `alert`: this is a wait, not a failure, and an
      // assertive region would interrupt whatever the visitor was reading.
      role="status"
      aria-live="polite"
      className="mx-auto w-full max-w-2xl px-6 py-20"
    >
      <div className="panel flex flex-col items-start gap-3 p-6 md:p-8">
        <p className="font-display text-2xl font-bold text-balance md:text-3xl">
          Loading this page.
        </p>
        <p className="max-w-[62ch] text-pretty text-[var(--text-secondary)]">
          This page is being built for you now. Nothing is wrong and nothing has been charged; it
          will replace this message as soon as it arrives.
        </p>
        {/* The one honest fact about the wait: the shell stays usable. The header
            is the root layout, which is outside this Suspense boundary, so a
            visitor who does not want to wait can navigate from it. */}
        <p className="text-sm text-[var(--text-muted)]">
          The header stays usable while this loads.
        </p>
      </div>
    </div>
  );
}
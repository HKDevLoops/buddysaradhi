// Implements: AGENTS.md §2 Rule 10 / WCAG 2.4.1 Bypass Blocks.
//
// There was no skip link, and the app's own chrome made the cost of that
// visible: five nav rows, a 44px search field and a `?` help button sit ahead
// of the main landmark in the tab order on EVERY screen, so a keyboard user
// spent ~8 keystrokes per screen change re-walking the nav to reach the
// content they had just navigated to.
//
// Visible on focus, not on hover and not ever: `sr-only` until `:focus`, then
// a 44px target at the top-left. Off-screen rather than `display:none`,
// because a hidden element is not focusable and the link would silently not
// exist for the only user who needs it. It is the FIRST thing in the body so
// it is the first tab stop.
//
// The wrapping `<nav aria-label="Skip links">` is load-bearing for axe
// `region` (black-box probe B4): a bare anchor sitting directly under
// `<body>` — before every landmark — is content outside any landmark on
// EVERY page (auth routes render a lone `<main>`, the app shell renders
// aside/nav/header/main/footer, but the link precedes all of them). Inside
// the nav the link lives in a landmark without changing tab order, focus
// behaviour, or visuals: the nav itself is never focusable and carries no
// styling.

export function SkipLink() {
  return (
    <nav aria-label="Skip links">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:inline-flex focus:min-h-[44px] focus:items-center focus:rounded-lg focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:outline-none focus:ring-2"
        style={{
          // Sits on the overlay material, because it may appear over the
          // shell's canvas gradient rather than on a panel.
          background: 'var(--surface-overlay)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-default)',
          boxShadow: '0 0 0 2px var(--accent-primary)',
        }}
      >
        Skip to main content
      </a>
    </nav>
  );
}

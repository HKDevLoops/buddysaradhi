# Design Reference Images — Index

> **30 AI-generated design reference images** for the Buddysaradhi TutorOS UI Design Master Plan — 10 per platform (web, mobile, desktop). These complement the 18 pixel-perfect HTML mockup screenshots in `images/<platform>/` with richer visual mood references for each palette and page concept.

---

## How to Use This Index

Each entry below documents:
- **File** — the image path relative to this index
- **Palette** — which of the 8 palettes the image showcases
- **Theme** — light or dark
- **Concept** — what the image depicts
- **Companion spec** — the markdown spec / HTML mockup this image relates to

> ⚠️ **These are mood references, not pixel-perfect layouts.** AI-generated text inside the images may contain minor typos. For the precise visual contract, see the Tier 1 screenshots in `../web/`, `../mobile/`, `../desktop/`.

---

## Web Platform (10 images — 1344×768 landscape)

| # | File | Palette | Theme | Concept | Companion |
|---|---|---|---|---|---|
| 1 | `web/01_landing_hero.png` | Aurora Cosmic + Amber Sunrise | dark | Landing page hero with floating glassmorphic dashboard preview, KPI tiles, starfield background, amber CTA | `web/01_Landing_Page.md` |
| 2 | `web/02_auth_violet.png` | Violet Nebula | dark | Authentication login card centered, neumorphic depth, bioluminescent violet input borders | `web/02_Auth.md` |
| 3 | `web/03_dashboard_aurora.png` | Aurora Cosmic | dark | Analytics dashboard with sidebar, 4 KPI tiles, large line chart, teal data accents | `web/03_Dashboard.md` |
| 4 | `web/04_students_rose.png` | Rose Petal | light | Student CRM grid of glassmorphic profile cards, filter bar, rose accent dots | `web/04_Students.md` |
| 5 | `web/05_attendance_cyan.png` | Cyan Lagoon | light | Monthly attendance calendar grid, day cells with status dots, weekly summary sidebar | `web/05_Attendance.md` |
| 6 | `web/06_fees_saffron.png` | Saffron Marigold | light | Fees dashboard with payment summary cards, invoice table, gold accents, festive mood | `web/06_Fees_and_Payments.md` |
| 7 | `web/07_reports_emerald.png` | Emerald Ledger | light | Reports page with 2×2 chart grid (bar/line/donut/heatmap), filters sidebar | `web/07_Reports.md` |
| 8 | `web/08_schedule_amber.png` | Amber Sunrise | light | Weekly schedule time-slot grid, glassmorphic class event blocks, amber markers | (new page concept) |
| 9 | `web/09_messaging_aurora.png` | Aurora Cosmic | dark | Three-column messaging chat with conversation list, chat thread, detail panel | (new page concept) |
| 10 | `web/10_settings_violet.png` | Violet Nebula | dark | Settings panel with category nav, glassmorphic setting cards, violet toggles | `web/08_Settings.md` |

---

## Mobile Platform (10 images — 768×1344 portrait)

| # | File | Palette | Theme | Concept | Companion |
|---|---|---|---|---|---|
| 1 | `mobile/01_splash.png` | Violet Nebula | dark | App splash screen with glassmorphic logo emblem, particle effects | (new screen concept) |
| 2 | `mobile/02_onboarding.png` | Aurora Cosmic | dark | Onboarding carousel with illustration card, progress dots | (new screen concept) |
| 3 | `mobile/03_dashboard.png` | Aurora Cosmic | dark | Mobile home dashboard, greeting header, 3 KPI tiles, schedule list, bottom nav | `mobile/02_Mobile_Dashboard.md` |
| 4 | `mobile/04_student_profile.png` | Rose Petal | light | Student profile card with attendance rings, fee status, contact info | `mobile/03_Mobile_Students.md` |
| 5 | `mobile/05_quick_attendance.png` | Cyan Lagoon | light | Quick attendance list with present/absent/late toggles, date selector, save bar | `mobile/04_Mobile_Attendance.md` |
| 6 | `mobile/06_fee_payment.png` | Saffron Marigold | light | Fee payment flow with UPI method selector, pay-now CTA, Indian UPI context | `mobile/05_Mobile_Fees.md` |
| 7 | `mobile/07_schedule.png` | Amber Sunrise | light | Today schedule timeline with glassmorphic event cards, color-coded subjects | (new screen concept) |
| 8 | `mobile/08_notifications.png` | Aurora Cosmic | dark | Notifications list grouped by today/earlier, bioluminescent unread dots | (new screen concept) |
| 9 | `mobile/09_reports.png` | Emerald Ledger | light | Mobile reports with period chips, donut chart, progress rings, mini bar chart | (new screen concept) |
| 10 | `mobile/10_settings.png` | Violet Nebula | dark | Mobile settings list grouped into account/preferences/support, violet toggles | `mobile/06_Mobile_Settings.md` |

---

## Desktop Platform (10 images — 1344×768 landscape)

| # | File | Palette | Theme | Concept | Companion |
|---|---|---|---|---|---|
| 1 | `desktop/01_dashboard.png` | Aurora Cosmic | dark | Multi-panel desktop dashboard, collapsible sidebar, 4 KPI tiles, revenue chart, activity feed | `desktop/01_Desktop_Dashboard.md` |
| 2 | `desktop/02_students.png` | Rose Petal | light | Full-width data table with sortable columns, bulk action toolbar, filter sidebar, pagination | `desktop/02_Desktop_Students.md` |
| 3 | `desktop/03_bulk_attendance.png` | Cyan Lagoon | light | Bulk attendance grid of student tiles with status toggles, date/batch selector, summary bar | (new screen concept) |
| 4 | `desktop/04_fees_invoices.png` | Saffron Marigold | light | Invoice generator with list + preview panel, line items, tabular totals, generate/send actions | `desktop/03_Desktop_Fees.md` |
| 5 | `desktop/05_reports.png` | Emerald Ledger | light | Reports dashboard with 2×2 chart grid, date/batch filters, export buttons | (new screen concept) |
| 6 | `desktop/06_calendar.png` | Amber Sunrise | light | Full month calendar with color-coded class event blocks, view switcher, day detail panel | (new screen concept) |
| 7 | `desktop/07_communication.png` | Aurora Cosmic | dark | Three-panel communication hub: conversation list + chat thread + contact detail | (new screen concept) |
| 8 | `desktop/08_marketing_crm.png` | Amber Sunrise | light | Marketing CRM kanban pipeline (new/contacted/enrolled), lead cards, campaign tracker | (new screen concept) |
| 9 | `desktop/09_settings.png` | Violet Nebula | dark | Settings with category sidebar + tabbed preference panels, glassmorphic setting cards | `desktop/04_Desktop_Settings.md` |
| 10 | `desktop/10_multi_window.png` | Aurora Cosmic | dark | Multi-window workspace with 3 floating glassmorphic windows (dashboard + chat + calendar) | (new screen concept) |

---

## Generation Provenance

- **Tool:** `z-ai-web-dev-sdk` image generation API (via `z-ai image` CLI)
- **Model:** Z.ai text-to-image (bioluminescent-aware prompts)
- **Sizes:** 1344×768 (web/desktop landscape), 768×1344 (mobile portrait)
- **Prompt structure:** Each prompt = `[page concept], [palette name + hues], [layout components], [bioluminescent accents], [mood]` + shared style suffix enforcing glassmorphism, neumorphic depth, tabular numerics, no text overlays, high detail, 4K.
- **Retry logic:** Up to 5 attempts per image with 30s backoff on HTTP 429 (rate limit)
- **Total generation time:** ~25 minutes (sequential, 3-second pacing between requests)
- **All 30 images generated successfully** (0 failures)

---

## File Format Note

The `z-ai` CLI saves images with a `.png` extension, but the underlying image data is JPEG (JFIF). This is a known CLI behavior. All standard image viewers, browsers, and image-processing libraries handle this gracefully — the files open and display correctly everywhere. If you need true PNG format, re-encode with:

```bash
# Convert all references to true PNG (if needed)
for f in web/*.png mobile/*.png desktop/*.png; do
  convert "$f" "tmp_${f%.png}.png" && mv "tmp_${f%.png}.png" "$f"
done
```

---

## Relationship to Tier 1 Screenshots

| Aspect | Tier 1 (`images/<platform>/`) | Tier 2 (`images/references/<platform>/`) |
|---|---|---|
| **Source** | `agent-browser` screenshot of HTML mockup | AI text-to-image generation |
| **Fidelity** | Pixel-perfect (text is real, layout is exact) | Mood/concept (text may have typos, layout is interpretive) |
| **Count** | 18 (8 web + 6 mobile + 4 desktop) | 30 (10 web + 10 mobile + 10 desktop) |
| **Purpose** | Visual QA contract — compare rendered screen against this | Inspiration, stakeholder presentations, designer onboarding |
| **Pages covered** | Only the 18 pages with HTML mockups | 18 mockup pages + 12 new screen concepts (schedule, messaging, notifications, marketing CRM, multi-window, etc.) |

**Together, the two tiers give you 48 image references** — 18 pixel-perfect contracts plus 30 richer mood/concept references spanning more page ideas than the mockups alone cover.

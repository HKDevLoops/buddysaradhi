# Admin Dashboard Design Specification

**Implements**: SaaS Admin Dashboard & Subscription Limits Management
**Date**: 2026-07-16
**Author**: Antigravity

---

## 1. Product Context & Objectives
The admin dashboard is a private portal inside the `product-page` application (port `3010`) designed to monitor system metrics, inspect tutor registration details, and execute manual subscription plan upgrades.

## 2. Authentication & Authorization Model
To satisfy the strict security requirements, the dashboard utilizes a server-side App Router validation flow:
1. **Credentials Table**: Admin user records are stored in the SQLite `AdminUser` table.
2. **Startup Seeding**: If the database does not contain the admin user `hkdevs`, it is automatically seeded with username `hkdevs` and hashed password `$thisisHKdevs@22$`.
3. **Password Security**: Native Node.js `crypto.scryptSync` with a unique random salt is used for password hashing and verification.
4. **Session Cookie**: Successful login sets an HTTP-only, secure, `SameSite=Lax` session cookie `bs_admin_session` containing a cryptographically signed payload.
5. **Route Protection**: The `/admin/dashboard` server component reads this cookie, validates the signature using `GATEWAY_SHARED_SECRET`, and redirects unauthenticated requests to `/admin/login`.

## 3. UI/UX Style (Liquid Glass)
The admin pages share the design language of the platform:
* **Background**: Cosmic dark `#060414` canvas with animated glow blobs.
* **Component Styling**: Glassmorphic panels with subtle neon accents (`emerald`, `cyan`, `flare`).
* **KPI Metrics Grid**: Glass cards with micro-animations on hover.

## 4. Admin Functionality & Data Mutations
* **Platform Analytics**: Displays total active tutors, subscription tier breakdown, and total student metrics.
* **Tutor Management Console**: A searchable table listing all registered tutors, their contact information, registration date, and current plan.
* **Direct Plan Upgrades**: Dropdown menus allowing the administrator to instantly upgrade or downgrade any tutor's plan (Free, Growth, Institute). Plan updates mutate the `Setting` table directly using Prisma.

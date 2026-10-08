# React Hook Form 7

- **Docs:** https://react-hook-form.com/get-started/ (schema validation section is on that page)
- **Pinned:** `react-hook-form@^7.80.0` → **7.81.0**, `@hookform/resolvers@^3.9.1` → **3.10.0** — `apps/web/package.json`
- **Sites:** 5 `react-hook-form` imports, 3 `zodResolver` imports
  - `components/settings/fee-rules-section.tsx`
  - `components/settings/profile-section.tsx`
  - `components/students/add-student-sheet.tsx`

## Project specifics

### `@hookform/resolvers/zod` is a SUBPATH export — `moduleResolution` must be `bundler`

`apps/web/tsconfig.json` sets `"moduleResolution": "bundler"`. That is load-bearing, not a preference. Under `node10`/`node` resolution the import fails outright:

```
Cannot find module '@hookform/resolvers/zod'
```

If you ever change `moduleResolution`, this is the first thing that breaks — and it breaks as a *module resolution* error, which reads like a missing dependency rather than a config problem.

### The Zod 3 / Zod 4 resolver boundary

`@hookform/resolvers@3.10.0` is the Zod-4-capable line: Zod v4 support requires resolvers `^3.10`+ **paired with** `zod ^3.25` or `zod v4`. This repo is on resolvers 3.10.0 with `zod 3.24.2` — i.e. the resolver is new enough but Zod is *below* the 3.25 threshold. It works today because the v3 path is what is being taken.

**A Zod upgrade is therefore not a one-package change.** Bumping `zod` alone, or `zod` and `@hookform/resolvers` in the wrong order, produces either the module-resolution error above or a resolver that cannot find the Zod 4 core. `zod` is exact-pinned in three places for this reason. See [zod.md](zod.md).

### Forms never submit before validation, and every money field is paise

- `handleSubmit` + `zodResolver` is the only submission path. There is no "validate then submit" second pass.
- Amounts are entered as rupees and converted at the boundary to **integer paise** (AGENTS.md §2 Rule 6). No `float` touches a fee.
- **Overpayment is refused by the app, not by the form.** "Save disabled" was once investigated as a UI bug and turned out to be the app correctly refusing an overpayment under BR-M-04. A disabled Save button is a valid state, not a defect — recorded in `docs/mindmap.md` §6.

### Radix/Base UI inputs need `Controller`

`@base-ui/react@1.6.0` (2 sites) and `@radix-ui/react-popover@1.1.19` (1 site) render inputs that do not forward a raw DOM ref the way native `<input>` does. Those fields go through `Controller` (`useController`) rather than spreading `register()`. The rule of thumb: native element → `register`, anything composed → `Controller`.
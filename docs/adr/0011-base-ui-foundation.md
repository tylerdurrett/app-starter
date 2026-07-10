# ADR-0011 — UI foundation: Base UI primitives with shadcn-pattern wrappers

- **Date:** 2026-07-09 (retroactive; deliberate choice in the parent codebase, affirmed here)
- **Status:** Accepted

## Context

`packages/ui` builds shadcn-*pattern* components (CVA variants, `cn()`
class merging, vendored-not-installed components) on
`@base-ui-components/react` — not Radix, which stock shadcn/ui sat on and
which virtually every starter template used at the time.

## Decision

**Base UI over Radix, deliberately.** The bet: Base UI is the successor
project from the Radix + MUI + Floating UI authors, actively developed
where Radix had slowed, so a starter should front-load that migration
rather than hand it to every app stamped from the template.

The bet has since been vindicated: as of early July 2026, shadcn/ui
itself switched its default primitives to Base UI. The main historical
cost — hand-porting shadcn ecosystem components from Radix APIs to Base
UI (e.g. the `ButtonProps` union-narrowing in
`packages/ui/src/components/button.tsx`) — dissolves going forward as the
ecosystem's components target Base UI natively.

## Consequences

- New components should follow the shadcn pattern on Base UI primitives;
  do not introduce Radix (one primitive system only).
- Watch items: move `@base-ui-components/react` off the beta channel when
  a stable release ships, and bump `@tailwindcss/vite` off its stale
  `4.0.0-beta` pin (Tailwind v4 has long been stable) — routine
  maintenance, no design change.

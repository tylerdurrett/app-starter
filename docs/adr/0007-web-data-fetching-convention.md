# ADR-0007 — Web data fetching: TanStack Query for server state, route loaders only for gating

- **Date:** 2026-07-09
- **Status:** Accepted

## Context

The web app accreted three data-fetching styles with no canonical one:
TanStack Query (mounted in `main.tsx`, used once), TanStack Router
loaders (six routes), and hand-rolled `useState`/`useEffect` + `apiFetch`
(six routes, each reimplementing loading/error state with no caching or
invalidation). This was accretion across build sessions, not a decision —
and in a starter template, an ambiguous idiom guarantees every future
developer or agent adds a fourth variant.

## Decision

- **TanStack Query owns all server state**: reads via `useQuery`, writes
  via `useMutation` with cache invalidation. No component-level
  `useState`/`useEffect` fetching — that style is being removed in a
  cleanup pass and must not be reintroduced.
- **Route loaders are for gating only**: redirect-or-render decisions
  (does this slug resolve, is this invite valid), ideally seeding the
  query cache rather than owning data.

Rejected alternative: loaders-first (all data resolved before render,
fewer spinners) with Query only for interactive refetching. Query-first
was chosen because mutations and cache invalidation dominate this app's
pages (members, invites, integrations), and co-locating queries with
components keeps routes thin.

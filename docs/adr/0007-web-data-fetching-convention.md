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
- **Route loaders gate AND seed**: they make the redirect-or-render
  decision (does this slug resolve, is this invite valid) and, when the
  fetched entity is server state a component renders, seed it into the
  query cache under the shared key via `queryClient.setQueryData` (the
  router carries the `QueryClient` in its context). Seeding — not owning —
  means the component's `useQuery` hits a warm cache on first paint (no
  second fetch, no full-page spinner on navigation-in) while a mutation's
  invalidation still has a live observer to refresh.
- **Every mutable display value is read via `useQuery`** on the exact key
  its mutation invalidates. `useLoaderData()` is for gating-derived,
  non-mutating values only (a resolved slug, a role, a registry entry) —
  never for render state a mutation can change, because loader data is a
  snapshot with no observer, so an on-screen value read from it goes stale
  after a mutation until a manual reload.

Rejected alternative: loaders-first (all data resolved before render,
fewer spinners) with Query only for interactive refetching. Query-first
was chosen because mutations and cache invalidation dominate this app's
pages (members, invites, integrations), and co-locating queries with
components keeps routes thin.

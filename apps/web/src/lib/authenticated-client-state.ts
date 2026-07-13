import type { QueryClient } from '@tanstack/react-query';
import { clearActiveContext } from './active-context-storage';

const AUTHENTICATED_CLIENT_OWNER_KEY = 'authenticatedClientOwner';

export type SessionIdentity = { userId: string } | null;

export interface AuthenticatedClientOwnerSnapshot {
  known: boolean;
  owner: string | null;
  transitioning: boolean;
}

interface AuthenticatedClientState {
  generation: number;
  ownerKnown: boolean;
  owner: string | null;
  transitioning: boolean;
  latestObservation?: Promise<SessionIdentity>;
}

const authenticatedClientStates = new WeakMap<QueryClient, AuthenticatedClientState>();

function getClientState(queryClient: QueryClient): AuthenticatedClientState {
  let state = authenticatedClientStates.get(queryClient);
  if (!state) {
    state = { generation: 0, ownerKnown: false, owner: null, transitioning: false };
    authenticatedClientStates.set(queryClient, state);
  }
  return state;
}

function readPersistedOwner(): string | undefined {
  try {
    return window.localStorage.getItem(AUTHENTICATED_CLIENT_OWNER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writePersistedOwner(owner: string | null): void {
  try {
    if (owner === null) {
      window.localStorage.removeItem(AUTHENTICATED_CLIENT_OWNER_KEY);
    } else {
      window.localStorage.setItem(AUTHENTICATED_CLIENT_OWNER_KEY, owner);
    }
  } catch {
    // Storage is optional; unknown ownership will conservatively clear on reload.
  }
}

async function replaceAuthenticatedClientOwner(
  queryClient: QueryClient,
  state: AuthenticatedClientState,
  owner: string | null,
  generation: number,
): Promise<boolean> {
  const previousOwner = state.ownerKnown ? state.owner : readPersistedOwner();
  if (previousOwner !== owner) {
    state.transitioning = true;
    await queryClient.cancelQueries();
    if (state.generation !== generation) return false;
    queryClient.clear();
    clearActiveContext();
  }

  state.ownerKnown = true;
  state.owner = owner;
  state.transitioning = false;
  writePersistedOwner(owner);
  return true;
}

/** Remove all private state and optionally establish the next known owner. */
export function clearAuthenticatedClientState(
  queryClient: QueryClient,
  nextOwner?: string | null,
): Promise<void> {
  const state = getClientState(queryClient);
  const generation = ++state.generation;
  state.transitioning = true;
  const identity = typeof nextOwner === 'string' ? { userId: nextOwner } : null;
  const clearing = (async (): Promise<SessionIdentity> => {
    await queryClient.cancelQueries();
    if (state.generation !== generation) return state.latestObservation!;
    queryClient.clear();
    clearActiveContext();

    if (nextOwner === undefined) {
      state.ownerKnown = false;
      state.owner = null;
      writePersistedOwner(null);
    } else {
      state.ownerKnown = true;
      state.owner = nextOwner;
      writePersistedOwner(nextOwner);
    }
    state.transitioning = false;
    return identity;
  })();

  state.latestObservation = clearing;
  return clearing.then(() => undefined);
}

/** Whether the in-memory client has already been reconciled to this owner. */
export function authenticatedClientOwnerMatches(
  queryClient: QueryClient,
  owner: string | null,
): boolean {
  const state = getClientState(queryClient);
  return state.ownerKnown && state.owner === owner && !state.transitioning;
}

/** Read the coordinator without exposing its mutable internal state. */
export function authenticatedClientOwnerSnapshot(
  queryClient: QueryClient,
): AuthenticatedClientOwnerSnapshot {
  const state = getClientState(queryClient);
  return {
    known: state.ownerKnown,
    owner: state.owner,
    transitioning: state.transitioning,
  };
}

/** Prevent private observers from refetching while an owner transition clears them. */
export function authenticatedClientQueriesEnabled(queryClient: QueryClient): boolean {
  const state = getClientState(queryClient);
  return state.ownerKnown && state.owner !== null && !state.transitioning;
}

/** Compose a query's feature gate with the authenticated-client ownership gate. */
export function authenticatedQueryEnabled(
  queryClient: QueryClient,
  featureEnabled: boolean,
): boolean {
  return featureEnabled && authenticatedClientQueriesEnabled(queryClient);
}

/**
 * Reconcile a session observation with private client state. Concurrent checks
 * converge on the newest-started observation, so stale responses cannot win.
 */
export function observeAuthenticatedSession(
  queryClient: QueryClient,
  getSession: () => Promise<SessionIdentity>,
): Promise<SessionIdentity> {
  const state = getClientState(queryClient);
  const generation = ++state.generation;

  const observation = (async (): Promise<SessionIdentity> => {
    const identity = await getSession();
    if (state.generation !== generation) return state.latestObservation!;

    const established = await replaceAuthenticatedClientOwner(
      queryClient,
      state,
      identity?.userId ?? null,
      generation,
    );
    if (!established) return state.latestObservation!;
    return identity;
  })();

  state.latestObservation = observation;
  return observation;
}

/** Establish an already-observed reactive session through the same coordinator. */
export function establishAuthenticatedClientOwner(
  queryClient: QueryClient,
  userId: string | null,
): Promise<SessionIdentity> {
  const state = getClientState(queryClient);
  const generation = ++state.generation;
  const identity = userId === null ? null : { userId };

  const establishment = (async (): Promise<SessionIdentity> => {
    const established = await replaceAuthenticatedClientOwner(
      queryClient,
      state,
      userId,
      generation,
    );
    if (!established) return state.latestObservation!;
    return identity;
  })();

  state.latestObservation = establishment;
  return establishment;
}

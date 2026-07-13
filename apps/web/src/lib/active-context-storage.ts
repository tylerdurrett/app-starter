export const ACTIVE_CONTEXT_KEY = 'activeContext';

/** Safe removal of the active-context hint. Swallows storage errors. */
export function clearActiveContext(): void {
  try {
    window.localStorage.removeItem(ACTIVE_CONTEXT_KEY);
  } catch {
    // Storage is optional; there is nothing else to clear.
  }
}

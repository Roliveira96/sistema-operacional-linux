// Session-wide events raised by the HTTP client and handled by the auth
// provider: an expired session or a pending mandatory password change.

export type SessionEvent =
  | { kind: "session-expired"; reason: string }
  | { kind: "password-change-required" };

type Listener = (event: SessionEvent) => void;

const listeners = new Set<Listener>();

export function onSessionEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitSessionEvent(event: SessionEvent): void {
  listeners.forEach((listener) => listener(event));
}

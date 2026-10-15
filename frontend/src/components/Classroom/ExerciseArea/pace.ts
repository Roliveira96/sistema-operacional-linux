export interface Paced<T> {
  /** Gives a value to send: the last one given before the send is the one that goes. */
  push(value: T): void;
  /** Sends what is waiting now. */
  flush(): void;
  /** Drops what is waiting. */
  cancel(): void;
}

/**
 * Sends the values it is given at most once every `interval` ms (SPEC-065 section 3.1): the first goes at once, or after the interval when it does not
 * lead (`leading: false`, which is how the machine is kept), and what comes meanwhile is held, so only the last goes. A send that says false did not go
 * (the room was not connected): the value is tried again after the interval, unless a newer one has taken its place.
 */
export function createPaced<T>(send: (value: T) => boolean | void, interval: number, { leading = true }: { leading?: boolean } = {}): Paced<T> {
  let pending: { value: T } | null = null;
  let last = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fire = () => {
    clearTimeout(timer);
    timer = undefined;
    const sending = pending;
    if (!sending) return;
    pending = null;
    last = Date.now();
    if (send(sending.value) === false) {
      pending ??= sending;
      timer = setTimeout(fire, interval);
    }
  };

  return {
    push(value) {
      pending = { value };
      if (timer !== undefined) return;
      const wait = leading ? last + interval - Date.now() : interval;
      if (wait > 0) timer = setTimeout(fire, wait);
      else fire();
    },
    flush: fire,
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
  };
}

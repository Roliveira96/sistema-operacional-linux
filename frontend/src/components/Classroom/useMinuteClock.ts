import { useEffect, useState } from "react";

/** The clock of a panel that tells waits in minutes (the waiting room, the raised hands), so they go up while it stays open. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  return now;
}

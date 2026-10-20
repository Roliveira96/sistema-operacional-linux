import { useEffect, useState } from "react";

/** The params of a page of the app router: a promise in Next.js 16, a plain object in a test; null until they are known. */
export function useRouteParams<T>(params: Promise<T> | T): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.resolve(params).then((p) => {
      if (active) setValue(p);
    });
    return () => {
      active = false;
    };
  }, [params]);
  return value;
}

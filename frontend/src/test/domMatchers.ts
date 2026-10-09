// A few DOM matchers for component tests, so the suite does not need another
// dependency. Import it for its side effect: `import "@/test/domMatchers";`.
import { expect } from "vitest";

const asElement = (value: unknown): Element | null => (value instanceof Element ? value : null);

expect.extend({
  toBeInTheDocument(received: unknown) {
    const element = asElement(received);
    const pass = element !== null && element.ownerDocument.contains(element);
    return { pass, message: () => `expected element ${pass ? "not " : ""}to be in the document` };
  },
  toHaveTextContent(received: unknown, expected: string | RegExp) {
    const text = (asElement(received)?.textContent ?? "").replace(/\s+/g, " ").trim();
    const pass = typeof expected === "string" ? text.includes(expected) : expected.test(text);
    return { pass, message: () => `expected text ${JSON.stringify(text)} ${pass ? "not " : ""}to match ${String(expected)}` };
  },
  toHaveAttribute(received: unknown, name: string, value?: string) {
    const actual = asElement(received)?.getAttribute(name) ?? null;
    const pass = value === undefined ? actual !== null : actual === value;
    return { pass, message: () => `expected attribute ${name}=${JSON.stringify(actual)} ${pass ? "not " : ""}to be ${String(value)}` };
  },
  toHaveValue(received: unknown, value: string) {
    const actual = (received as HTMLInputElement | HTMLSelectElement | null)?.value;
    const pass = actual === value;
    return { pass, message: () => `expected value ${JSON.stringify(actual)} ${pass ? "not " : ""}to be ${JSON.stringify(value)}` };
  },
  toBeEnabled(received: unknown) {
    const pass = (received as HTMLButtonElement | null)?.disabled === false;
    return { pass, message: () => `expected element ${pass ? "not " : ""}to be enabled` };
  },
});

declare module "vitest" {
  // Same type parameters as vitest's own declaration, so the merge is valid.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toBeInTheDocument(): R;
    toHaveTextContent(expected: string | RegExp): R;
    toHaveAttribute(name: string, value?: string): R;
    toHaveValue(value: string): R;
    toBeEnabled(): R;
  }
}

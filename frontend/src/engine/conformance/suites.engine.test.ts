import { describe, expect, it, vi } from "vitest";
import { mountMachine } from "../testkit";
import { manifest } from "./manifest";
import { runConformance } from "./runner";

// The whole engine takes minutes to go through; SUITES=name1,name2 (or a group name) runs only those, to work on a few suites.
vi.setConfig({ testTimeout: 1_800_000 });

const only = (process.env.SUITES ?? "").split(",").filter(Boolean);
const chosen = only.length ? manifest.filter((suite) => only.includes(suite.name) || only.includes(suite.group)) : manifest;

describe.runIf(only.length > 0)("suites chosen with SUITES=", () => {
  it("pass on the real engine", async () => {
    const report = await runConformance({ suites: chosen, mount: mountMachine });
    const failures = report.suites.flatMap((s) => s.cases.filter((c) => !c.passed).map((c) => `${s.suite.name}: ${c.command} -> ${c.expected} | status ${c.status}: ${c.output.slice(0, 200).replace(/\n/g, "\n")}`));
    expect(failures).toEqual([]);
  });
});

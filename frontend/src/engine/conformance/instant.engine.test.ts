import { afterAll, describe, expect, it } from "vitest";
import { mountMachine } from "../testkit";
import { manifest } from "./manifest";
import { runConformance } from "./runner";

afterAll(() => {
  document.body.innerHTML = "";
});

const chosen = manifest.filter((suite) => ["ls", "grep", "cat", "sudo"].includes(suite.name));

// Covers SPEC-032 CA-02, CA-03, RN-01: the quick mode gives the same status, output and approval as the live one, in much less time.
describe("the quick mode on the real engine", () => {
  it("gives the same results as the live mode, faster", async () => {
    const timed = async (instant: boolean) => {
      const start = Date.now();
      const report = await runConformance({ suites: chosen, mount: mountMachine, instant });
      return { report, ms: Date.now() - start };
    };
    const live = await timed(false);
    const quick = await timed(true);
    // The clock of the machine is the real one, so the times that `ls -l` and `systemctl status` print are taken out before comparing.
    const clean = (text: string) => text.replace(/\d\d:\d\d(:\d\d)?/g, "hh:mm").replace(/\d+(s|min) ago/g, "t ago");
    const shape = (report: Awaited<ReturnType<typeof runConformance>>) => report.suites.flatMap((s) => s.cases.map((c) => [s.suite.name, c.command, c.passed, c.status, clean(c.output)]));
    const qa = shape(quick.report), la = shape(live.report);
    expect(qa).toEqual(la);
    expect(clean(quick.report.transcript)).toBe(clean(live.report.transcript));
    expect(quick.ms).toBeLessThan(live.ms * 0.5);
  }, 600_000);
});

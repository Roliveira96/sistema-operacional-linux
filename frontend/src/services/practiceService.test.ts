import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "./httpClient";
import { createPracticeService } from "./practiceService";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("practiceService", () => {
  it("calls the practice endpoints", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ snapshot: { formato: "exame-so/maquina" } }))
      .mockResolvedValueOnce(json({ moduleId: "m1", snapshot: null }))
      .mockResolvedValueOnce(json({ passed: ["q"], progress: [] }))
      .mockResolvedValueOnce(json({ items: [{ questionId: "q" }] }));
    const svc = createPracticeService(createHttpClient(fetcher));
    expect(await svc.scenario("q 1")).toEqual({ formato: "exame-so/maquina" });
    expect(await svc.topicScenario("m1")).toBeNull();
    expect(await svc.checkModule("m1", { a: 1 })).toEqual({ passed: ["q"], progress: [] });
    expect(await svc.progress("m1")).toEqual([{ questionId: "q" }]);
    expect(fetcher.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/api/v1/questions/q%201/scenario", "GET"],
      ["/api/v1/modules/m1/scenario", "GET"],
      ["/api/v1/modules/m1/check", "POST"],
      ["/api/v1/modules/m1/progress", "GET"],
    ]);
    expect(fetcher.mock.calls[2]![1].body).toBe(JSON.stringify({ snapshot: { a: 1 } }));
  });
});

import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "./httpClient";
import { createPracticeService } from "./practiceService";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("practiceService", () => {
  it("calls the practice endpoints", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ snapshot: { formato: "exame-so/maquina" } }))
      .mockResolvedValueOnce(json({ passed: true, completedAt: "t" }))
      .mockResolvedValueOnce(json({ items: [{ questionId: "q" }] }));
    const svc = createPracticeService(createHttpClient(fetcher));
    expect(await svc.scenario("q 1")).toEqual({ formato: "exame-so/maquina" });
    expect(await svc.check("q1", { a: 1 })).toEqual({ passed: true, completedAt: "t" });
    expect(await svc.progress("m1")).toEqual([{ questionId: "q" }]);
    expect(fetcher.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/api/v1/questions/q%201/scenario", "GET"],
      ["/api/v1/questions/q1/check", "POST"],
      ["/api/v1/modules/m1/progress", "GET"],
    ]);
    expect(fetcher.mock.calls[1]![1].body).toBe(JSON.stringify({ snapshot: { a: 1 } }));
  });
});

describe("practiceService topic endpoints (SPEC-016)", () => {
  it("reads the topic scenario and checks the module", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ moduleId: "m 1", snapshot: { a: 1 } }))
      .mockResolvedValueOnce(json({ moduleId: "m 1", snapshot: null }))
      .mockResolvedValueOnce(json({ passed: ["q1"], progress: [{ questionId: "q1", completedAt: "t" }] }));
    const svc = createPracticeService(createHttpClient(fetcher));
    expect(await svc.topicScenario("m 1")).toEqual({ a: 1 });
    expect(await svc.topicScenario("m 1")).toBeNull();
    expect(await svc.checkModule("m 1", { b: 2 })).toEqual({ passed: ["q1"], progress: [{ questionId: "q1", completedAt: "t" }] });
    expect(fetcher.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/api/v1/modules/m%201/scenario", "GET"],
      ["/api/v1/modules/m%201/scenario", "GET"],
      ["/api/v1/modules/m%201/check", "POST"],
    ]);
    expect(fetcher.mock.calls[2]![1].body).toBe(JSON.stringify({ snapshot: { b: 2 } }));
  });
});

// Covers SPEC-035 5.2 on the screen: the single answer goes in the body of the check.
describe("practiceService answer (SPEC-035)", () => {
  it("sends the response of a true or false question", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ passed: false, completedAt: "t", correctAnswer: true, explanation: "<p>x</p>" }));
    const svc = createPracticeService(createHttpClient(fetcher));
    expect(await svc.answer("q 1", false)).toEqual({ passed: false, completedAt: "t", correctAnswer: true, explanation: "<p>x</p>" });
    expect(fetcher.mock.calls[0]![0]).toBe("/api/v1/questions/q%201/check");
    expect(fetcher.mock.calls[0]![1].body).toBe(JSON.stringify({ response: { value: false } }));
  });
});

// Covers SPEC-036 5.2 on the screen: the id of the alternative goes in the body of the check.
describe("practiceService choose (SPEC-036)", () => {
  it("sends the alternative of a single choice question", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ passed: true, completedAt: "t", correctChoice: "a" }));
    const svc = createPracticeService(createHttpClient(fetcher));
    expect(await svc.choose("q1", "a")).toEqual({ passed: true, completedAt: "t", correctChoice: "a" });
    expect(fetcher.mock.calls[0]![1].body).toBe(JSON.stringify({ response: { choice: "a" } }));
  });
});

// Covers SPEC-037 5.2 on the screen: the links go in the body of the check.
describe("practiceService link (SPEC-037)", () => {
  it("sends the links of a matching question", async () => {
    const links = [{ left: "l1", right: "r2" }];
    const fetcher = vi.fn().mockResolvedValueOnce(json({ passed: true, completedAt: "t", pairs: links, results: [{ ...links[0], correct: true }] }));
    const svc = createPracticeService(createHttpClient(fetcher));
    expect((await svc.link("q1", links)).pairs).toEqual(links);
    expect(fetcher.mock.calls[0]![1].body).toBe(JSON.stringify({ response: { links } }));
  });
});

// Covers SPEC-039 5 on the screen: the descriptive answer goes in the body of the check and comes back pending.
describe("practiceService write (SPEC-039)", () => {
  it("sends the html of a descriptive answer", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ passed: false, completedAt: "t", status: "PENDING", expectedAnswer: "<p>rwx</p>" }));
    const svc = createPracticeService(createHttpClient(fetcher));
    const r = await svc.write("q1", "<p>dono rwx</p>");
    expect(r).toMatchObject({ status: "PENDING", expectedAnswer: "<p>rwx</p>" });
    expect(fetcher.mock.calls[0]![1].body).toBe(JSON.stringify({ response: { html: "<p>dono rwx</p>" } }));
  });
});

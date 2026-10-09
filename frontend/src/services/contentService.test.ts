import { describe, expect, it, vi } from "vitest";
import { createContentService } from "./contentService";
import { createHttpClient } from "./httpClient";

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("contentService", () => {
  it("calls the read endpoints and unwraps the lists", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ blocks: [{ id: "b" }], setup: { steps: [{ command: "mkdir /x" }] } }))
      .mockResolvedValueOnce(json({ questions: [{ id: "q" }] }))
      .mockResolvedValueOnce(json({ questions: [] }))
      .mockResolvedValueOnce(json({ items: [{ id: "t" }] }));
    const svc = createContentService(createHttpClient(fetcher));

    expect(await svc.content("m 1")).toEqual({ blocks: [{ id: "b" }], setup: { summary: "", steps: [{ command: "mkdir /x" }] } });
    expect(await svc.questions("m1", "EXERCISE")).toEqual([{ id: "q" }]);
    expect(await svc.questions("m1")).toEqual([]);
    expect(await svc.templates()).toEqual([{ id: "t" }]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/modules/m%201/blocks",
      "/api/v1/modules/m1/questions?usage=EXERCISE",
      "/api/v1/modules/m1/questions",
      "/api/v1/assessment-templates",
    ]);
  });
});

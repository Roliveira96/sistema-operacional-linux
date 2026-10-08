import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "./httpClient";
import { fetchHealth } from "./healthService";

describe("fetchHealth", () => {
  it("converts a 503 problem into an UNHEALTHY report", async () => {
    const body = {
      type: "service-unavailable",
      title: "Service Unavailable",
      status: 503,
      components: [{ name: "postgres", status: "UNHEALTHY", latencyMs: 1 }],
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status: 503, headers: { "Content-Type": "application/problem+json" } }),
    );

    const report = await fetchHealth(createHttpClient(fetcher));
    expect(report.status).toBe("UNHEALTHY");
    expect(report.components).toHaveLength(1);
  });
});

describe("fetchHealth errors", () => {
  it("rethrows problems other than 503", async () => {
    const body = { type: "internal-error", title: "Internal Server Error", status: 500 };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status: 500, headers: { "Content-Type": "application/problem+json" } }),
    );
    await expect(fetchHealth(createHttpClient(fetcher))).rejects.toMatchObject({ status: 500 });
  });

  it("returns an empty component list when the 503 body has none", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: "service-unavailable", status: 503 }), {
        status: 503,
        headers: { "Content-Type": "application/problem+json" },
      }),
    );
    expect((await fetchHealth(createHttpClient(fetcher))).components).toEqual([]);
  });
});

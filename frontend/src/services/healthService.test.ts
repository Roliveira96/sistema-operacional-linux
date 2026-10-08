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

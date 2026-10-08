import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { messages } from "@/messages/pt-BR";
import { NetworkError } from "@/services/httpClient";
import { HealthStatus } from "./HealthStatus";

afterEach(cleanup);

// Covers SPEC-004 CA-21 at the rendering level.
describe("HealthStatus", () => {
  it("renders the report components", async () => {
    render(
      <HealthStatus
        load={async () => ({
          status: "DEGRADED",
          version: "dev",
          components: [
            { name: "postgres", status: "HEALTHY", latencyMs: 1 },
            { name: "minio", status: "UNHEALTHY", latencyMs: 2000 },
          ],
        })}
      />,
    );
    expect(await screen.findByText(messages.health.status.DEGRADED)).toBeTruthy();
    expect(screen.getByText(messages.health.components.postgres!)).toBeTruthy();
    expect(screen.getByText(messages.health.components.minio!)).toBeTruthy();
  });

  it("shows an alert instead of crashing on network failure", async () => {
    render(
      <HealthStatus
        load={async () => {
          throw new NetworkError(new TypeError("Failed to fetch"));
        }}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toBe(messages.health.networkError);
  });
});

describe("HealthStatus extra states", () => {
  it("shows the generic message for unexpected errors and retries on click", async () => {
    let calls = 0;
    render(
      <HealthStatus
        load={async () => {
          calls += 1;
          if (calls === 1) throw new Error("boom");
          return { status: "HEALTHY", components: [{ name: "custom", status: "HEALTHY", latencyMs: 0 }] };
        }}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toBe(messages.health.unexpectedError);
    fireEvent.click(screen.getByRole("button", { name: messages.health.retry }));
    expect(await screen.findByText("custom")).toBeTruthy();
  });

  it.each(["light", "dark"])("renders the same structure in the %s theme", async (theme) => {
    document.documentElement.dataset.theme = theme;
    const { container } = render(
      <HealthStatus load={async () => ({ status: "UNHEALTHY", components: [] })} />,
    );
    expect(await screen.findByText(messages.health.status.UNHEALTHY)).toBeTruthy();
    expect(container.querySelector("section.card")).not.toBeNull();
  });
});

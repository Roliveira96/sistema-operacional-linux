import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MetricCard } from "./MetricCard";

afterEach(cleanup);

describe("MetricCard", () => {
  it("renders value, label and description", () => {
    render(
      <MetricCard
        value="50+"
        label="Lições práticas"
        description="Exercícios no terminal"
      />,
    );

    expect(screen.getByText("50+")).toBeTruthy();
    expect(screen.getByText("Lições práticas")).toBeTruthy();
    expect(screen.getByText("Exercícios no terminal")).toBeTruthy();
  });

  it.each(["light", "dark"])("renders consistently under %s theme", (theme) => {
    document.documentElement.dataset.theme = theme;
    const { container } = render(
      <MetricCard
        value="100%"
        label="Cobertura"
      />,
    );
    expect(container.firstChild).toBeTruthy();
  });
});

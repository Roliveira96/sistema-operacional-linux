import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FeatureCard } from "./FeatureCard";

afterEach(cleanup);

describe("FeatureCard", () => {
  it("renders title, description, and optional badge", () => {
    render(
      <FeatureCard
        title="Simulação POSIX"
        description="Execução local de comandos"
        badge="Destaque"
      />,
    );

    expect(screen.getByRole("heading", { level: 3, name: "Simulação POSIX" })).toBeTruthy();
    expect(screen.getByText("Execução local de comandos")).toBeTruthy();
    expect(screen.getByText("Destaque")).toBeTruthy();
  });

  it.each(["light", "dark"])("renders consistently in %s theme", (theme) => {
    document.documentElement.dataset.theme = theme;
    const { container } = render(
      <FeatureCard
        title="Pilar"
        description="Descrição do pilar"
      />,
    );
    expect(container.querySelector("article")).toBeTruthy();
  });
});

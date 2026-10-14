import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./Button";
import { ButtonLink } from "./ButtonLink";

afterEach(cleanup);

// SPEC-047 CA-06: one pattern of button for the system.
describe("Button", () => {
  it("is a primary button by default and exposes its variant", () => {
    render(<Button>Salvar</Button>);
    const button = screen.getByRole("button", { name: "Salvar" });
    expect(button.getAttribute("data-variant")).toBe("primary");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("data-size")).toBe("md");
    expect(button.getAttribute("data-icon")).toBeNull();
  });

  it("accepts the secondary and ghost variants, the sm size and the icon mode", () => {
    render(
      <>
        <Button variant="secondary">A</Button>
        <Button variant="ghost" icon aria-label="Arquivar">
          x
        </Button>
        <Button size="sm">C</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "A" }).getAttribute("data-variant")).toBe("secondary");
    const icon = screen.getByRole("button", { name: "Arquivar" });
    expect(icon.getAttribute("data-variant")).toBe("ghost");
    expect(icon.getAttribute("data-icon")).toBe("true");
    expect(screen.getByRole("button", { name: "C" }).getAttribute("data-size")).toBe("sm");
  });
});

describe("ButtonLink", () => {
  it("is a link that looks like a button, with the same variants", () => {
    render(
      <>
        <ButtonLink href="/a">Ver</ButtonLink>
        <ButtonLink href="/b" variant="ghost" icon title="Configurações">
          x
        </ButtonLink>
      </>,
    );
    const link = screen.getByRole("link", { name: "Ver" });
    expect(link.getAttribute("href")).toBe("/a");
    expect(link.getAttribute("data-variant")).toBe("primary");
    const icon = screen.getByRole("link", { name: "x" });
    expect(icon.getAttribute("data-variant")).toBe("ghost");
    expect(icon.getAttribute("data-icon")).toBe("true");
    expect(icon.getAttribute("title")).toBe("Configurações");
  });

describe("Button danger (SPEC-050)", () => {
  it("accepts the danger variant, for the actions that remove something", () => {
    render(<Button variant="danger">Excluir turma</Button>);
    expect(screen.getByRole("button", { name: "Excluir turma" }).getAttribute("data-variant")).toBe("danger");
  });
});
});

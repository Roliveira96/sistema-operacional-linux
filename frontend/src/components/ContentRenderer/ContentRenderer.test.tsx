import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { contentMessages } from "@/messages/content.pt-BR";
import type { ContentBlock } from "@/services/contentService";
import { ContentRenderer } from "./ContentRenderer";

afterEach(cleanup);

const blocks: ContentBlock[] = [
  { id: "9", type: "WIDGET", position: 9, payload: { component: "LS_ANATOMY" } },
  { id: "1", type: "TEXT", position: 1, payload: { title: "ls", html: "<p>Lista <code>arquivos</code></p>" } },
  { id: "2", type: "COMMAND", position: 2, payload: { steps: [{ command: "ls -l", explanation: "detalhado", terminal: 2, login: { user: "ana" } }, { command: "pwd" }] } },
  { id: "3", type: "TIP", position: 3, payload: { variant: "WARNING", html: "Cuidado" } },
  { id: "4", type: "TIP", position: 4, payload: { html: "Dica boa" } },
  { id: "5", type: "CURIOSITY", position: 5, payload: { title: "Na vida real", html: "Servidores" } },
  { id: "6", type: "STEP_BY_STEP", position: 6, payload: { steps: ["um", "dois"] } },
  { id: "7", type: "CARDS", position: 7, payload: { cards: [{ title: "Debian", text: "estável" }] } },
  { id: "8", type: "LEGACY_HTML", position: 8, payload: { html: "<div class='curiosidade'>Linus</div>" } },
  { id: "10", type: "WIDGET", position: 10, payload: { component: "PERMISSION_CALCULATOR" } },
];

// Covers SPEC-012 CA-02 and CA-09 at the component level.
describe("ContentRenderer", () => {
  it("renders every block type in position order", () => {
    const { container } = render(<ContentRenderer blocks={blocks} />);
    const types = [...container.querySelectorAll("[data-block-type]")].map((el) => el.getAttribute("data-block-type"));
    expect(types).toEqual(["TEXT", "COMMAND", "TIP", "TIP", "CURIOSITY", "STEP_BY_STEP", "CARDS", "LEGACY_HTML", "WIDGET", "WIDGET"]);

    expect(screen.getByRole("heading", { name: "ls" })).toBeTruthy();
    expect(screen.getByText("arquivos").tagName).toBe("CODE");
    expect(screen.getByText("ls -l")).toBeTruthy();
    expect(screen.getByText(contentMessages.terminal(2))).toBeTruthy();
    expect(screen.getByText(contentMessages.loginAs("ana"))).toBeTruthy();
    expect(screen.getByText(contentMessages.warningTitle)).toBeTruthy();
    expect(screen.getByText(contentMessages.tipTitle)).toBeTruthy();
    expect(screen.getByText("Na vida real")).toBeTruthy();
    expect(screen.getByText("dois")).toBeTruthy();
    expect(screen.getByText("Debian")).toBeTruthy();
    expect(screen.getByText("Linus")).toBeTruthy();
    expect(screen.getByText(new RegExp(contentMessages.anatomy.title))).toBeTruthy();
    expect(screen.getByText(new RegExp(contentMessages.calculator.title))).toBeTruthy();
  });

  it("keeps rendering when a block type or widget is unknown", () => {
    render(
      <ContentRenderer
        blocks={[
          { id: "a", type: "VIDEO", position: 1, payload: {} },
          { id: "b", type: "WIDGET", position: 2, payload: { component: "QUIZ" } },
          { id: "c", type: "TEXT", position: 3, payload: { html: "depois" } },
          { id: "d", type: "COMMAND", position: 4, payload: {} },
          { id: "e", type: "TEXT", position: 5, payload: undefined as unknown as Record<string, unknown> },
        ]}
      />,
    );
    expect(screen.getAllByText(contentMessages.unknownBlock)).toHaveLength(2);
    expect(screen.getByText("depois")).toBeTruthy();
  });

  it.each(["light", "dark"])("renders the same structure in the %s theme", (theme) => {
    document.documentElement.dataset.theme = theme;
    const { container } = render(<ContentRenderer blocks={blocks} />);
    expect(container.querySelectorAll("[data-block-type]")).toHaveLength(blocks.length);
  });
});

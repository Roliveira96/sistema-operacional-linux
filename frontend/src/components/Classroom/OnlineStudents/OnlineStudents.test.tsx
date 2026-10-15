import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdmissionEntry, ChatTarget, HandRaiseItem } from "@/services/classroomService";
import { OnlineStudents } from "./OnlineStudents";

const styleOf = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const ana: AdmissionEntry = { studentId: "u-1", name: "Ana Souza" };
const bruno: AdmissionEntry = { studentId: "u-2", name: "Bruno Lima" };
const carla: AdmissionEntry = { studentId: "u-3", name: "Carla Dias" };
const davi: AdmissionEntry = { studentId: "u-4", name: "Davi Rocha" };

const hand = (entry: AdmissionEntry, requestedAt: string, question?: string): HandRaiseItem => ({ studentId: entry.studentId, name: entry.name, requestedAt, question });

interface Over {
  admitted?: AdmissionEntry[];
  online?: string[];
  hands?: HandRaiseItem[];
  unread?: Record<string, number>;
  selected?: ChatTarget | null;
  onSelect?: (to: ChatTarget) => void;
}

const props = (over: Over = {}) => ({
  admitted: [ana, bruno, carla],
  online: ["u-1", "u-2", "u-3"],
  hands: [] as HandRaiseItem[],
  unread: {} as Record<string, number>,
  selected: null as ChatTarget | null,
  onSelect: vi.fn(),
  ...over,
});

/** The cards, in the order they are on the screen, each as the name it shows. */
const names = () => screen.getAllByRole("listitem").map((item) => item.querySelector("[data-testid='online-name']")!.textContent);
const card = (name: string) => within(screen.getByText(name).closest("li")!);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-14T10:05:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// SPEC-063 CA-01: the cards of the students who are online, in the panel of the teacher
describe("OnlineStudents", () => {
  it("has the section with its title, the button for everybody above the cards, and a card for each student who is online", () => {
    render(<OnlineStudents {...props()} />);
    const section = screen.getByRole("region", { name: "Alunos online" });
    expect(within(section).getByRole("heading", { level: 2, name: "Alunos online" })).toBeDefined();
    const everybody = within(section).getByRole("button", { name: "Mensagem para todos" });
    const list = within(section).getByRole("list");
    expect(everybody.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(names()).toEqual(["Ana Souza", "Bruno Lima", "Carla Dias"]);
    expect(within(section).getByRole("button", { name: "Conversar com Ana Souza" }).textContent).toBe("Conversar");
  });

  it("opens the conversation of the class with the button for everybody", () => {
    const onSelect = vi.fn();
    render(<OnlineStudents {...props({ onSelect })} />);
    fireEvent.click(screen.getByRole("button", { name: "Mensagem para todos" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("all");
  });

  it("opens the conversation of a student with the button of his card, and only of his", () => {
    const onSelect = vi.fn();
    render(<OnlineStudents {...props({ onSelect })} />);
    fireEvent.click(screen.getByRole("button", { name: "Conversar com Bruno Lima" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ studentId: "u-2" });
  });

  it("says that nobody is online, and still offers the message for everybody", () => {
    render(<OnlineStudents {...props({ online: [] })} />);
    expect(screen.getByText("Nenhum aluno online.")).toBeDefined();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("button", { name: "Mensagem para todos" })).toBeDefined();
  });

  it("says that nobody is online when nobody is in the class", () => {
    render(<OnlineStudents {...props({ admitted: [], online: [] })} />);
    expect(screen.getByText("Nenhum aluno online.")).toBeDefined();
  });

  it("shows only the students who are accepted and online: not who is accepted and away, nor who is online and not accepted", () => {
    render(<OnlineStudents {...props({ admitted: [ana, bruno, carla], online: ["u-1", "u-3", "u-9"] })} />);
    expect(names()).toEqual(["Ana Souza", "Carla Dias"]);
    expect(screen.queryByText("Bruno Lima")).toBeNull();
  });

  it("follows the presence in real time: a student who comes in gets a card, and who leaves loses it", () => {
    const view = render(<OnlineStudents {...props({ online: ["u-1"] })} />);
    expect(names()).toEqual(["Ana Souza"]);
    view.rerender(<OnlineStudents {...props({ online: ["u-1", "u-2"] })} />);
    expect(names()).toEqual(["Ana Souza", "Bruno Lima"]);
    view.rerender(<OnlineStudents {...props({ online: ["u-2"] })} />);
    expect(names()).toEqual(["Bruno Lima"]);
    view.rerender(<OnlineStudents {...props({ online: [] })} />);
    expect(screen.getByText("Nenhum aluno online.")).toBeDefined();
  });

  describe("the raised hand", () => {
    it("shows the mark in words, how long ago and the doubt, only on the card of who has the hand up", () => {
      render(<OnlineStudents {...props({ hands: [hand(ana, "2026-10-14T10:00:00Z", "Como uso o chmod?")] })} />);
      const withHand = card("Ana Souza");
      expect(withHand.getByText("Mão levantada")).toBeDefined();
      expect(withHand.getByText("há 5 min")).toBeDefined();
      expect(withHand.getByText("Como uso o chmod?")).toBeDefined();
      const without = card("Bruno Lima");
      expect(without.queryByText("Mão levantada")).toBeNull();
      expect(without.queryByText(/há \d+ min|há menos/)).toBeNull();
    });

    it("shows the mark and the time, and no doubt, for a hand that came with none", () => {
      render(<OnlineStudents {...props({ hands: [hand(ana, "2026-10-14T10:04:30Z", ""), hand(bruno, "2026-10-14T10:04:00Z")] })} />);
      expect(card("Ana Souza").getByText("Mão levantada")).toBeDefined();
      expect(card("Ana Souza").getByText("há menos de 1 min")).toBeDefined();
      expect(card("Bruno Lima").getByText("Mão levantada")).toBeDefined();
      expect(card("Ana Souza").queryByTestId("online-question")).toBeNull();
      expect(card("Bruno Lima").queryByTestId("online-question")).toBeNull();
    });

    it("writes the doubt as text, never as HTML, and keeps its line breaks in the style", () => {
      const doubt = "<b>x</b> e <img src=x onerror=alert(1)>\nsegunda linha";
      const { container } = render(<OnlineStudents {...props({ hands: [hand(ana, "2026-10-14T10:00:00Z", doubt)] })} />);
      expect(card("Ana Souza").getByTestId("online-question").textContent).toBe(doubt);
      expect(container.querySelector("b")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
      expect(styleOf("./OnlineStudents.module.scss")).toMatch(/white-space:\s*pre-wrap/);
    });

    it("follows the hands in real time: the mark comes when the hand goes up and goes when it goes down", () => {
      const view = render(<OnlineStudents {...props()} />);
      expect(screen.queryByText("Mão levantada")).toBeNull();
      view.rerender(<OnlineStudents {...props({ hands: [hand(bruno, "2026-10-14T10:04:00Z", "E o chown?")] })} />);
      expect(card("Bruno Lima").getByText("Mão levantada")).toBeDefined();
      expect(card("Bruno Lima").getByText("E o chown?")).toBeDefined();
      view.rerender(<OnlineStudents {...props()} />);
      expect(screen.queryByText("Mão levantada")).toBeNull();
    });

    it("tells the wait again as the minutes pass", () => {
      render(<OnlineStudents {...props({ hands: [hand(ana, "2026-10-14T10:00:00Z")] })} />);
      expect(card("Ana Souza").getByText("há 5 min")).toBeDefined();
      act(() => void vi.advanceTimersByTime(60_000));
      expect(card("Ana Souza").getByText("há 6 min")).toBeDefined();
    });

    it("shows no mark for a hand of someone who is not on a card", () => {
      render(<OnlineStudents {...props({ online: ["u-1"], hands: [hand(bruno, "2026-10-14T10:00:00Z", "oi")] })} />);
      expect(screen.queryByText("Mão levantada")).toBeNull();
      expect(screen.queryByText("oi")).toBeNull();
    });
  });

  describe("the new messages", () => {
    it("shows the counter, in words, only on the card that has new messages", () => {
      render(<OnlineStudents {...props({ unread: { "u-1": 1, "u-2": 3, "u-3": 0 } })} />);
      expect(card("Ana Souza").getByText("1 nova")).toBeDefined();
      expect(card("Bruno Lima").getByText("3 novas")).toBeDefined();
      expect(card("Carla Dias").queryByText(/nova/)).toBeNull();
    });

    it("shows no counter when nobody has new messages", () => {
      render(<OnlineStudents {...props()} />);
      expect(screen.queryByText(/nova/)).toBeNull();
    });

    it("does not show the counter of a student who is not on a card", () => {
      render(<OnlineStudents {...props({ online: ["u-1"], unread: { "u-2": 4 } })} />);
      expect(screen.queryByText("4 novas")).toBeNull();
    });
  });

  describe("the order", () => {
    it("puts the raised hands first, the oldest first, whatever the order of the line", () => {
      render(
        <OnlineStudents
          {...props({
            admitted: [ana, bruno, carla, davi],
            online: ["u-1", "u-2", "u-3", "u-4"],
            hands: [hand(carla, "2026-10-14T10:03:00Z"), hand(davi, "2026-10-14T10:01:00Z")],
          })}
        />,
      );
      expect(names()).toEqual(["Davi Rocha", "Carla Dias", "Ana Souza", "Bruno Lima"]);
    });

    it("puts who has new messages after the hands and before the others, and then goes by name", () => {
      render(
        <OnlineStudents
          {...props({
            admitted: [ana, bruno, carla, davi],
            online: ["u-1", "u-2", "u-3", "u-4"],
            hands: [hand(davi, "2026-10-14T10:01:00Z")],
            unread: { "u-3": 1, "u-2": 5 },
          })}
        />,
      );
      expect(names()).toEqual(["Davi Rocha", "Bruno Lima", "Carla Dias", "Ana Souza"]);
    });

    it("keeps a hand above the new messages even when the hand is the newest and the messages are many", () => {
      render(
        <OnlineStudents
          {...props({ hands: [hand(carla, "2026-10-14T10:04:59Z")], unread: { "u-1": 9, "u-3": 1 } })}
        />,
      );
      expect(names()).toEqual(["Carla Dias", "Ana Souza", "Bruno Lima"]);
    });

    it("goes by name in Portuguese order, so an accent does not send the name to the end", () => {
      const students = [
        { studentId: "u-1", name: "Zélia" },
        { studentId: "u-2", name: "Álvaro" },
        { studentId: "u-3", name: "Bruno" },
        { studentId: "u-4", name: "érica" },
      ];
      render(<OnlineStudents {...props({ admitted: students, online: ["u-1", "u-2", "u-3", "u-4"] })} />);
      expect(names()).toEqual(["Álvaro", "Bruno", "érica", "Zélia"]);
    });

    it("moves a card up as soon as its hand goes up, and back when it goes down", () => {
      const view = render(<OnlineStudents {...props()} />);
      expect(names()).toEqual(["Ana Souza", "Bruno Lima", "Carla Dias"]);
      view.rerender(<OnlineStudents {...props({ hands: [hand(carla, "2026-10-14T10:04:00Z")] })} />);
      expect(names()).toEqual(["Carla Dias", "Ana Souza", "Bruno Lima"]);
      view.rerender(<OnlineStudents {...props()} />);
      expect(names()).toEqual(["Ana Souza", "Bruno Lima", "Carla Dias"]);
    });
  });

  describe("the conversation that is open", () => {
    it("marks the button of the card of the student whose conversation is open, and no other", () => {
      render(<OnlineStudents {...props({ selected: { studentId: "u-2" } })} />);
      expect(screen.getByRole("button", { name: "Conversar com Bruno Lima" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: "Conversar com Ana Souza" }).getAttribute("aria-pressed")).toBe("false");
      expect(screen.getByRole("button", { name: "Mensagem para todos" }).getAttribute("aria-pressed")).toBe("false");
    });

    it("marks the button for everybody when the channel of the class is open, and no card", () => {
      render(<OnlineStudents {...props({ selected: "all" })} />);
      expect(screen.getByRole("button", { name: "Mensagem para todos" }).getAttribute("aria-pressed")).toBe("true");
      for (const name of ["Ana Souza", "Bruno Lima", "Carla Dias"]) {
        expect(screen.getByRole("button", { name: `Conversar com ${name}` }).getAttribute("aria-pressed")).toBe("false");
      }
    });

    it("marks nothing when no conversation is open", () => {
      render(<OnlineStudents {...props()} />);
      expect(screen.getAllByRole("button").every((button) => button.getAttribute("aria-pressed") === "false")).toBe(true);
    });
  });

  it("uses only the tokens of the theme, with no color written in the style", () => {
    const css = styleOf("./OnlineStudents.module.scss");
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/\bhsla?\(/);
  });
});

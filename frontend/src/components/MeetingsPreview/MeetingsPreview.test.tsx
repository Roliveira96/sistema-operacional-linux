import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MeetingDraft } from "@/components/MeetingsEditor/MeetingsEditor";
import { MeetingsPreview } from "./MeetingsPreview";

afterEach(cleanup);

const monday: MeetingDraft = { key: "a", weekday: 1, startTime: "08:20", endTime: "10:00", lessonCount: 2, mode: "IN_PERSON" };

function markedDates(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-marker]")).map((m) => m.closest("[data-date]")?.getAttribute("data-date") ?? "");
}

describe("MeetingsPreview (SPEC-044)", () => {
  // CA-09
  it("marks every day of the term that falls on a weekday with a meeting, with time and lessons", () => {
    const { container } = render(<MeetingsPreview startDate="2026-10-05" endDate="2026-10-31" meetings={[monday]} color="blue" />);
    expect(screen.getByText("outubro de 2026")).toBeDefined();
    expect(markedDates(container)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    const first = container.querySelector('[data-date="2026-10-05"] [data-marker]');
    expect(first?.textContent).toContain("08:20");
    expect(first?.textContent).toContain("2 aulas");
    expect(first?.getAttribute("data-color")).toBe("blue");
  });

  // CA-09
  it("shows more than one meeting of the same day", () => {
    const second: MeetingDraft = { ...monday, key: "b", startTime: "10:20", endTime: "12:00", lessonCount: 1 };
    const { container } = render(<MeetingsPreview startDate="2026-10-05" endDate="2026-10-09" meetings={[monday, second]} color="orange" />);
    const markers = container.querySelectorAll('[data-date="2026-10-05"] [data-marker]');
    expect(markers).toHaveLength(2);
    expect(markers[1]?.textContent).toContain("1 aula");
    expect(markers[1]?.textContent).not.toContain("1 aulas");
  });

  // CA-10
  it("updates at once when the meetings or the dates change", () => {
    const { container, rerender } = render(<MeetingsPreview startDate="2026-10-05" endDate="2026-10-31" meetings={[monday]} color="blue" />);
    rerender(<MeetingsPreview startDate="2026-10-05" endDate="2026-10-31" meetings={[{ ...monday, weekday: 3, startTime: "13:50" }]} color="blue" />);
    expect(markedDates(container)).toEqual(["2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28"]);
    rerender(<MeetingsPreview startDate="2026-10-05" endDate="2026-10-15" meetings={[{ ...monday, weekday: 3 }]} color="blue" />);
    expect(markedDates(container)).toEqual(["2026-10-07", "2026-10-14"]);
  });

  // CA-11
  it("keeps the marks and the navigation inside the term", () => {
    const { container } = render(<MeetingsPreview startDate="2026-10-20" endDate="2026-11-10" meetings={[monday]} color="blue" />);
    expect(markedDates(container)).toEqual(["2026-10-26"]);
    const prev = screen.getByRole("button", { name: "Mês anterior" }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "Próximo mês" }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(screen.getByText("novembro de 2026")).toBeDefined();
    expect(markedDates(container)).toEqual(expect.arrayContaining(["2026-11-02", "2026-11-09"]));
    expect(markedDates(container)).not.toContain("2026-11-16");
    expect(next.disabled).toBe(true);
    expect(prev.disabled).toBe(false);
  });

  // CA-12
  it("asks for the dates when they are missing or inverted", () => {
    const { rerender } = render(<MeetingsPreview startDate="" endDate="" meetings={[monday]} color="blue" />);
    expect(screen.getByText(/Informe as datas de início e fim da turma/)).toBeDefined();
    rerender(<MeetingsPreview startDate="2026-12-01" endDate="2026-10-01" meetings={[monday]} color="blue" />);
    expect(screen.getByText(/Informe as datas de início e fim da turma/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Próximo mês" })).toBeNull();
  });

  // CA-12
  it("says there are no schedules yet when no weekday is marked", () => {
    render(<MeetingsPreview startDate="2026-10-05" endDate="2026-10-31" meetings={[]} color="blue" />);
    expect(screen.getByText(/Marque os dias da semana/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Próximo mês" })).toBeNull();
  });
});

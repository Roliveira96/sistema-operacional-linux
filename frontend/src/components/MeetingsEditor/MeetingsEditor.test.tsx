import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeetingsEditor, validateMeetingDrafts, type MeetingDraft } from "./MeetingsEditor";

afterEach(() => cleanup());

function Harness({ initial = [], onChange }: { initial?: MeetingDraft[]; onChange?: (m: MeetingDraft[]) => void }) {
  const [value, setValue] = useState<MeetingDraft[]>(initial);
  return (
    <MeetingsEditor
      value={value}
      errors={validateMeetingDrafts(value)}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

// SPEC-042, section 3.1.1 (CA-01, CA-02).
describe("MeetingsEditor", () => {
  it("turns a day on with default times and suggests the lessons by the duration", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const monday = screen.getByRole("button", { name: "Segunda-feira" });
    expect(monday.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(monday);
    expect(monday.getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("Início (Segunda-feira)") as HTMLInputElement).value).toBe("08:20");
    expect((screen.getByLabelText("Aulas (Segunda-feira)") as HTMLInputElement).value).toBe("2");

    fireEvent.change(screen.getByLabelText("Fim (Segunda-feira)"), { target: { value: "11:40" } });
    expect((screen.getByLabelText("Aulas (Segunda-feira)") as HTMLInputElement).value).toBe("4");
    expect(screen.getByText("4 horas-aula por semana")).toBeDefined();
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ weekday: 1, startTime: "08:20", endTime: "11:40", lessonCount: 4, mode: "IN_PERSON" })]);
  });

  it("asks for an https link when online and shows the room only in person", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Quarta-feira" }));
    expect(screen.getByLabelText("Sala (Quarta-feira)")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Modalidade (Quarta-feira)"), { target: { value: "ONLINE" } });
    expect(screen.queryByLabelText("Sala (Quarta-feira)")).toBeNull();
    const link = screen.getByLabelText("Link (Quarta-feira)");
    expect(screen.getByText("Informe um link https.")).toBeDefined();
    fireEvent.change(link, { target: { value: "https://meet.google.com/abc" } });
    expect(screen.queryByText("Informe um link https.")).toBeNull();
  });

  it("adds a second time on the same day, flags an overlap and removes a time", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Segunda-feira" }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar outro horário (Segunda-feira)" }));
    const starts = screen.getAllByLabelText("Início (Segunda-feira)");
    expect(starts).toHaveLength(2);
    fireEvent.change(starts[1]!, { target: { value: "09:00" } });
    expect(screen.getAllByText("Sobrepõe outro horário do mesmo dia.").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Remover horário (Segunda-feira)" })[1]!);
    expect(screen.getAllByLabelText("Início (Segunda-feira)")).toHaveLength(1);
    expect(screen.queryByText("Sobrepõe outro horário do mesmo dia.")).toBeNull();
  });

  it("flags an end before the start and turns the day off", () => {
    render(<Harness initial={[{ key: "k1", weekday: 5, startTime: "14:00", endTime: "15:40", lessonCount: 2, mode: "IN_PERSON" }]} />);
    fireEvent.change(screen.getByLabelText("Fim (Sexta-feira)"), { target: { value: "13:00" } });
    expect(screen.getByText("O fim deve ser depois do início.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Sexta-feira" }));
    expect(screen.queryByLabelText("Início (Sexta-feira)")).toBeNull();
    expect(screen.getByText(/Escolha os dias da semana/)).toBeDefined();
  });

  it("validates the drafts", () => {
    expect(validateMeetingDrafts([])).toEqual({});
    const errors = validateMeetingDrafts([
      { key: "a", weekday: 1, startTime: "08:20", endTime: "10:00", lessonCount: 2, mode: "IN_PERSON" },
      { key: "b", weekday: 1, startTime: "09:00", endTime: "10:00", lessonCount: 1, mode: "ONLINE", onlineUrl: "http://x" },
    ]);
    expect(errors.a).toBe("Sobrepõe outro horário do mesmo dia.");
    expect(errors.b).toBe("Informe um link https.");
  });
});

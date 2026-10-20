import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Timeline, TimelineEntry } from "@/services/scheduleService";
import { session } from "@/test/scheduleFixtures";
import { ClassTimeline } from "./ClassTimeline";

const entry = (id: string, date: string, start: string, end: string, over: Partial<TimelineEntry> = {}): TimelineEntry => ({
  ...session({ id, date, startTime: start, endTime: end }),
  startsAt: `${date}T${start}:00-03:00`,
  endsAt: `${date}T${end}:00-03:00`,
  liveSessionCount: 0,
  commandCount: 0,
  materialCount: 0,
  ...over,
});

const timeline: Timeline = {
  now: "2026-10-19T09:00:00-03:00",
  current: entry("s-19", "2026-10-19", "08:20", "10:00", { topic: "Permissões de arquivos" }),
  past: [entry("s-14", "2026-10-14", "13:50", "15:30", { topic: "Processos" })],
  upcoming: [entry("s-21", "2026-10-21", "13:50", "15:30", { topic: "Usuários e grupos" }), entry("s-26", "2026-10-26", "08:20", "10:00")],
  liveSessionId: null,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function setup(role: "teacher" | "student", onConvert?: (session: TimelineEntry) => void) {
  render(
    <ClassTimeline
      classId="c-1"
      courseCode="SO34E"
      role={role}
      load={vi.fn().mockResolvedValue(timeline)}
      loadDiary={vi.fn()}
      loadCommands={vi.fn()}
      liveHref="/app/classes/c-1/live"
      onConvert={onConvert}
    />,
  );
  await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
}

const block = (name: string) => within(screen.getByRole("region", { name: "Linha do tempo da turma" })).getByRole("region", { name });
const convert = /^Transformar em avaliação$/;

// SPEC-075 CA-25: the card of a lesson on the timeline offers "Transformar em avaliação".
describe("ClassTimeline: transform a lesson into an assessment", () => {
  it("offers it to the teacher on the current lesson and on each upcoming one, and not on the past ones", async () => {
    await setup("teacher", vi.fn());
    expect(within(block("Aula atual")).getAllByRole("button", { name: convert })).toHaveLength(1);
    expect(within(block("Próximas aulas")).getAllByRole("button", { name: convert })).toHaveLength(2);
    expect(within(block("Aulas passadas")).queryByRole("button", { name: convert })).toBeNull();
  });

  it("hands over the lesson of the card that was pressed", async () => {
    const onConvert = vi.fn();
    await setup("teacher", onConvert);
    const second = within(block("Próximas aulas")).getAllByRole("listitem")[0]!;
    fireEvent.click(within(second).getByRole("button", { name: convert }));
    expect(onConvert).toHaveBeenCalledWith(expect.objectContaining({ id: "s-21", topic: "Usuários e grupos" }));
    fireEvent.click(within(block("Aula atual")).getByRole("button", { name: convert }));
    expect(onConvert).toHaveBeenLastCalledWith(expect.objectContaining({ id: "s-19" }));
  });

  it("does not offer it to the student, nor to a teacher who is not given the way to do it", async () => {
    await setup("student", vi.fn());
    expect(screen.queryByRole("button", { name: convert })).toBeNull();
    cleanup();
    await setup("teacher");
    expect(screen.queryByRole("button", { name: convert })).toBeNull();
  });
});

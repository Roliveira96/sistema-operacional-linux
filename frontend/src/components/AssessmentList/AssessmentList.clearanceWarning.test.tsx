import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STARTED, summary } from "@/test/assessmentFixtures";
import type { AssessmentSummary } from "@/services/assessmentService";
import { AssessmentList } from "./AssessmentList";

afterEach(cleanup);

// 10:00 is the clock of the server. An exam that the teacher started at 09:07 is running, with three students who still wait.
const waiting = (over: Partial<AssessmentSummary> = {}) =>
  summary({
    id: "a-1",
    title: "Prova 1: permissões",
    ...STARTED,
    clearanceCounts: { pending: 3, approved: 29, rejected: 0 },
    ...over,
  });

/** An exam that is still days away, with who waits counted but nothing to warn about. */
const far = (over: Partial<AssessmentSummary> = {}) =>
  waiting({
    phase: "UPCOMING",
    startsAt: "2026-10-23T09:00:00-03:00",
    endsAt: "2026-10-23T11:00:00-03:00",
    startedAt: undefined,
    startedBy: undefined,
    startedByName: undefined,
    ...over,
  });

/** An exam that is running by the clock and that the teacher has not started. */
const ready = (over: Partial<AssessmentSummary> = {}) =>
  summary({ id: "a-1", title: "Prova 1: permissões", phase: "RUNNING", startsAt: "2026-10-21T09:00:00-03:00", endsAt: "2026-10-21T11:00:00-03:00", ...over });

function setup(items: AssessmentSummary[]) {
  const h = {
    onNew: vi.fn(), onRetry: vi.fn(), onEdit: vi.fn(), onPreview: vi.fn(), onReschedule: vi.fn(), onCancel: vi.fn(),
    onApproveAll: vi.fn(), onClearances: vi.fn(), onStart: vi.fn(),
  };
  render(<AssessmentList status="ready" items={items} hrefOf={(a) => `/app/classes/c-1/assessments/${a.id}`} {...h} />);
  return h;
}

const rowOf = (title: string) => screen.getByRole("row", { name: new RegExp(title) });
const warning = () => screen.queryByRole("status");

// SPEC-076 CA-15 with SPEC-091 CA-03 (RN-03): the modality is in the list, and nothing of a clearance: no one waits for one, and no warning about it.
describe("AssessmentList: modality, without the clearance", () => {
  it("says the modality under the title, and no count of who waits", () => {
    setup([far(), summary({ id: "a-2", title: "Prova online", modality: "ONLINE", requiresClearance: false })]);
    const first = (title: string) => within(rowOf(title)).getAllByRole("cell")[0]!;
    expect(within(first("Prova 1: permissões")).getByText("Prova · Presencial · 10,00 pontos")).toBeDefined();
    expect(within(first("Prova 1: permissões")).queryByText(/aguardando/)).toBeNull();
    expect(within(first("Prova online")).getByText("Prova · Online · 10,00 pontos")).toBeDefined();
  });

  it("does not warn about who waits, even with the exam started and students counted as waiting", () => {
    setup([waiting()]);
    expect(warning()).toBeNull();
    expect(screen.queryByRole("button", { name: "Habilitar todos" })).toBeNull();
  });
});

// SPEC-083 CA-12, D-03, D-06: an exam that can be started says so, with the button; once started, that gives way to the warning of who waits.
describe("AssessmentList: the exam can be started", () => {
  it("says the exam can be started when it is running and the teacher has not started it, and the button asks to start it", () => {
    const h = setup([ready()]);
    const alert = warning()!;
    expect(alert.textContent).toContain("Prova 1: permissões: a prova já pode ser iniciada.");
    fireEvent.click(within(alert).getByRole("button", { name: "Iniciar a prova" }));
    expect(h.onStart).toHaveBeenCalledWith(expect.objectContaining({ id: "a-1" }));
  });

  it("says it also when the exam does not require the clearance, because the start is what opens the door", () => {
    setup([ready({ requiresClearance: false })]);
    expect(warning()!.textContent).toContain("a prova já pode ser iniciada");
  });

  it("does not say it before the start time, after the end, once started, in an assignment or in a canceled one", () => {
    setup([
      summary({ id: "a-1", title: "Longe" }),
      ready({ id: "a-2", title: "Acabou", phase: "ENDED", endsAt: "2026-10-21T09:30:00-03:00" }),
      waiting({ id: "a-3", title: "Iniciada", clearanceCounts: { pending: 0, approved: 32, rejected: 0 } }),
      ready({ id: "a-4", title: "Atividade", type: "ASSIGNMENT", modality: "ONLINE", requiresClearance: false }), // SPEC-089 D-01
      ready({ id: "a-5", title: "Cancelada", status: "CANCELED", cancelReason: "Greve" }),
    ]);
    expect(warning()).toBeNull();
  });

});

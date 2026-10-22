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

// SPEC-076 CA-15, RN-13 as SPEC-083 changes it: the modality and the students who wait are in the list, and the warning of who waits comes only
// after the teacher started the exam.
describe("AssessmentList: modality and clearance warning", () => {
  it("says the modality under the title and counts who still waits in an in-person exam that requires the clearance", () => {
    setup([
      far(),
      summary({ id: "a-2", title: "Prova online", modality: "ONLINE", requiresClearance: false, clearanceCounts: { pending: 32, approved: 0, rejected: 0 } }),
      summary({ id: "a-3", title: "Prova livre", requiresClearance: false, clearanceCounts: { pending: 32, approved: 0, rejected: 0 } }),
    ]);
    const first = (title: string) => within(rowOf(title)).getAllByRole("cell")[0]!;
    expect(within(first("Prova 1: permissões")).getByText("Prova · Presencial · 10,00 pontos")).toBeDefined();
    expect(within(first("Prova 1: permissões")).getByText("3 aguardando")).toBeDefined();
    expect(within(first("Prova online")).getByText("Prova · Online · 10,00 pontos")).toBeDefined();
    expect(within(first("Prova online")).queryByText(/aguardando/)).toBeNull();
    expect(within(first("Prova livre")).queryByText(/aguardando/)).toBeNull();
  });

  it("says one student waits in the singular", () => {
    setup([far({ clearanceCounts: { pending: 1, approved: 31, rejected: 0 } })]);
    expect(within(within(rowOf("Prova 1: permissões")).getAllByRole("cell")[0]!).getByText("1 aguardando")).toBeDefined();
  });

  it("warns when the exam was started and there are students waiting, with the way to clear them all and to see them", () => {
    const h = setup([waiting()]);
    const alert = warning()!;
    expect(alert.textContent).toContain("3 alunos ainda não foram habilitados");
    fireEvent.click(within(alert).getByRole("button", { name: "Habilitar todos" }));
    expect(h.onApproveAll).toHaveBeenCalledWith(expect.objectContaining({ id: "a-1" }));
    fireEvent.click(within(alert).getByRole("button", { name: "Ver habilitações" }));
    expect(h.onClearances).toHaveBeenCalledWith(expect.objectContaining({ id: "a-1" }));
  });

  it("says it in the singular for a student", () => {
    setup([waiting({ clearanceCounts: { pending: 1, approved: 31, rejected: 0 } })]);
    expect(warning()!.textContent).toContain("1 aluno ainda não foi habilitado");
  });

  // SPEC-083 D-07: before the start there is nothing to clear, not even 30 minutes before it.
  it("does not warn about who waits before the teacher starts the exam, not even close to the start time", () => {
    setup([
      waiting({ id: "a-1", title: "Meia hora antes", phase: "UPCOMING", startedAt: undefined, startedBy: undefined, startedByName: undefined, startsAt: "2026-10-21T10:30:00-03:00", endsAt: "2026-10-21T12:00:00-03:00" }),
    ]);
    expect(warning()).toBeNull();
    cleanup();
    setup([waiting({ startedAt: undefined, startedBy: undefined, startedByName: undefined })]);
    expect(warning()!.textContent).not.toContain("não foram habilitados");
  });

  it("does not warn about who waits when nobody waits, when the exam is over, canceled, online or does not require it", () => {
    setup([
      waiting({ id: "a-1", title: "Sem ninguém", clearanceCounts: { pending: 0, approved: 32, rejected: 0 } }),
      waiting({ id: "a-3", title: "Acabou", phase: "ENDED", startsAt: "2026-10-21T08:00:00-03:00", endsAt: "2026-10-21T09:30:00-03:00" }),
      waiting({ id: "a-4", title: "Cancelada", status: "CANCELED", cancelReason: "Falta de energia" }),
      waiting({ id: "a-5", title: "Online", modality: "ONLINE", requiresClearance: false, startedAt: undefined, startedBy: undefined, startedByName: undefined }),
      waiting({ id: "a-6", title: "Sem exigência", requiresClearance: false }),
    ]);
    expect(warning()).toBeNull();
  });

  it("puts the warning with its own assessment, one for each", () => {
    setup([waiting({ id: "a-1", title: "Prova da manhã" }), waiting({ id: "a-2", title: "Prova da tarde", clearanceCounts: { pending: 5, approved: 27, rejected: 0 } })]);
    const alerts = screen.getAllByRole("status");
    expect(alerts).toHaveLength(2);
    expect(alerts[0]!.textContent).toContain("Prova da manhã");
    expect(alerts[1]!.textContent).toContain("5 alunos ainda não foram habilitados");
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

  it("does not say it before the start time, after the end, once started, in an online assessment or in a canceled one", () => {
    setup([
      summary({ id: "a-1", title: "Longe" }),
      ready({ id: "a-2", title: "Acabou", phase: "ENDED", endsAt: "2026-10-21T09:30:00-03:00" }),
      waiting({ id: "a-3", title: "Iniciada", clearanceCounts: { pending: 0, approved: 32, rejected: 0 } }),
      ready({ id: "a-4", title: "Online", modality: "ONLINE", requiresClearance: false }),
      ready({ id: "a-5", title: "Cancelada", status: "CANCELED", cancelReason: "Greve" }),
    ]);
    expect(warning()).toBeNull();
  });

  it("gives the place to the warning of who waits once the exam is started: one at a time", () => {
    setup([waiting()]);
    expect(warning()!.textContent).not.toContain("já pode ser iniciada");
    expect(screen.queryByRole("button", { name: "Iniciar a prova" })).toBeNull();
  });
});

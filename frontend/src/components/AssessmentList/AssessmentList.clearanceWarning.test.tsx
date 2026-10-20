import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVER_NOW, summary } from "@/test/assessmentFixtures";
import type { AssessmentSummary } from "@/services/assessmentService";
import { AssessmentList } from "./AssessmentList";

afterEach(cleanup);

// 10:00 is the clock of the server; the assessments below start at 10:30, 10:31 and 09:00.
const waiting = (over: Partial<AssessmentSummary> = {}) =>
  summary({
    id: "a-1",
    title: "Prova 1: permissões",
    startsAt: "2026-10-21T10:30:00-03:00",
    endsAt: "2026-10-21T12:00:00-03:00",
    clearanceCounts: { pending: 3, approved: 29, rejected: 0 },
    ...over,
  });

function setup(items: AssessmentSummary[]) {
  const h = { onNew: vi.fn(), onRetry: vi.fn(), onView: vi.fn(), onEdit: vi.fn(), onPreview: vi.fn(), onReschedule: vi.fn(), onCancel: vi.fn(), onApproveAll: vi.fn(), onClearances: vi.fn() };
  render(<AssessmentList status="ready" items={items} serverNow={SERVER_NOW} {...h} />);
  return h;
}

const rowOf = (title: string) => screen.getByRole("row", { name: new RegExp(title) });
const warning = () => screen.queryByRole("status");

// SPEC-076 CA-15, RN-13: the modality and the students who wait are in the list, and the warning comes when the exam is about to start or is on.
describe("AssessmentList: modality and clearance warning", () => {
  it("has a column for the modality and counts who still waits in an in-person exam that requires the clearance", () => {
    setup([
      waiting({ startsAt: "2026-10-23T09:00:00-03:00", endsAt: "2026-10-23T11:00:00-03:00" }),
      summary({ id: "a-2", title: "Prova online", modality: "ONLINE", requiresClearance: false, clearanceCounts: { pending: 32, approved: 0, rejected: 0 } }),
      summary({ id: "a-3", title: "Prova livre", requiresClearance: false, clearanceCounts: { pending: 32, approved: 0, rejected: 0 } }),
    ]);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Tipo", "Modalidade", "Título", "Período", "Situação", "Nota máxima", "Composição", "Elegíveis", "Ações",
    ]);
    const cell = (title: string) => within(rowOf(title)).getAllByRole("cell")[1]!.textContent;
    expect(cell("Prova 1: permissões")).toBe("Presencial3 aguardando");
    expect(cell("Prova online")).toBe("Online");
    expect(cell("Prova livre")).toBe("Presencial");
  });

  it("says one student waits in the singular", () => {
    setup([waiting({ startsAt: "2026-10-23T09:00:00-03:00", endsAt: "2026-10-23T11:00:00-03:00", clearanceCounts: { pending: 1, approved: 31, rejected: 0 } })]);
    expect(within(rowOf("Prova 1: permissões")).getAllByRole("cell")[1]!.textContent).toBe("Presencial1 aguardando");
  });

  it("warns when there are students waiting and the exam starts in 30 minutes or less, with the way to clear them all and to see them", () => {
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

  it("is on at 30 minutes exactly, and not a minute before", () => {
    setup([waiting({ startsAt: "2026-10-21T10:30:00-03:00" })]);
    expect(warning()).not.toBeNull();
    cleanup();
    setup([waiting({ startsAt: "2026-10-21T10:31:00-03:00", endsAt: "2026-10-21T12:00:00-03:00" })]);
    expect(warning()).toBeNull();
  });

  it("keeps warning while the exam runs, because who arrives late can still be cleared", () => {
    setup([waiting({ startsAt: "2026-10-21T09:00:00-03:00", endsAt: "2026-10-21T11:00:00-03:00", phase: "RUNNING" })]);
    expect(warning()!.textContent).toContain("3 alunos ainda não foram habilitados");
  });

  it("does not warn when nobody waits, when the exam is far, over, canceled, online or does not require it", () => {
    setup([
      waiting({ id: "a-1", title: "Sem ninguém", clearanceCounts: { pending: 0, approved: 32, rejected: 0 } }),
      waiting({ id: "a-2", title: "Longe", startsAt: "2026-10-23T09:00:00-03:00", endsAt: "2026-10-23T11:00:00-03:00" }),
      waiting({ id: "a-3", title: "Acabou", startsAt: "2026-10-21T08:00:00-03:00", endsAt: "2026-10-21T09:30:00-03:00", phase: "ENDED" }),
      waiting({ id: "a-4", title: "Cancelada", status: "CANCELED", cancelReason: "Falta de energia" }),
      waiting({ id: "a-5", title: "Online", modality: "ONLINE", requiresClearance: false }),
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

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { summary } from "@/test/assessmentFixtures";
import type { AssessmentSummary } from "@/services/assessmentService";
import { AssessmentList } from "./AssessmentList";

afterEach(cleanup);

function setup(items: AssessmentSummary[]) {
  const h = { onNew: vi.fn(), onRetry: vi.fn(), onEdit: vi.fn(), onPreview: vi.fn(), onReschedule: vi.fn(), onCancel: vi.fn() };
  render(<AssessmentList status="ready" items={items} hrefOf={(a) => `/app/classes/c-1/assessments/${a.id}`} {...h} />);
}

const on = (id: string, title: string, day: number, over: Partial<AssessmentSummary> = {}) =>
  summary({ id, title, startsAt: `2026-10-${day}T09:00:00-03:00`, endsAt: `2026-10-${day}T11:00:00-03:00`, ...over });

const headings = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
/** The titles of a section, in the order they are shown. */
const titlesOf = (heading: string) => {
  const section = screen.getByRole("heading", { name: heading }).closest("section")!;
  return within(section).getAllByRole("link").map((l) => l.textContent);
};

// SPEC-080 CA-01 and CA-02: the assessments in sections by situation, with what matters now on top.
describe("AssessmentList sections", () => {
  const all = () => [
    on("a-1", "Passada antiga", 5, { phase: "ENDED" }),
    on("a-2", "Futura longe", 28, { phase: "UPCOMING" }),
    on("a-3", "Passada recente", 15, { phase: "ENDED" }),
    on("a-4", "Em curso", 21, { phase: "RUNNING" }),
    on("a-5", "Futura perto", 23, { phase: "UPCOMING" }),
    on("a-6", "Desfeita", 24, { phase: "UPCOMING", status: "CANCELED", cancelReason: "Falta de energia" }),
    on("a-7", "Outra em curso", 21, { phase: "RUNNING", startsAt: "2026-10-21T08:00:00-03:00", endsAt: "2026-10-21T12:00:00-03:00" }),
  ];

  it("groups them as Em andamento, Agendadas, Encerradas and Canceladas, in that order, each with its count", () => {
    setup(all());
    expect(headings()).toEqual(["Em andamento (2)", "Agendadas (2)", "Encerradas (2)", "Canceladas (1)"]);
  });

  it("puts a canceled assessment among the canceled whatever its phase", () => {
    setup(all());
    expect(titlesOf("Canceladas (1)")).toEqual(["Desfeita"]);
    expect(titlesOf("Agendadas (2)")).not.toContain("Desfeita");
  });

  it("shows first the one that starts first among the running and the scheduled, and the latest first among the ended", () => {
    setup(all());
    expect(titlesOf("Em andamento (2)")).toEqual(["Outra em curso", "Em curso"]);
    expect(titlesOf("Agendadas (2)")).toEqual(["Futura perto", "Futura longe"]);
    expect(titlesOf("Encerradas (2)")).toEqual(["Passada recente", "Passada antiga"]);
  });

  it("leaves out a section that has no assessment", () => {
    setup([on("a-1", "Só uma", 23, { phase: "UPCOMING" })]);
    expect(headings()).toEqual(["Agendadas (1)"]);
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });

  it("ties each table to the heading of its section", () => {
    setup(all());
    for (const heading of headings()) expect(screen.getByRole("table", { name: heading })).toBeDefined();
  });
});

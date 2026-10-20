import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assessmentService, type ClearanceList } from "@/services/assessmentService";
import { problem } from "@/test/helpers";
import { clearanceItems, clearanceList, detail } from "@/test/assessmentFixtures";
import ClearancesPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const params = Promise.resolve({ id: "c-1", assessmentId: "a-1" });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(list: ClearanceList = clearanceList(), over = {}) {
  const read = vi.spyOn(assessmentService, "clearances").mockResolvedValue(list);
  vi.spyOn(assessmentService, "get").mockResolvedValue(detail(over));
  const decide = vi.spyOn(assessmentService, "decideClearances");
  render(<ClearancesPage params={params} />);
  return { read, decide };
}

const row = (name: string) => screen.getByRole("row", { name: new RegExp(name) });
const count = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling!.textContent;

/** The list after an action, which is what the server answers. */
const after = (...changes: Array<[string, Partial<ClearanceList["items"][number]>]>): ClearanceList => {
  const items = clearanceItems().map((it) => ({ ...it, ...(changes.find(([id]) => id === it.studentId)?.[1] ?? {}) }));
  const pending = items.filter((i) => i.status === "PENDING").length;
  const approved = items.filter((i) => i.status === "APPROVED").length;
  return clearanceList({ items, counts: { pending, approved, rejected: items.length - pending - approved } });
};

// SPEC-076 CA-16, RN-04, RN-06, RN-10: the screen of the clearances of the teacher.
describe("clearances page", () => {
  it("shows the students by state, the counters and the way back to the assessment", async () => {
    const { read } = setup();
    expect(await screen.findByRole("table")).toBeDefined();
    expect(read).toHaveBeenCalledWith("c-1", "a-1");
    expect(screen.getByText("Prova 1: permissões")).toBeDefined();
    expect(screen.getByRole("link", { name: "Voltar para a avaliação" }).getAttribute("href")).toBe("/app/classes/c-1/assessments/a-1");
    expect(count("Aguardando")).toBe("1");
    expect(count("Habilitados")).toBe("1");
    expect(count("Recusados")).toBe("2");

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Aluno", "RA", "Estado", "Motivo", "Decisão", "Ações"]);
    const cells = (name: string) => within(row(name)).getAllByRole("cell").map((c) => c.textContent);
    expect(cells("Ana Souza").slice(0, 5)).toEqual(["Ana Souza", "1000001", "Aguardando", "", ""]);
    expect(cells("Bruno Lima").slice(0, 5)).toEqual(["Bruno Lima", "1000002", "Habilitado", "", "Profa. Sediane, 21/10/2026 às 09:30"]);
    expect(cells("Carla Dias").slice(0, 5)).toEqual(["Carla Dias", "1000003", "Recusado", "Reprovada por faltas", "Profa. Sediane, 21/10/2026 às 09:31"]);
    expect(cells("Davi Alves")[3]).toBe("Sem motivo informado");
  });

  it("approves everybody who waits with one button, and shows the list the server answers", async () => {
    const { decide } = setup();
    decide.mockResolvedValue(after(["s-1", { status: "APPROVED", clearedAt: "2026-10-21T10:00:00-03:00", clearedByName: "Profa. Sediane" }]));
    const all = (await screen.findByRole("button", { name: "Habilitar todos os que aguardam" })) as HTMLButtonElement;
    expect(all.disabled).toBe(false);
    fireEvent.click(all);
    await waitFor(() => expect(decide).toHaveBeenCalledWith("c-1", "a-1", { action: "APPROVE_ALL" }));
    await waitFor(() => expect(count("Aguardando")).toBe("0"));
    expect(count("Habilitados")).toBe("2");
    expect(within(row("Ana Souza")).getAllByRole("cell")[2]!.textContent).toBe("Habilitado");
    expect((screen.getByRole("button", { name: "Habilitar todos os que aguardam" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("clears a student on their own row, and the ones already cleared have no clearing to do", async () => {
    const { decide } = setup();
    decide.mockResolvedValue(after(["s-1", { status: "APPROVED", clearedByName: "Profa. Sediane", clearedAt: "2026-10-21T10:00:00-03:00" }]));
    await screen.findByRole("table");
    expect((screen.getByRole("button", { name: "Habilitar Bruno Lima" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Habilitar Ana Souza" }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("c-1", "a-1", { action: "UPDATE", students: [{ studentId: "s-1", status: "APPROVED" }] }));
    await waitFor(() => expect(count("Habilitados")).toBe("2"));
  });

  it("clears again a student who was refused", async () => {
    const { decide } = setup();
    decide.mockResolvedValue(after(["s-3", { status: "APPROVED", rejectionReason: undefined }]));
    await screen.findByRole("table");
    expect((screen.getByRole("button", { name: "Habilitar Carla Dias" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Habilitar Carla Dias" }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("c-1", "a-1", { action: "UPDATE", students: [{ studentId: "s-3", status: "APPROVED" }] }));
  });

  it("refuses a student through the dialog, with the reason, and without it", async () => {
    const { decide } = setup();
    decide.mockResolvedValue(after(["s-1", { status: "REJECTED", rejectionReason: "Faltas", clearedByName: "Profa. Sediane", clearedAt: "2026-10-21T10:00:00-03:00" }]));
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Recusar Ana Souza" }));
    const dialog = screen.getByRole("dialog", { name: "Recusar a habilitação de Ana Souza" });
    fireEvent.change(within(dialog).getByLabelText("Motivo (opcional)"), { target: { value: "Faltas" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Recusar" }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("c-1", "a-1", { action: "UPDATE", students: [{ studentId: "s-1", status: "REJECTED", rejectionReason: "Faltas" }] }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(row("Ana Souza")).getAllByRole("cell")[3]!.textContent).toBe("Faltas");

    decide.mockResolvedValue(after(["s-2", { status: "REJECTED", clearedByName: "Profa. Sediane", clearedAt: "2026-10-21T10:00:00-03:00" }]));
    fireEvent.click(screen.getByRole("button", { name: "Recusar Bruno Lima" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Recusar" }));
    await waitFor(() => expect(decide).toHaveBeenLastCalledWith("c-1", "a-1", { action: "UPDATE", students: [{ studentId: "s-2", status: "REJECTED" }] }));
  });

  it("does not offer to refuse who is already refused", async () => {
    setup();
    await screen.findByRole("table");
    expect((screen.getByRole("button", { name: "Recusar Carla Dias" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the dialog open and says why when the server refuses the decision", async () => {
    const { decide } = setup();
    decide.mockRejectedValue(problem("clearance-locked", 409));
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Recusar Ana Souza" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Recusar" }));
    expect((await within(screen.getByRole("dialog")).findByRole("alert")).textContent).toBe("O aluno já começou a prova: a habilitação dele não pode mais mudar.");
  });

  it("says why an action failed, in the page, and leaves the list as it was", async () => {
    const { decide } = setup();
    decide.mockRejectedValue(problem("assessment-ended", 409));
    fireEvent.click(await screen.findByRole("button", { name: "Habilitar todos os que aguardam" }));
    expect((await screen.findByRole("alert")).textContent).toBe("A avaliação já terminou.");
    expect(count("Aguardando")).toBe("1");
  });

  describe("only read", () => {
    const noActions = () => {
      expect(screen.queryByRole("button", { name: "Habilitar todos os que aguardam" })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Habilitar [A-Z]/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Recusar/ })).toBeNull();
    };

    it("tells that an assessment that does not require the clearance has nothing to decide", async () => {
      setup(clearanceList({ requiresClearance: false, counts: { pending: 4, approved: 0, rejected: 0 } }), { requiresClearance: false });
      expect(await screen.findByText("Esta avaliação não exige a habilitação dos alunos.")).toBeDefined();
      noActions();
    });

    it("tells that an ended assessment can only be read", async () => {
      setup(clearanceList(), { phase: "ENDED" });
      expect(await screen.findByText("A avaliação já terminou: as habilitações só podem ser lidas.")).toBeDefined();
      noActions();
      expect(screen.getByText("Carla Dias")).toBeDefined();
    });

    it("tells that a canceled assessment can only be read", async () => {
      setup(clearanceList(), { status: "CANCELED", cancelReason: "Falta de energia" });
      expect(await screen.findByText("A avaliação está cancelada: as habilitações só podem ser lidas.")).toBeDefined();
      noActions();
    });
  });

  it("says it is loading, that there is no student, and that it failed, and tries again", async () => {
    vi.spyOn(assessmentService, "get").mockResolvedValue(detail());
    const read = vi.spyOn(assessmentService, "clearances").mockRejectedValueOnce(new Error("down")).mockResolvedValue(clearanceList({ items: [], counts: { pending: 0, approved: 0, rejected: 0 } }));
    render(<ClearancesPage params={params} />);
    expect(screen.getByRole("status").textContent).toBe("Carregando habilitações…");
    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível carregar as habilitações.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Nenhum aluno elegível")).toBeDefined();
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("table")).toBeNull();
  });
});

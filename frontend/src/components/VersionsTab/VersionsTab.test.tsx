import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiProblemError } from "@/services/httpClient";
import { VersionsTab } from "./VersionsTab";

afterEach(cleanup);

const list = (changed: boolean) => ({
  versions: [
    { number: 2, note: "com permissões", createdAt: "2026-10-09T12:00:00Z", createdBy: "Profa", blockCount: 5, current: true },
    { number: 1, note: "", createdAt: "2026-10-01T12:00:00Z", createdBy: "", blockCount: 0, current: false },
  ],
  hasUnpublishedChanges: changed,
});

const make = (changed = true) => ({ versions: vi.fn().mockResolvedValue(list(changed)), publish: vi.fn().mockResolvedValue({ number: 3 }), restore: vi.fn().mockResolvedValue({ blocks: [] }) });

// Covers SPEC-021 CA-06 to CA-08: publish, see the versions and restore one into the draft.
describe("VersionsTab", () => {
  it("lists the versions with the published one marked, and says there are unpublished changes (CA-07)", async () => {
    render(<VersionsTab moduleId="m1" service={make(true)} />);
    expect(await screen.findByText("Versão 2")).toBeDefined();
    expect(screen.getByText("Versão 1")).toBeDefined();
    expect(screen.getByText(/5 blocos · publicada/)).toBeDefined();
    expect(screen.getByText("com permissões")).toBeDefined();
    expect(screen.getByRole("status")).toHaveTextContent("Há alterações não publicadas");
  });

  it("publishes with the note, then loads the list again (CA-06)", async () => {
    const service = make(true);
    render(<VersionsTab moduleId="m1" service={service} />);
    fireEvent.change(await screen.findByLabelText("Nota da versão (opcional)"), { target: { value: "  revisado " } });
    service.versions.mockResolvedValue(list(false));
    fireEvent.click(screen.getByRole("button", { name: "Publicar nova versão" }));
    expect(await screen.findByText("Versão 3 publicada.")).toBeDefined();
    expect(service.publish).toHaveBeenCalledWith("m1", "  revisado ");
    await waitFor(() => expect((screen.getByRole("button", { name: "Publicar nova versão" }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText("O rascunho é igual à versão publicada.")).toBeDefined();
  });

  it("does not offer to publish when the draft has no changes, and tells when the server refuses", async () => {
    const service = make(false);
    render(<VersionsTab moduleId="m1" service={service} />);
    expect((await screen.findByRole("button", { name: "Publicar nova versão" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    const stale = make(true);
    stale.publish.mockRejectedValue(new ApiProblemError({ type: "no-changes", title: "No changes" }, 409));
    render(<VersionsTab moduleId="m1" service={stale} />);
    fireEvent.click(await screen.findByRole("button", { name: "Publicar nova versão" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não há alterações para publicar.");
  });

  it("restores a version into the draft only after confirming (CA-08)", async () => {
    const service = make(false);
    const confirm = vi.fn().mockReturnValue(false);
    render(<VersionsTab moduleId="m1" service={service} confirm={confirm} />);
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar a versão 1 no rascunho" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("versão 1"));
    expect(service.restore).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    service.versions.mockResolvedValue(list(true));
    fireEvent.click(screen.getByRole("button", { name: "Restaurar a versão 1 no rascunho" }));
    expect(await screen.findByText(/Versão 1 copiada para o rascunho/)).toBeDefined();
    expect(service.restore).toHaveBeenCalledWith("m1", 1);
    expect(screen.getByText("Há alterações não publicadas. Os alunos ainda veem a versão atual.")).toBeDefined();
  });

  it("says so when the versions cannot be loaded or an action fails", async () => {
    const broken = { versions: vi.fn().mockRejectedValue(new Error("x")), publish: vi.fn(), restore: vi.fn() };
    render(<VersionsTab moduleId="m1" service={broken} />);
    expect(await screen.findByText("Não foi possível carregar as versões.")).toBeDefined();
    cleanup();

    const service = make(true);
    service.publish.mockRejectedValue(new Error("x"));
    render(<VersionsTab moduleId="m1" service={service} />);
    fireEvent.click(await screen.findByRole("button", { name: "Publicar nova versão" }));
    expect(await screen.findByText("Não foi possível publicar.")).toBeDefined();
  });
});

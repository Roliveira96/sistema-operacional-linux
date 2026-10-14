import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classService, type ClassLinkItem } from "@/services/classService";
import { ApiProblemError } from "@/services/httpClient";
import { ClassLinks } from "./ClassLinks";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const meet: ClassLinkItem = { id: "l-1", name: "Link do Meet", url: "https://meet.google.com/abc", position: 0 };
const content: ClassLinkItem = { id: "l-2", name: "Conteúdo da aula 3", url: "https://example.com/aula-3", position: 1 };

function load(links: ClassLinkItem[] = [meet, content]) {
  return vi.spyOn(classService, "getLinks").mockResolvedValue(links);
}

function fill(name: string, url: string) {
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Endereço"), { target: { value: url } });
}

// SPEC-048, section 3.1
describe("ClassLinks", () => {
  // CA-09
  it("shows the links of the class to the teacher, with the form to add", async () => {
    const get = load();
    render(<ClassLinks classId="c-1" editable />);
    expect(await screen.findByText("Link do Meet")).toBeDefined();
    expect(get).toHaveBeenCalledWith("c-1");
    expect(screen.getByRole("heading", { name: "Links da turma" })).toBeDefined();
    expect(screen.getByText("https://meet.google.com/abc")).toBeDefined();
    expect(screen.getByRole("button", { name: "Remover link: Link do Meet" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Adicionar link" })).toBeDefined();
  });

  // CA-09
  it("adds a link and saves the whole list at once", async () => {
    load([meet]);
    const replace = vi.spyOn(classService, "replaceLinks").mockResolvedValue([meet, content]);
    render(<ClassLinks classId="c-1" editable />);
    await screen.findByText("Link do Meet");
    fill("  Conteúdo da aula 3 ", "https://example.com/aula-3");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar link" }));

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith("c-1", [
      { name: "Link do Meet", url: "https://meet.google.com/abc" },
      { name: "Conteúdo da aula 3", url: "https://example.com/aula-3" },
    ]);
    expect(await screen.findByText("Conteúdo da aula 3")).toBeDefined();
    expect(await screen.findByText("Link adicionado.")).toBeDefined();
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Endereço") as HTMLInputElement).value).toBe("");
  });

  // CA-09
  it("removes a link and saves the rest", async () => {
    load();
    const replace = vi.spyOn(classService, "replaceLinks").mockResolvedValue([content]);
    render(<ClassLinks classId="c-1" editable />);
    await screen.findByText("Link do Meet");
    fireEvent.click(screen.getByRole("button", { name: "Remover link: Link do Meet" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("c-1", [{ name: "Conteúdo da aula 3", url: "https://example.com/aula-3" }]));
    await waitFor(() => expect(screen.queryByText("Link do Meet")).toBeNull());
    expect(await screen.findByText("Link removido.")).toBeDefined();
  });

  // CA-09
  it("shows the error of each field next to it, without calling the server", async () => {
    load([]);
    const replace = vi.spyOn(classService, "replaceLinks");
    render(<ClassLinks classId="c-1" editable />);
    await screen.findByText(/Nenhum link ainda/);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar link" }));
    const name = screen.getByLabelText("Nome");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Informe o nome do link.")).toBeDefined();
    expect(document.activeElement).toBe(name);

    fill("Meet", "http://meet.google.com/abc");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar link" }));
    expect(screen.getByLabelText("Endereço").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("O endereço deve começar com https://.")).toBeDefined();

    fill("a".repeat(81), "https://a.com");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar link" }));
    expect(screen.getByText("O nome pode ter até 80 caracteres.")).toBeDefined();
    expect(replace).not.toHaveBeenCalled();
  });

  // CA-09
  it("puts the problems of the server on the field or at the top", async () => {
    load([]);
    const replace = vi.spyOn(classService, "replaceLinks");
    render(<ClassLinks classId="c-1" editable />);
    await screen.findByText(/Nenhum link ainda/);

    replace.mockRejectedValueOnce(new ApiProblemError({ type: "invalid-link", status: 400, field: "links[0].url" }, 400));
    fill("Meet", "https://a.com");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar link" }));
    await waitFor(() => expect(screen.getByLabelText("Endereço").getAttribute("aria-invalid")).toBe("true"));

    replace.mockRejectedValueOnce(new ApiProblemError({ type: "too-many-links", status: 400 }, 400));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar link" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/até 20 links/);

    replace.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar link" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Não foi possível salvar os links/));
  });

  // CA-09
  it("disables the button and shows the progress while it saves", async () => {
    load([]);
    let finish: (v: ClassLinkItem[]) => void = () => {};
    vi.spyOn(classService, "replaceLinks").mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<ClassLinks classId="c-1" editable />);
    await screen.findByText(/Nenhum link ainda/);
    fill("Meet", "https://a.com");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar link" }));
    const busy = await screen.findByRole("button", { name: "Adicionando…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    finish([{ id: "l-9", name: "Meet", url: "https://a.com", position: 0 }]);
    await screen.findByRole("button", { name: "Adicionar link" });
  });

  // CA-09
  it("explains the empty list to the teacher", async () => {
    load([]);
    render(<ClassLinks classId="c-1" editable />);
    expect(await screen.findByText(/Nenhum link ainda/)).toBeDefined();
  });

  // CA-10
  it("shows the links to the student as links that open in another tab, with no way to edit", async () => {
    load();
    render(<ClassLinks classId="c-1" editable={false} />);
    const link = await screen.findByRole("link", { name: /Link do Meet/ });
    expect(link.getAttribute("href")).toBe("https://meet.google.com/abc");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByLabelText("Nome")).toBeNull();
    expect(screen.queryByRole("button", { name: /Remover link/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Adicionar link" })).toBeNull();
  });

  // CA-10
  it("tells the student when there are no links", async () => {
    load([]);
    render(<ClassLinks classId="c-1" editable={false} />);
    expect(await screen.findByText("A docente ainda não publicou links.")).toBeDefined();
  });

  it("shows an error and tries again when the list does not load", async () => {
    const get = vi.spyOn(classService, "getLinks").mockRejectedValueOnce(new Error("down")).mockResolvedValue([meet]);
    render(<ClassLinks classId="c-1" editable={false} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Não foi possível carregar os links/);
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("link", { name: /Link do Meet/ })).toBeDefined();
    expect(get).toHaveBeenCalledTimes(2);
  });
});

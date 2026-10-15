import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classroomService } from "@/services/classroomService";
import { ApiProblemError } from "@/services/httpClient";
import { StudentNotesPanel } from "./StudentNotesPanel";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(classroomService, "getNotes").mockResolvedValue({ sessionId: "s-1", content: "o que já escrevi", updatedAt: "x" });
});

// SPEC-051 CA-10
describe("StudentNotesPanel", () => {
  it("loads what the student already wrote", async () => {
    render(<StudentNotesPanel classId="c-1" sessionId="s-1" />);
    expect(screen.getByText("Carregando as anotações…")).toBeDefined();
    const box = (await screen.findByLabelText("Minhas anotações")) as HTMLTextAreaElement;
    expect(box.value).toBe("o que já escrevi");
    expect(classroomService.getNotes).toHaveBeenCalledWith("c-1", "s-1");
  });

  it("starts empty when there are no notes yet", async () => {
    vi.spyOn(classroomService, "getNotes").mockRejectedValue(new ApiProblemError({ type: "notes-not-found", status: 404 }, 404));
    render(<StudentNotesPanel classId="c-1" sessionId="s-1" />);
    expect(((await screen.findByLabelText("Minhas anotações")) as HTMLTextAreaElement).value).toBe("");
  });

  it("saves by itself, a moment after the student stops typing", async () => {
    const save = vi.spyOn(classroomService, "saveNotes").mockResolvedValue({ sessionId: "s-1", savedLength: 5, updatedAt: "y" });
    render(<StudentNotesPanel classId="c-1" sessionId="s-1" />);
    const box = await screen.findByLabelText("Minhas anotações");
    vi.useFakeTimers();
    fireEvent.change(box, { target: { value: "abc" } });
    act(() => vi.advanceTimersByTime(400));
    fireEvent.change(box, { target: { value: "abcde" } });
    act(() => vi.advanceTimersByTime(900));
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("c-1", "s-1", "abcde");
    expect(screen.getByText("Salvo.")).toBeDefined();
  });

  it("does not save what was only loaded", async () => {
    const save = vi.spyOn(classroomService, "saveNotes");
    render(<StudentNotesPanel classId="c-1" sessionId="s-1" />);
    await screen.findByLabelText("Minhas anotações");
    vi.useFakeTimers();
    act(() => vi.advanceTimersByTime(5000));
    expect(save).not.toHaveBeenCalled();
  });

  it("says when it could not save, and keeps what was typed", async () => {
    vi.spyOn(classroomService, "saveNotes").mockRejectedValue(new Error("rede"));
    render(<StudentNotesPanel classId="c-1" sessionId="s-1" />);
    const box = (await screen.findByLabelText("Minhas anotações")) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "importante" } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Não foi possível salvar as anotações."), { timeout: 3000 });
    expect(box.value).toBe("importante");
  });

  it("limits the notes to 20,000 characters", async () => {
    render(<StudentNotesPanel classId="c-1" sessionId="s-1" />);
    const box = (await screen.findByLabelText("Minhas anotações")) as HTMLTextAreaElement;
    expect(box.maxLength).toBe(20000);
    expect(screen.getByText("Até 20.000 caracteres")).toBeDefined();
  });
});

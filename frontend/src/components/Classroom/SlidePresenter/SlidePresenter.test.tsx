import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlidePresenter, type SlidePresenterProps } from "./SlidePresenter";
import type { PdfLoader } from "./pdfRenderer";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const deck = { downloadUrl: "https://minio/slides.pdf", pageCount: 3 };

function fakeLoader(pages = 3) {
  const render = vi.fn().mockResolvedValue(undefined);
  const destroy = vi.fn();
  const loader: PdfLoader = { load: vi.fn().mockResolvedValue({ pageCount: pages, render, destroy }) };
  return { loader, render, destroy };
}

function setup(over: Partial<SlidePresenterProps> = {}) {
  const { loader, render: renderPage, destroy } = fakeLoader();
  const props: SlidePresenterProps = {
    deck,
    slide: 2,
    canControl: true,
    cursor: null,
    strokes: [],
    onSlide: vi.fn(),
    onCursor: vi.fn(),
    onDraw: vi.fn(),
    onClear: vi.fn(),
    loader,
    ...over,
  };
  const view = render(<SlidePresenter {...props} />);
  return { props, renderPage, destroy, loader, ...view };
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
});

// SPEC-051 CA-05 and CA-11
describe("SlidePresenter", () => {
  it("opens the PDF and draws the active slide", async () => {
    const { loader, renderPage } = setup();
    expect(screen.getByText("Carregando a apresentação…")).toBeDefined();
    await waitFor(() => expect(renderPage).toHaveBeenCalled());
    expect(loader.load).toHaveBeenCalledWith("https://minio/slides.pdf");
    expect(renderPage.mock.calls.at(-1)![0]).toBe(2);
    expect(screen.getByText("Lâmina 2 de 3")).toBeDefined();
  });

  it("draws again when the slide changes", async () => {
    const { renderPage, rerender, props } = setup();
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
    rerender(<SlidePresenter {...props} slide={3} />);
    await waitFor(() => expect(renderPage.mock.calls.at(-1)![0]).toBe(3));
  });

  it("gives the teacher the buttons to move, and does not go past the ends", async () => {
    const { props, renderPage } = setup({ slide: 1 });
    await waitFor(() => expect(renderPage).toHaveBeenCalled());
    expect((screen.getByRole("button", { name: "Lâmina anterior" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Próxima lâmina" }));
    expect(props.onSlide).toHaveBeenCalledWith(2);
    fireEvent.change(screen.getByLabelText("Ir para a lâmina"), { target: { value: "3" } });
    expect(props.onSlide).toHaveBeenLastCalledWith(3);
    fireEvent.change(screen.getByLabelText("Ir para a lâmina"), { target: { value: "99" } });
    expect(props.onSlide).toHaveBeenLastCalledWith(3);
  });

  it("moves with the arrows and the space bar, for the teacher", async () => {
    const { props, renderPage } = setup({ slide: 2 });
    await waitFor(() => expect(renderPage).toHaveBeenCalled());
    const stage = screen.getByLabelText("Palco da apresentação");
    fireEvent.keyDown(stage, { key: "ArrowRight" });
    expect(props.onSlide).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(stage, { key: " " });
    expect(props.onSlide).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(stage, { key: "ArrowLeft" });
    expect(props.onSlide).toHaveBeenLastCalledWith(1);
  });

  // CA-05: a student only receives
  it("lets a student follow it, with no control, key or pen", async () => {
    const { props, renderPage, container } = setup({
      canControl: false,
      cursor: { x: 10, y: 20, laser: true },
      strokes: [{ path: [[1, 1], [2, 2]] }, { path: [[5, 5], [6, 6]] }],
    });
    await waitFor(() => expect(renderPage).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Próxima lâmina" })).toBeNull();
    expect(screen.queryByLabelText("Ir para a lâmina")).toBeNull();
    expect(screen.queryByRole("button", { name: "Caneta" })).toBeNull();
    const stage = screen.getByLabelText("Palco da apresentação");
    fireEvent.keyDown(stage, { key: "ArrowRight" });
    fireEvent.mouseMove(stage, { clientX: 50, clientY: 50 });
    fireEvent.mouseDown(stage, { clientX: 50, clientY: 50 });
    expect(props.onSlide).not.toHaveBeenCalled();
    expect(props.onCursor).not.toHaveBeenCalled();
    expect(props.onDraw).not.toHaveBeenCalled();
    expect(screen.getByText("Lâmina 2 de 3")).toBeDefined();
    const laser = container.querySelector("[data-laser]") as HTMLElement;
    expect(laser.style.left).toBe("10%");
    expect(laser.style.top).toBe("20%");
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
  });

  it("hides the laser of the student when the teacher turned it off", async () => {
    const { renderPage, container } = setup({ canControl: false, cursor: { x: 10, y: 20, laser: false } });
    await waitFor(() => expect(renderPage).toHaveBeenCalled());
    expect(container.querySelector("[data-laser]")).toBeNull();
  });

  // CA-06: about 30 frames per second, with the last position always arriving
  it("sends the laser at most every 33 ms, and the last position always arrives", async () => {
    const { props, renderPage } = setup();
    await waitFor(() => expect(renderPage).toHaveBeenCalled());
    vi.useFakeTimers();
    const stage = screen.getByLabelText("Palco da apresentação");
    fireEvent.click(screen.getByRole("button", { name: "Laser" }));
    fireEvent.mouseMove(stage, { clientX: 20, clientY: 10 });
    expect(props.onCursor).toHaveBeenCalledTimes(1);
    expect(props.onCursor).toHaveBeenLastCalledWith(10, 10, true);
    act(() => vi.advanceTimersByTime(10));
    fireEvent.mouseMove(stage, { clientX: 40, clientY: 20 });
    act(() => vi.advanceTimersByTime(10));
    fireEvent.mouseMove(stage, { clientX: 100, clientY: 50 });
    expect(props.onCursor).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(14));
    expect(props.onCursor).toHaveBeenCalledTimes(2);
    expect(props.onCursor).toHaveBeenLastCalledWith(50, 50, true);
  });

  it("does not send the laser while it is off", async () => {
    const { props, renderPage } = setup();
    await waitFor(() => expect(renderPage).toHaveBeenCalled());
    fireEvent.mouseMove(screen.getByLabelText("Palco da apresentação"), { clientX: 20, clientY: 10 });
    expect(props.onCursor).not.toHaveBeenCalled();
  });

  it("draws with the pen in percentages and clears the strokes", async () => {
    const { props, renderPage } = setup();
    await waitFor(() => expect(renderPage).toHaveBeenCalled());
    const stage = screen.getByLabelText("Palco da apresentação");
    fireEvent.click(screen.getByRole("button", { name: "Caneta" }));
    fireEvent.mouseDown(stage, { clientX: 20, clientY: 10 });
    fireEvent.mouseUp(stage, { clientX: 100, clientY: 50 });
    expect(props.onDraw).toHaveBeenCalled();
    const path = vi.mocked(props.onDraw).mock.calls.flatMap((call) => call[0]);
    expect(path[0]).toEqual([10, 10]);
    expect(path.at(-1)).toEqual([50, 50]);
    fireEvent.click(screen.getByRole("button", { name: "Limpar traços" }));
    expect(props.onClear).toHaveBeenCalled();
  });

  it("says so when the presentation cannot be opened", async () => {
    const loader: PdfLoader = { load: vi.fn().mockRejectedValue(new Error("corrompido")) };
    setup({ loader });
    expect((await screen.findByRole("alert")).textContent).toBe("Não foi possível abrir a apresentação.");
  });

  it("frees the PDF when it goes away", async () => {
    const { destroy, renderPage, unmount } = setup();
    await waitFor(() => expect(renderPage).toHaveBeenCalled());
    unmount();
    expect(destroy).toHaveBeenCalled();
  });

  // SPEC-055 CA-04, CA-16: the presentation window has its own toolbar and keys
  describe("when the window drives it", () => {
    it("hides its own bar, and leaves the keys to the window", async () => {
      const { props, renderPage } = setup({ bare: true });
      await waitFor(() => expect(renderPage).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: "Próxima lâmina" })).toBeNull();
      expect(screen.queryByText("Lâmina 2 de 3")).toBeNull();
      fireEvent.keyDown(screen.getByRole("group", { name: "Palco da apresentação" }), { key: "ArrowRight" });
      expect(props.onSlide).not.toHaveBeenCalled();
    });

    it("takes the laser and the pen from outside, and sends the pointer only with the laser on", async () => {
      vi.useFakeTimers();
      const { props, rerender } = setup({ bare: true, laser: false, pen: false });
      const stage = screen.getByRole("group", { name: "Palco da apresentação" });
      fireEvent.mouseMove(stage, { clientX: 100, clientY: 50 });
      expect(props.onCursor).not.toHaveBeenCalled();
      rerender(<SlidePresenter {...props} bare laser pen={false} />);
      fireEvent.mouseMove(stage, { clientX: 100, clientY: 50 });
      expect(props.onCursor).toHaveBeenCalledWith(50, 50, true);
    });

    it("turns the laser off for the class when it is turned off from outside", () => {
      vi.useFakeTimers();
      const { props, rerender } = setup({ bare: true, laser: true });
      rerender(<SlidePresenter {...props} bare laser={false} />);
      expect(props.onCursor).toHaveBeenLastCalledWith(0, 0, false);
    });

    it("draws with the pen when it is on from outside", () => {
      vi.useFakeTimers();
      const { props } = setup({ bare: true, pen: true });
      const stage = screen.getByRole("group", { name: "Palco da apresentação" });
      fireEvent.mouseDown(stage, { clientX: 20, clientY: 10 });
      fireEvent.mouseMove(stage, { clientX: 100, clientY: 50 });
      fireEvent.mouseUp(stage, { clientX: 180, clientY: 90 });
      expect(props.onDraw).toHaveBeenCalled();
    });
  });
});

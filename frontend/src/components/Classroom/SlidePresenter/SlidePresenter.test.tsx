import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StageScale } from "../FixedStage/FixedStage";
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
    onScroll: vi.fn(),
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
      cursor: { x: 10, y: 20, laser: true, visible: true },
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

  it("hides the pointer of the student when the teacher left the slide", async () => {
    const { renderPage, container } = setup({ canControl: false, cursor: { x: 10, y: 20, laser: false, visible: false } });
    await waitFor(() => expect(renderPage).toHaveBeenCalled());
    expect(container.querySelector("[data-laser]")).toBeNull();
    expect(container.querySelector("[data-pointer]")).toBeNull();
  });

  // CA-06 of SPEC-051: the mouse of the teacher is the pointer of the class, with no switch
  it("shows the plain pointer of the teacher to the student, and the laser as a highlight", async () => {
    const { renderPage, container } = setup({ canControl: false, cursor: { x: 30, y: 40, laser: false, visible: true } });
    await waitFor(() => expect(renderPage).toHaveBeenCalled());
    const pointer = container.querySelector("[data-pointer]") as HTMLElement;
    expect(pointer.style.left).toBe("30%");
    expect(pointer.style.top).toBe("40%");
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
    expect(props.onCursor).toHaveBeenLastCalledWith(10, 10, true, true);
    act(() => vi.advanceTimersByTime(10));
    fireEvent.mouseMove(stage, { clientX: 40, clientY: 20 });
    act(() => vi.advanceTimersByTime(10));
    fireEvent.mouseMove(stage, { clientX: 100, clientY: 50 });
    expect(props.onCursor).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(14));
    expect(props.onCursor).toHaveBeenCalledTimes(2);
    expect(props.onCursor).toHaveBeenLastCalledWith(50, 50, true, true);
  });

  it("sends the plain pointer while the laser is off, and hides it when the mouse leaves the slide", async () => {
    const { props, renderPage } = setup();
    await waitFor(() => expect(renderPage).toHaveBeenCalled());
    const stage = screen.getByLabelText("Palco da apresentação");
    fireEvent.mouseMove(stage, { clientX: 20, clientY: 10 });
    expect(props.onCursor).toHaveBeenLastCalledWith(10, 10, false, true);
    fireEvent.mouseLeave(stage);
    expect(props.onCursor).toHaveBeenLastCalledWith(0, 0, false, false);
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

    it("takes the laser and the pen from outside, and sends the pointer with the laser as a highlight", async () => {
      vi.useFakeTimers();
      const { props, rerender } = setup({ bare: true, laser: false, pen: false });
      const stage = screen.getByRole("group", { name: "Palco da apresentação" });
      fireEvent.mouseMove(stage, { clientX: 100, clientY: 50 });
      expect(props.onCursor).toHaveBeenCalledWith(50, 50, false, true);
      rerender(<SlidePresenter {...props} bare laser pen={false} />);
      fireEvent.mouseMove(stage, { clientX: 100, clientY: 50 });
      expect(props.onCursor).toHaveBeenCalledWith(50, 50, true, true);
    });

    it("takes the highlight off the pointer of the class when the laser is turned off from outside", () => {
      vi.useFakeTimers();
      const { props, rerender } = setup({ bare: true, laser: true });
      fireEvent.mouseMove(screen.getByRole("group", { name: "Palco da apresentação" }), { clientX: 100, clientY: 50 });
      rerender(<SlidePresenter {...props} bare laser={false} />);
      expect(props.onCursor).toHaveBeenLastCalledWith(50, 50, false, true);
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

  // SPEC-057 CA-01, CA-04 to CA-06, CA-10: the page is drawn in the stage of 1920 px; a taller page scrolls inside it, by the teacher only
  describe("in the stage of 1920 x 1080", () => {
    /** The sizes the browser would compute; jsdom has none. `content` is the height of the page, `view` the height of the stage. */
    function layout(content: number, view = 1080) {
      const sizes = { content, view };
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => sizes.content);
      vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(() => sizes.view);
      return sizes;
    }
    const areaEl = () => screen.getByRole("group", { name: "Palco da apresentação" });
    const sheetEl = () => areaEl().querySelector("[data-sheet]") as HTMLElement;
    // Set on the element itself: the prototype is mocked for all elements by the test above, and a spy on one element would be that same mock.
    const rectOf = (el: Element, r: { left: number; top: number; width: number; height: number }) => {
      el.getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) });
    };

    function setupAt(scale: number) {
      const { loader, render: renderPage } = fakeLoader();
      const props: SlidePresenterProps = { deck, slide: 2, canControl: true, cursor: null, strokes: [], onSlide: vi.fn(), onCursor: vi.fn(), onDraw: vi.fn(), onClear: vi.fn(), onScroll: vi.fn(), loader };
      render(
        <StageScale.Provider value={scale}>
          <SlidePresenter {...props} />
        </StageScale.Provider>,
      );
      return { props, renderPage };
    }

    it("draws the page as wide as the stage, whatever the window is", async () => {
      const { renderPage } = setup();
      await waitFor(() => expect(renderPage).toHaveBeenCalled());
      expect(renderPage.mock.calls.at(-1)![2]).toBe(1920);
    });

    it("draws the page as wide as the room the stage gives it, a scroll bar included", async () => {
      vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1903);
      const { renderPage } = setup();
      await waitFor(() => expect(renderPage).toHaveBeenCalled());
      expect(renderPage.mock.calls.at(-1)![2]).toBe(1903);
    });

    it("keeps the page, the strokes and the pointer in one sheet, so they scroll together", async () => {
      const { renderPage } = setup({ canControl: false, cursor: { x: 10, y: 20, laser: false, visible: true }, strokes: [{ path: [[1, 1], [2, 2]] }] });
      await waitFor(() => expect(renderPage).toHaveBeenCalled());
      const sheet = sheetEl();
      expect(sheet.querySelector("canvas")).not.toBeNull();
      expect(sheet.querySelector("polyline")).not.toBeNull();
      expect(sheet.querySelector("[data-pointer]")).not.toBeNull();
    });

    // CA-04, CA-10
    it("lets the teacher scroll the page inside the stage, and gives the student no way to", async () => {
      const teacher = setup();
      await waitFor(() => expect(teacher.renderPage).toHaveBeenCalled());
      expect(areaEl().classList.contains("follower")).toBe(false);
      teacher.unmount();
      const student = setup({ canControl: false });
      await waitFor(() => expect(student.renderPage).toHaveBeenCalled());
      expect(areaEl().classList.contains("follower")).toBe(true);
      expect(areaEl().hasAttribute("tabindex")).toBe(false);
    });

    it("tells the place of the teacher in the page as a fraction of what can be scrolled", async () => {
      layout(2160);
      const { props, renderPage } = setup();
      await waitFor(() => expect(renderPage).toHaveBeenCalled());
      areaEl().scrollTop = 540;
      fireEvent.scroll(areaEl());
      expect(props.onScroll).toHaveBeenLastCalledWith(0.5);
      areaEl().scrollTop = 1080;
      fireEvent.scroll(areaEl());
      expect(props.onScroll).toHaveBeenLastCalledWith(1);
    });

    it("tells 0 when the page fits in the stage", async () => {
      layout(1080);
      const { props, renderPage } = setup();
      await waitFor(() => expect(renderPage).toHaveBeenCalled());
      fireEvent.scroll(areaEl());
      expect(props.onScroll).toHaveBeenLastCalledWith(0);
    });

    it("never tells a scroll from a student, nor from the window that is only watching", async () => {
      layout(2160);
      const { props, renderPage } = setup({ canControl: false });
      await waitFor(() => expect(renderPage).toHaveBeenCalled());
      areaEl().scrollTop = 540;
      fireEvent.scroll(areaEl());
      fireEvent.wheel(areaEl(), { deltaY: 300 });
      expect(props.onScroll).not.toHaveBeenCalled();
    });

    it("shows the student the place the teacher is at, moving the sheet and not the student's own scroll", async () => {
      layout(2160);
      const { renderPage } = setup({ canControl: false, scroll: 0.5 });
      await waitFor(() => expect(renderPage).toHaveBeenCalled());
      expect(sheetEl().style.transform).toBe("translateY(-540px)");
      expect(areaEl().scrollTop).toBe(0);
    });

    it("follows the teacher as he scrolls, and goes back to the top", async () => {
      layout(2160);
      const { props, renderPage, rerender } = setup({ canControl: false, scroll: 0.25 });
      await waitFor(() => expect(renderPage).toHaveBeenCalled());
      expect(sheetEl().style.transform).toBe("translateY(-270px)");
      rerender(<SlidePresenter {...props} canControl={false} scroll={1} />);
      expect(sheetEl().style.transform).toBe("translateY(-1080px)");
      rerender(<SlidePresenter {...props} canControl={false} scroll={0} />);
      expect(sheetEl().style.transform).toBe("translateY(0px)");
    });

    it("places the scroll again when the page is drawn, because only then it is as tall as it is", async () => {
      const sizes = layout(1080);
      const { renderPage } = setup({ canControl: false, scroll: 0.5 });
      sizes.content = 2160;
      await waitFor(() => expect(renderPage).toHaveBeenCalled());
      await waitFor(() => expect(sheetEl().style.transform).toBe("translateY(-540px)"));
    });

    it("puts the teacher back where the room says, when he comes in or connects again", async () => {
      layout(2160);
      const { renderPage } = setup({ scroll: 0.5 });
      await waitFor(() => expect(renderPage).toHaveBeenCalled());
      expect(areaEl().scrollTop).toBe(540);
    });

    // CA-05
    it("goes back to the top when the slide changes, for the teacher and for the student", async () => {
      layout(2160);
      const teacher = setup({ slide: 2, scroll: 0 });
      await waitFor(() => expect(teacher.renderPage).toHaveBeenCalled());
      areaEl().scrollTop = 700;
      teacher.rerender(<SlidePresenter {...teacher.props} slide={3} scroll={0} />);
      expect(areaEl().scrollTop).toBe(0);
      teacher.unmount();

      const student = setup({ canControl: false, slide: 2, scroll: 0.5 });
      await waitFor(() => expect(student.renderPage).toHaveBeenCalled());
      expect(sheetEl().style.transform).toBe("translateY(-540px)");
      student.rerender(<SlidePresenter {...student.props} canControl={false} slide={3} scroll={0} />);
      expect(sheetEl().style.transform).toBe("translateY(0px)");
    });

    // CA-06: the pointer and the strokes are percentages of the whole page, with the scroll and the scale taken into account
    it("sends the pointer as a percentage of the whole page, counting what is scrolled", async () => {
      layout(2160);
      const { props, renderPage } = setup();
      await waitFor(() => expect(renderPage).toHaveBeenCalled());
      await act(async () => undefined);
      rectOf(areaEl(), { left: 0, top: 0, width: 1920, height: 1080 });
      rectOf(sheetEl(), { left: 0, top: -540, width: 1920, height: 2160 });
      areaEl().scrollTop = 540;
      fireEvent.mouseMove(areaEl(), { clientX: 960, clientY: 540 });
      // Half way across, and 540 + 540 = 1080 of the 2160 of the page.
      expect(props.onCursor).toHaveBeenLastCalledWith(50, 50, false, true);
    });

    it("sends the same percentage from a window that shows the stage smaller", async () => {
      layout(2160);
      const { props, renderPage } = setupAt(0.5);
      await waitFor(() => expect(renderPage).toHaveBeenCalled());
      await act(async () => undefined);
      rectOf(areaEl(), { left: 100, top: 50, width: 960, height: 540 });
      rectOf(sheetEl(), { left: 100, top: -220, width: 960, height: 1080 });
      areaEl().scrollTop = 540;
      fireEvent.mouseMove(areaEl(), { clientX: 580, clientY: 320 });
      expect(props.onCursor).toHaveBeenLastCalledWith(50, 50, false, true);
    });

    it("draws with the pen in percentages of the whole page, counting what is scrolled", async () => {
      layout(2160);
      const { props, renderPage } = setup({ pen: true, bare: true });
      await waitFor(() => expect(renderPage).toHaveBeenCalled());
      await act(async () => undefined);
      rectOf(areaEl(), { left: 0, top: 0, width: 1920, height: 1080 });
      rectOf(sheetEl(), { left: 0, top: -540, width: 1920, height: 2160 });
      areaEl().scrollTop = 540;
      fireEvent.mouseDown(areaEl(), { clientX: 192, clientY: 0 });
      fireEvent.mouseUp(areaEl(), { clientX: 1920, clientY: 1080 });
      const path = vi.mocked(props.onDraw).mock.calls.flatMap((call) => call[0]);
      expect(path[0]).toEqual([10, 25]);
      expect(path.at(-1)).toEqual([100, 75]);
    });

    it("puts the pointer where the page is under the mouse when the page moves and the mouse does not", async () => {
      layout(2160);
      const { props, renderPage } = setup();
      await waitFor(() => expect(renderPage).toHaveBeenCalled());
      await act(async () => undefined);
      rectOf(areaEl(), { left: 0, top: 0, width: 1920, height: 1080 });
      rectOf(sheetEl(), { left: 0, top: 0, width: 1920, height: 2160 });
      vi.useFakeTimers();
      fireEvent.mouseMove(areaEl(), { clientX: 960, clientY: 540 });
      expect(props.onCursor).toHaveBeenLastCalledWith(50, 25, false, true);
      act(() => vi.advanceTimersByTime(50));
      areaEl().scrollTop = 540;
      fireEvent.scroll(areaEl());
      act(() => vi.advanceTimersByTime(50));
      expect(props.onCursor).toHaveBeenLastCalledWith(50, 50, false, true);
    });

    it("does not make a pointer out of a scroll when the mouse is not over the stage", async () => {
      layout(2160);
      const { props, renderPage } = setup();
      await waitFor(() => expect(renderPage).toHaveBeenCalled());
      fireEvent.mouseMove(areaEl(), { clientX: 10, clientY: 10 });
      fireEvent.mouseLeave(areaEl());
      vi.mocked(props.onCursor).mockClear();
      areaEl().scrollTop = 100;
      fireEvent.scroll(areaEl());
      expect(props.onCursor).not.toHaveBeenCalled();
    });
  });
});

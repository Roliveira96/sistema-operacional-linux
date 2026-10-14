import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PdfLoader } from "../SlidePresenter/pdfRenderer";
import { SlideThumbnails } from "./SlideThumbnails";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const deck = { downloadUrl: "https://minio/slides.pdf", pageCount: 4 };

function fakeLoader() {
  const render = vi.fn().mockResolvedValue(undefined);
  const destroy = vi.fn();
  const loader: PdfLoader = { load: vi.fn().mockResolvedValue({ pageCount: 4, render, destroy }) };
  return { loader, render, destroy };
}

// SPEC-055 CA-03: the thumbnails of the panel
describe("SlideThumbnails", () => {
  it("shows one button for each slide, and marks the one on the stage", () => {
    const { loader } = fakeLoader();
    render(<SlideThumbnails deck={deck} current={2} onSelect={vi.fn()} loader={loader} />);
    const list = within(screen.getByRole("list", { name: "Miniaturas das lâminas" }));
    expect(list.getAllByRole("button")).toHaveLength(4);
    expect(list.getByRole("button", { name: "Ir para a lâmina 2" }).getAttribute("aria-current")).toBe("true");
    expect(list.getByRole("button", { name: "Ir para a lâmina 3" }).getAttribute("aria-current")).toBeNull();
  });

  it("goes to the slide that is chosen", () => {
    const { loader } = fakeLoader();
    const onSelect = vi.fn();
    render(<SlideThumbnails deck={deck} current={1} onSelect={onSelect} loader={loader} />);
    fireEvent.click(screen.getByRole("button", { name: "Ir para a lâmina 4" }));
    expect(onSelect).toHaveBeenCalledWith(4);
  });

  it("draws each slide small, from the PDF of the class, and lets the PDF go at the end", async () => {
    const { loader, render: renderPage, destroy } = fakeLoader();
    const view = render(<SlideThumbnails deck={deck} current={1} onSelect={vi.fn()} loader={loader} />);
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(4));
    expect(loader.load).toHaveBeenCalledWith("https://minio/slides.pdf");
    expect(renderPage.mock.calls.map((call) => call[0])).toEqual([1, 2, 3, 4]);
    expect(renderPage.mock.calls[0]![2]).toBeLessThanOrEqual(200);
    view.unmount();
    expect(destroy).toHaveBeenCalled();
  });

  it("keeps the numbers working when the PDF cannot be drawn", async () => {
    const loader: PdfLoader = { load: vi.fn().mockRejectedValue(new Error("x")) };
    const onSelect = vi.fn();
    render(<SlideThumbnails deck={deck} current={1} onSelect={onSelect} loader={loader} />);
    await waitFor(() => expect(loader.load).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Ir para a lâmina 3" }));
    expect(onSelect).toHaveBeenCalledWith(3);
  });
});

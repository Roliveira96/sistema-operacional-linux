import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { octoberCalendar } from "@/test/scheduleFixtures";
import { ClassCalendar, type ClassCalendarProps } from "./ClassCalendar";

afterEach(cleanup);

function setup(overrides: Partial<ClassCalendarProps> = {}) {
  render(<ClassCalendar load={vi.fn().mockResolvedValue(octoberCalendar())} initialMonth={new Date(2026, 9, 1)} today={new Date(2026, 9, 13)} {...overrides} />);
}

const open = async (name: RegExp) => fireEvent.click(await screen.findByRole("button", { name }));
const convert = { name: "Transformar em avaliação" };

// SPEC-075 CA-25: the card of a lesson in the panel of the day offers "Transformar em avaliação".
describe("ClassCalendar: transform a lesson into an assessment", () => {
  it("offers it to the teacher on a lesson that is scheduled, and hands over that lesson", async () => {
    const onConvertSession = vi.fn();
    setup({ editable: true, onConvertSession });
    await open(/^segunda-feira, 26 de outubro/);
    const panel = within(screen.getByRole("region", { name: "segunda-feira, 26 de outubro de 2026" }));
    fireEvent.click(panel.getByRole("button", convert));
    expect(onConvertSession).toHaveBeenCalledWith(expect.objectContaining({ id: "s-26", date: "2026-10-26" }));
  });

  it("does not offer it on a canceled lesson", async () => {
    setup({ editable: true, onConvertSession: vi.fn() });
    await open(/^segunda-feira, 19 de outubro/);
    expect(screen.queryByRole("button", convert)).toBeNull();
  });

  it("does not offer it to who cannot edit, nor when it is not given the way to do it", async () => {
    setup({ editable: false, onConvertSession: vi.fn() });
    await open(/^segunda-feira, 26 de outubro/);
    expect(screen.queryByRole("button", convert)).toBeNull();
    cleanup();

    setup({ editable: true });
    await open(/^segunda-feira, 26 de outubro/);
    expect(screen.queryByRole("button", convert)).toBeNull();
  });
});

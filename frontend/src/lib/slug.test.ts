import { describe, expect, it } from "vitest";
import { endsBeforeStart, isoToLocalInput, localInputToIso } from "./localDateTime";
import { normalizeSlug, slugify, slugProblem } from "./slug";

// Covers SPEC-010: the slug of a module.
describe("slug", () => {
  it("turns a title into a slug without accents, spaces or punctuation", () => {
    expect(slugify("História do Linux")).toBe("historia-do-linux");
    expect(slugify("  Pacotes, atualizações e serviços!  ")).toBe("pacotes-atualizacoes-e-servicos");
    expect(slugify("Módulo 1: Processos & Threads")).toBe("modulo-1-processos-threads");
    expect(slugify("---")).toBe("");
  });

  it("cuts a long title without leaving a hyphen at the end", () => {
    const slug = slugify("palavra ".repeat(20));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("normalizes what a person typed", () => {
    expect(normalizeSlug("  Meu-Slug ")).toBe("meu-slug");
  });

  it("accepts good slugs, and an empty one because the slug is optional", () => {
    for (const ok of ["", "   ", "abc", "historia-do-linux", "modulo-2", "A-B-C"]) expect(slugProblem(ok), ok).toBeNull();
  });

  it("says what is wrong with a bad slug", () => {
    expect(slugProblem("ab")).toBe("short");
    expect(slugProblem("a".repeat(61))).toBe("long");
    for (const bad of ["com espaço", "-inicio", "fim-", "duplo--hifen", "acentuação", "under_score", "pon.to"]) expect(slugProblem(bad), bad).toBe("format");
  });
});

// Covers SPEC-010: dates go to the server as instants and come back to the field as the wall clock.
describe("localDateTime", () => {
  it("round-trips a wall-clock value through the instant without moving it", () => {
    for (const local of ["2026-10-09T10:00", "2026-01-01T00:00", "2026-12-31T23:59"]) {
      const iso = localInputToIso(local);
      expect(iso).not.toBeNull();
      expect(isoToLocalInput(iso)).toBe(local);
    }
  });

  it("shows an instant as the wall clock of the browser, not as UTC", () => {
    const iso = new Date(2026, 9, 9, 10, 0).toISOString();
    expect(isoToLocalInput(iso)).toBe("2026-10-09T10:00");
  });

  it("gives empty values for nothing or for nonsense", () => {
    expect(isoToLocalInput(undefined)).toBe("");
    expect(isoToLocalInput(null)).toBe("");
    expect(isoToLocalInput("not a date")).toBe("");
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("not a date")).toBeNull();
  });

  it("tells an end before the start, and ignores a missing date", () => {
    expect(endsBeforeStart("2026-10-09T10:00", "2026-10-09T09:59")).toBe(true);
    expect(endsBeforeStart("2026-10-09T10:00", "2026-10-09T10:00")).toBe(false);
    expect(endsBeforeStart("2026-10-09T10:00", "2026-10-10T10:00")).toBe(false);
    expect(endsBeforeStart("", "2026-10-09T10:00")).toBe(false);
    expect(endsBeforeStart("2026-10-09T10:00", "")).toBe(false);
    expect(endsBeforeStart("x", "y")).toBe(false);
  });
});

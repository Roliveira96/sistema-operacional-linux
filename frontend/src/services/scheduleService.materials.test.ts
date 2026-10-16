import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "./httpClient";
import { createScheduleService, type SessionMaterial } from "./scheduleService";

function client(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
}

const base = "/classes/c-1/sessions/s-1/materials";

const material: SessionMaterial = {
  id: "mat-1",
  position: 0,
  title: "Lista 1",
  kind: "EXERCISES",
  visibility: "DURING_CLASS",
  releaseAt: null,
  source: "FILE",
  fileName: "lista.pdf",
  contentType: "application/pdf",
  sizeBytes: 2048,
  pageCount: 12,
  visibleNow: true,
};

// SPEC-074, section 5: the materials of a lesson
describe("scheduleService: materials (SPEC-074)", () => {
  it("lists the materials of a lesson", async () => {
    const c = client();
    vi.mocked(c.get).mockResolvedValueOnce({ materials: [material] });
    await expect(createScheduleService(c).materials("c-1", "s-1")).resolves.toEqual([material]);
    expect(c.get).toHaveBeenCalledWith(base);
  });

  it("includes a link, with the phase and the release", async () => {
    const c = client();
    const svc = createScheduleService(c);
    vi.mocked(c.post).mockResolvedValueOnce(material);
    await expect(
      svc.addLinkMaterial("c-1", "s-1", { url: "https://example.com", title: "Doc", kind: "REFERENCE", visibility: "ALWAYS", releaseAt: "2026-10-19T11:00:00-03:00" }),
    ).resolves.toEqual(material);
    expect(c.post).toHaveBeenCalledWith(`${base}/links`, { url: "https://example.com", title: "Doc", kind: "REFERENCE", visibility: "ALWAYS", releaseAt: "2026-10-19T11:00:00-03:00" });
  });

  it("sends a file as a form, with the pages of a PDF and none for an image", async () => {
    const c = client();
    const svc = createScheduleService(c);
    vi.mocked(c.post).mockResolvedValue(material);
    const pdf = new File(["%PDF-"], "lista.pdf", { type: "application/pdf" });

    await svc.addFileMaterial("c-1", "s-1", pdf, { title: "Lista 1", kind: "EXERCISES", visibility: "DURING_AND_AFTER" }, 12);
    const [path, form] = vi.mocked(c.post).mock.calls[0]!;
    expect(path).toBe(`${base}/files`);
    const sent = form as FormData;
    expect((sent.get("file") as File).name).toBe("lista.pdf");
    expect(sent.get("title")).toBe("Lista 1");
    expect(sent.get("kind")).toBe("EXERCISES");
    expect(sent.get("visibility")).toBe("DURING_AND_AFTER");
    expect(sent.get("pageCount")).toBe("12");
    expect(sent.has("releaseAt")).toBe(false);

    const png = new File(["x"], "quadro.png", { type: "image/png" });
    await svc.addFileMaterial("c-1", "s-1", png, { title: "Quadro", kind: "REFERENCE", visibility: "ALWAYS", releaseAt: "2026-10-19T11:00:00-03:00" });
    const image = vi.mocked(c.post).mock.calls[1]![1] as FormData;
    expect(image.has("pageCount")).toBe(false);
    expect(image.get("releaseAt")).toBe("2026-10-19T11:00:00-03:00");
  });

  it("changes a material, and clears its release with null", async () => {
    const c = client();
    const svc = createScheduleService(c);
    vi.mocked(c.patch).mockResolvedValue(material);
    await svc.updateMaterial("c-1", "s-1", "mat-1", { title: "Novo", visibility: "AFTER_CLASS", releaseAt: null, position: 2 });
    expect(c.patch).toHaveBeenCalledWith(`${base}/mat-1`, { title: "Novo", visibility: "AFTER_CLASS", releaseAt: null, position: 2 });
  });

  it("releases a material now, removes it, and asks for the address of a file", async () => {
    const c = client();
    const svc = createScheduleService(c);
    vi.mocked(c.post).mockResolvedValueOnce(material);
    await svc.releaseMaterial("c-1", "s-1", "mat-1");
    expect(c.post).toHaveBeenCalledWith(`${base}/mat-1/release`);

    await svc.deleteMaterial("c-1", "s-1", "mat-1");
    expect(c.delete).toHaveBeenCalledWith(`${base}/mat-1`);

    vi.mocked(c.get).mockResolvedValueOnce({ downloadUrl: "https://files.example/k?ttl=15m", expiresAt: "2026-10-19T09:15:00-03:00" });
    await expect(svc.materialDownload("c-1", "s-1", "mat-1")).resolves.toEqual({ downloadUrl: "https://files.example/k?ttl=15m", expiresAt: "2026-10-19T09:15:00-03:00" });
    expect(c.get).toHaveBeenCalledWith(`${base}/mat-1/download`);
  });
});

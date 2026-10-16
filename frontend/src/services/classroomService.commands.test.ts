import { describe, expect, it, vi } from "vitest";
import { createClassroomService, type LiveTerminalCommand } from "./classroomService";
import type { HttpClient } from "./httpClient";

// SPEC-071, section 5: the commands the teacher ran in a live classroom
describe("classroomService: commands of the teacher (SPEC-071)", () => {
  it("lists the commands of a live classroom, as the server ordered them", async () => {
    const client: HttpClient = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
    const service = createClassroomService(client);
    const commands: LiveTerminalCommand[] = [
      { terminal: 1, command: "ls -la", exitStatus: 0, output: "total 0\n", outputTruncated: false, ranAt: "2026-10-19T11:30:00Z" },
      { terminal: 2, command: "sleep 100", exitStatus: null, output: "", outputTruncated: true, ranAt: "2026-10-19T11:31:00Z" },
    ];
    vi.mocked(client.get).mockResolvedValueOnce({ sessionId: "s-1", commands });
    await expect(service.listCommands("c-1", "s-1")).resolves.toEqual(commands);
    expect(client.get).toHaveBeenCalledWith("/classes/c-1/live/sessions/s-1/commands");
  });
});

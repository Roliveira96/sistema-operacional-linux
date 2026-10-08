import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/messages/pt-BR";
import { uploadAvatar } from "@/services/studentService";
import { StudentAvatarUpload } from "./StudentAvatarUpload";

vi.mock("@/services/studentService", () => ({
  uploadAvatar: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StudentAvatarUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders placeholder with initials when no avatar is provided", () => {
    render(<StudentAvatarUpload studentName="Carlos Alberto" />);
    expect(screen.getByText("CA")).toBeDefined();
    expect(screen.getByText(messages.students.profile.avatarTitle)).toBeDefined();
  });

  it("rejects files exceeding 2MB size limit", async () => {
    render(<StudentAvatarUpload studentName="Carlos" />);

    const largeFile = new File(["a".repeat(2.5 * 1024 * 1024)], "foto.png", {
      type: "image/png",
    });
    // simulate size property
    Object.defineProperty(largeFile, "size", { value: 2.5 * 1024 * 1024 });

    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [largeFile] } });

    await waitFor(() => {
      expect(
        screen.getByText("O tamanho da imagem excede o limite de 2MB.")
      ).toBeDefined();
    });
    expect(uploadAvatar).not.toHaveBeenCalled();
  });

  it("rejects invalid image formats", async () => {
    render(<StudentAvatarUpload studentName="Carlos" />);

    const invalidFile = new File(["test"], "foto.gif", { type: "image/gif" });
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [invalidFile] } });

    await waitFor(() => {
      expect(
        screen.getByText("Formato inválido. Use JPEG, PNG ou WebP.")
      ).toBeDefined();
    });
    expect(uploadAvatar).not.toHaveBeenCalled();
  });

  it("uploads valid image and triggers callback (CA-10)", async () => {
    vi.mocked(uploadAvatar).mockResolvedValueOnce({
      avatarUrl: "http://storage/avatar.webp",
    });
    const onUpdated = vi.fn();

    render(<StudentAvatarUpload studentName="Carlos" onAvatarUpdated={onUpdated} />);

    const validFile = new File(["img-bytes"], "avatar.webp", {
      type: "image/webp",
    });
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [validFile] } });

    await waitFor(() => {
      expect(uploadAvatar).toHaveBeenCalledWith(validFile);
      expect(
        screen.getByText(messages.students.profile.uploadSuccess)
      ).toBeDefined();
    });
    expect(onUpdated).toHaveBeenCalledWith("http://storage/avatar.webp");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserNotice } from "./browserNotice";

/** The Notification of the browser, as a double: no test ever shows a real one (SPEC-064 section 8). */
class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  static instances: FakeNotification[] = [];
  static failWith: Error | null = null;
  onclick: ((event: Event) => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options?: NotificationOptions,
  ) {
    if (FakeNotification.failWith) throw FakeNotification.failWith;
    FakeNotification.instances.push(this);
  }
}

const shown = () => FakeNotification.instances[0];
const clickIt = (notification: FakeNotification) => notification.onclick?.(new Event("click"));

beforeEach(() => {
  FakeNotification.permission = "granted";
  FakeNotification.instances = [];
  FakeNotification.failWith = null;
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal("Notification", FakeNotification);
  vi.stubGlobal("isSecureContext", true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// SPEC-064 CA-05: the access to the browser says whether notices are possible at all
describe("browserNotice, what the browser allows", () => {
  it("is supported with the API in a secure context (https or localhost)", () => {
    expect(browserNotice.supported()).toBe(true);
  });

  it("is not supported without the Notification API", () => {
    vi.stubGlobal("Notification", undefined);
    expect(browserNotice.supported()).toBe(false);
    expect(browserNotice.permission()).toBe("unsupported");
  });

  it("is not supported outside a secure context, as with http on the local network", () => {
    vi.stubGlobal("isSecureContext", false);
    expect(browserNotice.supported()).toBe(false);
    expect(browserNotice.permission()).toBe("unsupported");
  });

  it("is not supported when the browser tells nothing about the secure context", () => {
    vi.stubGlobal("isSecureContext", undefined);
    expect(browserNotice.supported()).toBe(false);
  });

  it.each(["default", "granted", "denied"] as const)("tells the permission of the browser: %s", (permission) => {
    FakeNotification.permission = permission;
    expect(browserNotice.permission()).toBe(permission);
  });
});

describe("browserNotice, asking for the permission", () => {
  it("asks the browser and gives back what the person answered", async () => {
    FakeNotification.permission = "default";
    FakeNotification.requestPermission.mockImplementationOnce(async () => "granted");
    await expect(browserNotice.requestPermission()).resolves.toBe("granted");
    FakeNotification.requestPermission.mockImplementationOnce(async () => "denied");
    await expect(browserNotice.requestPermission()).resolves.toBe("denied");
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(2);
  });

  it("asks nothing where notices are not possible", async () => {
    vi.stubGlobal("isSecureContext", false);
    await expect(browserNotice.requestPermission()).resolves.toBe("unsupported");
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it("gives back the permission as it stands when the browser fails to ask", async () => {
    FakeNotification.permission = "default";
    FakeNotification.requestPermission.mockRejectedValueOnce(new Error("no gesture"));
    await expect(browserNotice.requestPermission()).resolves.toBe("default");
  });
});

// SPEC-064 CA-07: the content of the notice
describe("browserNotice, showing a notice", () => {
  it("creates the notice with the title, the body and the tag", () => {
    browserNotice.show({ title: "Mão levantada", body: "Ana levantou a mão", tag: "hand-u-1" });
    expect(FakeNotification.instances).toHaveLength(1);
    expect(shown().title).toBe("Mão levantada");
    expect(shown().options).toMatchObject({ body: "Ana levantou a mão", tag: "hand-u-1" });
  });

  it("keeps the text as it is, since a notice is plain text and never HTML", () => {
    browserNotice.show({ title: "Mensagem de <b>Ana</b>", body: "<img src=x onerror=alert(1)> oi", tag: "chat-1" });
    expect(shown().title).toBe("Mensagem de <b>Ana</b>");
    expect(shown().options?.body).toBe("<img src=x onerror=alert(1)> oi");
  });

  it("cuts a body of more than 140 characters, so that it has 140 with the ellipsis", () => {
    browserNotice.show({ title: "t", body: "a".repeat(200), tag: "x" });
    const body = shown().options!.body!;
    expect(Array.from(body)).toHaveLength(140);
    expect(body).toBe(`${"a".repeat(139)}…`);
  });

  it("leaves a body of 140 characters whole, and cuts the one of 141", () => {
    browserNotice.show({ title: "t", body: "b".repeat(140), tag: "x" });
    expect(shown().options!.body).toBe("b".repeat(140));
    browserNotice.show({ title: "t", body: "b".repeat(141), tag: "y" });
    expect(FakeNotification.instances[1].options!.body).toBe(`${"b".repeat(139)}…`);
  });

  it("counts by character, so a picture is never cut in half", () => {
    browserNotice.show({ title: "t", body: "😀".repeat(200), tag: "x" });
    const body = shown().options!.body!;
    expect(Array.from(body)).toHaveLength(140);
    expect(body).toBe(`${"😀".repeat(139)}…`);
    expect(body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("closes the notice by itself after 8 seconds, and not before", () => {
    vi.useFakeTimers();
    browserNotice.show({ title: "t", body: "b", tag: "x" });
    vi.advanceTimersByTime(7999);
    expect(shown().close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(shown().close).toHaveBeenCalledTimes(1);
  });
});

// SPEC-064 CA-06: the click on the notice
describe("browserNotice, the click on the notice", () => {
  it("brings the window to the front, closes the notice and calls what was asked, once", () => {
    const focus = vi.spyOn(window, "focus").mockImplementation(() => undefined);
    const onClick = vi.fn();
    browserNotice.show({ title: "t", body: "b", tag: "x", onClick });
    expect(onClick).not.toHaveBeenCalled();
    clickIt(shown());
    expect(focus).toHaveBeenCalledTimes(1);
    expect(shown().close).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("brings the window to the front and closes the notice even when nothing was asked", () => {
    const focus = vi.spyOn(window, "focus").mockImplementation(() => undefined);
    browserNotice.show({ title: "t", body: "b", tag: "x" });
    expect(() => clickIt(shown())).not.toThrow();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(shown().close).toHaveBeenCalledTimes(1);
  });

  it("does not close the notice again at the 8 seconds when the click already did", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "focus").mockImplementation(() => undefined);
    browserNotice.show({ title: "t", body: "b", tag: "x" });
    clickIt(shown());
    vi.advanceTimersByTime(8000);
    expect(shown().close).toHaveBeenCalledTimes(1);
  });
});

describe("browserNotice, when the browser refuses", () => {
  it("swallows the failure of the constructor: a notice that does not show is not an error", () => {
    FakeNotification.failWith = new TypeError("Illegal constructor");
    expect(() => browserNotice.show({ title: "t", body: "b", tag: "x" })).not.toThrow();
  });

  it("swallows the absence of the API", () => {
    vi.stubGlobal("Notification", undefined);
    expect(() => browserNotice.show({ title: "t", body: "b", tag: "x" })).not.toThrow();
  });
});

// SPEC-064 section 3.1: a notice is only for who is not looking at the page
describe("browserNotice, whether the page is in view", () => {
  const page = (hidden: boolean, focused: boolean) => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(hidden);
    vi.spyOn(document, "hasFocus").mockReturnValue(focused);
  };

  it("is in view when the page is visible and the window has the focus", () => {
    page(false, true);
    expect(browserNotice.inView()).toBe(true);
  });

  it("is not in view when the page is hidden, as with another tab on top", () => {
    page(true, true);
    expect(browserNotice.inView()).toBe(false);
  });

  it("is not in view when the window has no focus, as with another window on top", () => {
    page(false, false);
    expect(browserNotice.inView()).toBe(false);
  });

  it("is not in view when the page is hidden and has no focus either", () => {
    page(true, false);
    expect(browserNotice.inView()).toBe(false);
  });
});

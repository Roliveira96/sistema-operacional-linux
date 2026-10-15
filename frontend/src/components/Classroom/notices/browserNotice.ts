export type NoticePermission = "default" | "granted" | "denied" | "unsupported";

export interface NoticeContent {
  title: string;
  body: string;
  /** Two notices with the same tag do not pile up: the new one takes the place of the old one (SPEC-064 section 3.1). */
  tag: string;
  /** What the click on the notice does, besides bringing the window to the front and closing the notice. */
  onClick?: () => void;
}

/** The access to the notices of the browser, as one object, so that a test can put a double in its place and never show a real notice (SPEC-064 section 8). */
export interface BrowserNotice {
  permission(): NoticePermission;
  /** Asks the browser, which only does it after a gesture of the person; gives back what the person answered. */
  requestPermission(): Promise<NoticePermission>;
  /** Whether the person is looking at the page: it is visible and the window has the focus. */
  inView(): boolean;
  show(content: NoticeContent): void;
}

/** The longest body of a notice, with the ellipsis; what is longer is cut (SPEC-064 CA-07). */
const BODY_MAX = 140;
/** A notice closes by itself after this long (SPEC-064 CA-07). */
const CLOSE_MS = 8000;

/** The browser has the API and the page is in a secure context (https or localhost); with http on the local network it has not. */
const supported = () => typeof Notification !== "undefined" && typeof window !== "undefined" && window.isSecureContext === true;

/** The text with at most `BODY_MAX` characters, counted as characters and not as code units, so a picture is never cut in half. */
function clip(text: string) {
  const characters = Array.from(text);
  return characters.length > BODY_MAX ? `${characters.slice(0, BODY_MAX - 1).join("")}…` : text;
}

const permission = (): NoticePermission => (supported() ? Notification.permission : "unsupported");

/** The real access to the browser; besides what the screens use, it tells whether the browser can show notices at all. */
export const browserNotice: BrowserNotice & { supported(): boolean } = {
  supported,
  permission,

  async requestPermission() {
    if (!supported()) return "unsupported";
    try {
      return await Notification.requestPermission();
    } catch {
      return permission();
    }
  },

  inView: () => !document.hidden && document.hasFocus(),

  show({ title, body, tag, onClick }) {
    try {
      const notice = new Notification(title, { body: clip(body), tag });
      const timer = setTimeout(() => notice.close(), CLOSE_MS);
      notice.onclick = () => {
        clearTimeout(timer);
        window.focus();
        notice.close();
        onClick?.();
      };
    } catch {
      /* a notice that does not show is not an error: the screen has what it tells */
    }
  },
};

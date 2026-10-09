import { describe, expect, it } from "vitest";
import { descriptionHtml, descriptionText } from "./description";

describe("descriptionText", () => {
  it("reads the visible text of the formatted description", () => {
    expect(descriptionText("<p>ls · cd — <strong>Navegar</strong></p><p>pelas   pastas</p>")).toBe("ls · cd — Navegar pelas pastas");
    expect(descriptionText("<p>A &amp; B &lt; C &quot;d&quot; &#39;e&#39;&nbsp;f</p>")).toBe("A & B < C \"d\" 'e' f");
  });

  it("leaves plain text as it is, so the tags of the prototype descriptions keep working", () => {
    expect(descriptionText("ls · cd · mkdir — Navegar pelas pastas")).toBe("ls · cd · mkdir — Navegar pelas pastas");
    expect(descriptionText("  muito   espaço ")).toBe("muito espaço");
    expect(descriptionText("")).toBe("");
  });
});

describe("descriptionHtml", () => {
  it("turns plain text into one paragraph per line, escaped", () => {
    expect(descriptionHtml("primeira & linha\n\n2 < 3\r\nterceira")).toBe("<p>primeira &amp; linha</p><p>2 &lt; 3</p><p>terceira</p>");
    expect(descriptionHtml("")).toBe("");
  });

  it("keeps html as it is", () => {
    expect(descriptionHtml("<p>já <b>formatado</b></p>")).toBe("<p>já <b>formatado</b></p>");
  });
});

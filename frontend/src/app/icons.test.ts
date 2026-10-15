import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(path.join(import.meta.dirname, name));
const logo = readFileSync(path.join(import.meta.dirname, "../../public/utfpr-logo.svg"), "utf8");

// SPEC-069: the favicon of the platform. Next.js publishes these three files and links them in the head of every page, with no code of ours.
describe("favicon", () => {
  // CA-01
  it.each(["icon.svg", "favicon.ico", "apple-icon.png"])("has %s at the root of the router", (name) => {
    expect(() => read(name)).not.toThrow();
  });

  // CA-02
  it("draws the UTF of the logo of the UTFPR, in its colours, on a white rounded square, with no text and no embedded image", () => {
    const svg = read("icon.svg").toString("utf8");
    const box = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    expect(box).not.toBeNull();
    expect(box![1]).toBe(box![2]);
    expect(svg).toMatch(/<rect(?=[^>]*rx="\d+")(?=[^>]*fill="#FFFFFF")[^>]*>/i);
    expect(svg).toContain('fill="#F6C212"');
    expect(svg).toContain('fill="#231F20"');
    for (const letter of logo.match(/<path[\s\S]*?\/>/g)!.slice(0, 3)) {
      expect(svg).toContain(letter.match(/ d="([^"]+)"/)![1]!);
    }
    expect(svg).not.toMatch(/<text|<image/);
  });

  // CA-03
  it("has the images of 16, 32 and 48 px in the .ico", () => {
    const ico = read("favicon.ico");
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16]!);
    expect(sizes.sort((a, b) => a - b)).toEqual([16, 32, 48]);
  });

  // CA-04
  it("has the apple icon as a PNG of 180 by 180 px", () => {
    const png = read("apple-icon.png");
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(180); // width, in the IHDR chunk
    expect(png.readUInt32BE(20)).toBe(180); // height
  });
});

import { describe, expect, it } from "vitest";
import { passwordHash, randomSalt } from "./shadow";

// Covers SPEC-031 CA-09: the hashes of /etc/shadow are the ones of Ubuntu (vectors of the authors of the schemes).
describe("password hashes (CA-09)", () => {
  it("SHA-512-crypt gives the vector of Ulrich Drepper", async () => {
    expect(await passwordHash("6", "Hello world!", "saltstring")).toBe(
      "$6$saltstring$svn8UoSVapNtMuq1ukKS4tPQd8iKwSMHWjl/O817G3uBnIFNjnQJuesI68u4OTLiBFdcbYEdFCoEOfaS35inz1",
    );
  });

  it("SHA-256-crypt gives the vector of Ulrich Drepper", async () => {
    expect(await passwordHash("5", "Hello world!", "saltstring")).toBe("$5$saltstring$5B8vYYiY.CVt1RlTTf8KbXBH3hsxY/GNooZaBBGWEc5");
  });

  it("MD5-crypt gives the vector of the OpenSSL manual", async () => {
    expect(await passwordHash("1", "password", "xxxxxxxx")).toBe("$1$xxxxxxxx$UYCIxa628.9qXjpQCjM4a.");
  });

  it("cuts the salt where the scheme does and draws salts of the right size", async () => {
    expect(await passwordHash("6", "x", "0123456789abcdefEXTRA")).toMatch(/^\$6\$0123456789abcdef\$/);
    expect(randomSalt("6")).toHaveLength(16);
    expect(randomSalt("1")).toHaveLength(8);
    expect(randomSalt("5")).toMatch(/^[./0-9A-Za-z]{16}$/);
  });
});

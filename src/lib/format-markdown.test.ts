import { describe, expect, it, vi } from "vitest";
import { formatMarkdown } from "./format-markdown";

describe("formatMarkdown", () => {
  it("normalizes list markers and trailing newline", async () => {
    expect(await formatMarkdown("* a\n* b")).toBe("- a\n- b\n");
  });

  it("converts CRLF to LF", async () => {
    expect(await formatMarkdown("# t\r\n\r\ntext\r\n")).toBe("# t\n\ntext\n");
  });

  it("returns source unchanged when formatting throws", async () => {
    vi.doMock("prettier/standalone", () => ({
      format: () => {
        throw new Error("boom");
      },
    }));
    vi.resetModules();
    const { formatMarkdown: mocked } = await import("./format-markdown");
    expect(await mocked("x")).toBe("x");
  });

  it("normalizes CRLF to LF when formatting throws", async () => {
    vi.doMock("prettier/standalone", () => ({
      format: () => {
        throw new Error("boom");
      },
    }));
    vi.resetModules();
    const { formatMarkdown: mocked } = await import("./format-markdown");
    expect(await mocked("a\r\nb")).toBe("a\nb");
  });
});

import { expect, it } from "vitest";
import { formatMarkdown } from "./format-markdown";

it("converts CRLF to LF", () => expect(formatMarkdown("a\r\nb\r\n")).toBe("a\nb\n"));
it("adds trailing newline", () => expect(formatMarkdown("a")).toBe("a\n"));
it("collapses trailing newlines to one", () => expect(formatMarkdown("a\n\n\n")).toBe("a\n"));
it("keeps empty document empty", () => expect(formatMarkdown("")).toBe(""));
it("is idempotent", () => expect(formatMarkdown(formatMarkdown("* a\r\n"))).toBe("* a\n"));

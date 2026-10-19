import { expect, it } from "vitest";
import { matchShortcut } from "./document-shortcuts";

const k = (key: string, shift = false, meta = true) => ({ key, shiftKey: shift, metaKey: meta });

it("cmd+n", () => expect(matchShortcut(k("n"))).toBe("new"));
it("cmd+o", () => expect(matchShortcut(k("o"))).toBe("open"));
it("cmd+s", () => expect(matchShortcut(k("s"))).toBe("save"));
it("cmd+shift+s is saveAs, not save", () => expect(matchShortcut(k("S", true))).toBe("saveAs"));
it("without meta is null", () => expect(matchShortcut(k("s", false, false))).toBeNull());
it("unrelated key is null", () => expect(matchShortcut(k("k"))).toBeNull());

import { expect, it } from "vitest";
import { windowTitle } from "./window-title";

it("untitled clean", () => expect(windowTitle(null, false)).toBe("Untitled"));
it("untitled dirty", () => expect(windowTitle(null, true)).toBe("• Untitled"));
it("file clean uses basename", () =>
  expect(windowTitle("/Users/me/notes/todo.md", false)).toBe("todo.md"));
it("file dirty", () =>
  expect(windowTitle("/Users/me/notes/todo.md", true)).toBe("• todo.md"));

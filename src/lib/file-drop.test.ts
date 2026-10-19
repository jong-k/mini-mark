import { expect, it, vi } from "vitest";
import { blockFileDrop } from "./file-drop";

const event = (types: string[] | null) => ({
  dataTransfer: types === null ? null : { types },
  preventDefault: vi.fn(),
});

it("prevents default for a file drop", () => {
  const e = event(["Files"]);
  blockFileDrop(e);
  expect(e.preventDefault).toHaveBeenCalledTimes(1);
});

it("leaves text and editor-internal drags alone", () => {
  const e = event(["text/plain", "text/html"]);
  blockFileDrop(e);
  expect(e.preventDefault).not.toHaveBeenCalled();
});

it("ignores events without dataTransfer", () => {
  const e = event(null);
  blockFileDrop(e);
  expect(e.preventDefault).not.toHaveBeenCalled();
});

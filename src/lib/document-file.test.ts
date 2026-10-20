import { expect, it, vi } from "vitest";
import { canOverwrite, readDocument, type ReadDocumentDeps } from "./document-file";

function deps(over: Partial<ReadDocumentDeps>): ReadDocumentDeps {
  return {
    path: "/a.md",
    isDirty: () => false,
    changeCount: () => 0,
    confirmDiscard: async () => true,
    modifiedAt: async () => 20,
    read: async () => "content",
    ...over,
  };
}

it("opens a clean document with the mtime taken before the read", async () => {
  const calls: string[] = [];
  const result = await readDocument(
    deps({
      modifiedAt: async () => {
        calls.push("stat");
        return 20;
      },
      read: async () => {
        calls.push("read");
        return "content";
      },
    }),
  );
  expect(result).toEqual({ type: "open", content: "content", mtime: 20 });
  expect(calls).toEqual(["stat", "read"]);
});

it("cancels when dirty and the user keeps the changes", async () => {
  const read = vi.fn(async () => "content");
  const result = await readDocument(deps({ isDirty: () => true, confirmDiscard: async () => false, read }));
  expect(result).toEqual({ type: "cancel" });
  expect(read).not.toHaveBeenCalled();
});

it("asks again when the user typed during the read", async () => {
  let count = 0;
  const confirmDiscard = vi.fn(async () => false);
  const result = await readDocument(
    deps({
      changeCount: () => count,
      read: async () => {
        count++;
        return "content";
      },
      confirmDiscard,
    }),
  );
  expect(result).toEqual({ type: "cancel" });
  expect(confirmDiscard).toHaveBeenCalledTimes(1);
});

it("opens when the user typed during the read but agreed to discard", async () => {
  let count = 0;
  const result = await readDocument(
    deps({
      changeCount: () => count,
      read: async () => {
        count++;
        return "content";
      },
    }),
  );
  expect(result).toEqual({ type: "open", content: "content", mtime: 20 });
});

it("keeps watching disabled when stat fails", async () => {
  await expect(readDocument(deps({ modifiedAt: async () => null }))).resolves.toEqual({
    type: "open",
    content: "content",
    mtime: null,
  });
});

it.each([
  ["no baseline", null, 20, false, true],
  ["unchanged", 10, 10, false, true],
  ["file gone", 10, null, false, true],
  ["changed and declined", 10, 20, false, false],
  ["changed and confirmed", 10, 20, true, true],
])("canOverwrite: %s", async (_name, known, current, answer, expected) => {
  const confirmOverwrite = vi.fn(async () => answer);
  await expect(canOverwrite({ known, modifiedAt: async () => current, confirmOverwrite })).resolves.toBe(expected);
  expect(confirmOverwrite).toHaveBeenCalledTimes(known !== null && current !== null && current !== known ? 1 : 0);
});

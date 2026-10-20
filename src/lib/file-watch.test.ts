import { expect, it, vi } from "vitest";
import { nextWatchAction, pollFileChange, type FileWatchDeps } from "./file-watch";

it("does nothing without a baseline or when the file is missing", () => {
  expect(nextWatchAction(null, 10, false)).toBe("none");
  expect(nextWatchAction(10, null, false)).toBe("none");
});

it("does nothing when mtime is unchanged", () => {
  expect(nextWatchAction(10, 10, true)).toBe("none");
});

it("reloads silently when clean", () => {
  expect(nextWatchAction(10, 20, false)).toBe("reload");
});

it("asks when dirty", () => {
  expect(nextWatchAction(10, 20, true)).toBe("ask");
});

function deps(over: Partial<FileWatchDeps>): FileWatchDeps {
  return {
    path: "/a.md",
    known: 10,
    currentPath: () => "/a.md",
    isDirty: () => false,
    modifiedAt: async () => 20,
    confirmReload: async () => true,
    read: async () => "new",
    ...over,
  };
}

it("reloads with the new baseline when clean", async () => {
  await expect(pollFileChange(deps({}))).resolves.toEqual({ type: "reload", known: 20, content: "new" });
});

it("keeps the edit and advances the baseline when the user declines", async () => {
  const read = vi.fn(async () => "new");
  const result = await pollFileChange(deps({ isDirty: () => true, confirmReload: async () => false, read }));
  expect(result).toEqual({ type: "keep", known: 20 });
  expect(read).not.toHaveBeenCalled();
});

it("discards the read when the document changed meanwhile", async () => {
  let path = "/a.md";
  const read = async () => {
    path = "/b.md"; // 읽는 동안 다른 문서가 열렸다
    return "a-content";
  };
  await expect(pollFileChange(deps({ currentPath: () => path, read }))).resolves.toEqual({ type: "none" });
});

it("discards the read when the user typed meanwhile", async () => {
  let dirty = false;
  const read = async () => {
    dirty = true;
    return "new";
  };
  await expect(pollFileChange(deps({ isDirty: () => dirty, read }))).resolves.toEqual({ type: "none" });
});

it("propagates read errors without touching the baseline", async () => {
  await expect(
    pollFileChange(
      deps({
        read: async () => {
          throw new Error("EACCES");
        },
      }),
    ),
  ).rejects.toThrow("EACCES");
});

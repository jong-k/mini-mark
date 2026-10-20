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
    changeCount: () => 0,
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
  let count = 0;
  const read = async () => {
    count++;
    return "new";
  };
  await expect(pollFileChange(deps({ changeCount: () => count, read }))).resolves.toEqual({ type: "none" });
});

it("discards the read when the user typed after confirming the reload", async () => {
  let count = 3;
  const read = async () => {
    count++; // 대화상자가 닫힌 뒤 읽기가 끝나기 전에 입력했다
    return "new";
  };
  const result = await pollFileChange(
    deps({ isDirty: () => true, confirmReload: async () => true, changeCount: () => count, read }),
  );
  expect(result).toEqual({ type: "none" });
});

it("reloads after confirming when nothing was typed during the read", async () => {
  const result = await pollFileChange(deps({ isDirty: () => true, changeCount: () => 3 }));
  expect(result).toEqual({ type: "reload", known: 20, content: "new" });
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

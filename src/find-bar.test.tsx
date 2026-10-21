// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FindHandle, FindState } from "./editor";
import { FindBar } from "./find-bar";
import type { FindAction } from "./lib/tauri";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let fire: (action: FindAction) => void = () => {};
vi.mock("./lib/tauri", () => ({
  onFindAction: vi.fn(async (handler: (action: FindAction) => void) => {
    fire = handler;
    return () => {};
  }),
}));

// 가짜 핸들. "foo"만 두 번 일치한다.
function fakeFind() {
  const listeners = new Set<(state: FindState) => void>();
  const emit = (state: FindState) => listeners.forEach((l) => l(state));
  return {
    search: vi.fn((query: string) =>
      emit(
        query === "foo"
          ? { query, count: 2, current: 0 }
          : { query, count: 0, current: query === "" ? -1 : -1 },
      ),
    ),
    step: vi.fn(),
    close: vi.fn(() => emit({ query: "", count: 0, current: -1 })),
    selectionText: vi.fn(() => ""),
    onChange: (listener: (state: FindState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } satisfies FindHandle;
}

let root: Root;
let container: HTMLElement;
let find: ReturnType<typeof fakeFind>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  find = fakeFind();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<FindBar find={find} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const open = (action: FindAction = "find") => act(async () => fire(action));
const bar = () => container.querySelector(".find-bar");
const input = () => container.querySelector("input")!;
const count = () => container.querySelector(".find-count")!.textContent;
const typeText = (text: string) =>
  act(async () => {
    const el = input();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const key = (name: string, init: KeyboardEventInit = {}, target: Element = input()) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, ...init }));
  });
const composition = (type: "compositionstart" | "compositionend") =>
  act(async () => {
    input().dispatchEvent(new CompositionEvent(type, { bubbles: true }));
  });
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });

it("opens on the find action and focuses the input without searching an empty query", async () => {
  expect(bar()).toBeNull();
  await open();
  expect(bar()).not.toBeNull();
  expect(document.activeElement).toBe(input());
  expect(find.search).not.toHaveBeenCalled();
  expect(count()).toBe("");
});

it("prefills the editor selection and searches it", async () => {
  find.selectionText.mockReturnValue("foo");
  await open();
  expect(input().value).toBe("foo");
  expect(find.search).toHaveBeenCalledWith("foo");
  expect(count()).toBe("1 / 2");
});

it("debounces typing by 100ms and waits for composition to end", async () => {
  await open();
  await typeText("fo");
  await advance(99);
  expect(find.search).not.toHaveBeenCalled();
  await advance(1);
  expect(find.search).toHaveBeenCalledWith("fo");
  await composition("compositionstart");
  await typeText("foo");
  await advance(200);
  expect(find.search).toHaveBeenCalledTimes(1);
  await composition("compositionend");
  await advance(100);
  expect(find.search).toHaveBeenLastCalledWith("foo");
});

it("composition start cancels a pending search", async () => {
  await open();
  await typeText("f");
  await advance(50);
  await composition("compositionstart");
  await advance(100);
  expect(find.search).not.toHaveBeenCalled();
  await composition("compositionend");
  await advance(100);
  expect(find.search).toHaveBeenCalledWith("f");
});

it("enter searches when the query changed and steps when it did not", async () => {
  await open();
  await typeText("foo");
  await key("Enter");
  expect(find.search).toHaveBeenCalledTimes(1);
  expect(find.search).toHaveBeenCalledWith("foo");
  expect(find.step).not.toHaveBeenCalled();
  await key("Enter");
  await key("Enter", { shiftKey: true });
  await key("ArrowDown");
  await key("ArrowUp");
  expect(find.step.mock.calls).toEqual([[1], [-1], [1], [-1]]);
  expect(find.search).toHaveBeenCalledTimes(1);
});

it("shows 결과 없음 when nothing matches", async () => {
  await open();
  await typeText("zzz");
  await advance(100);
  expect(count()).toBe("결과 없음");
});

it("escape anywhere closes the bar", async () => {
  await open();
  await key("Escape", {}, document.body);
  expect(bar()).toBeNull();
  expect(find.close).toHaveBeenCalledTimes(1);
});

it("clear button empties the query and closes", async () => {
  await open();
  await typeText("foo");
  await advance(100);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="찾기 닫기"]')!.click(),
  );
  expect(bar()).toBeNull();
  expect(find.close).toHaveBeenCalledTimes(1);
  await open();
  expect(input().value).toBe("");
});

it("find next while closed reopens with the previous query and steps", async () => {
  await open();
  await typeText("foo");
  await key("Enter");
  await key("Escape", {}, document.body);
  find.search.mockClear();
  await open("findNext");
  expect(bar()).not.toBeNull();
  expect(find.search).toHaveBeenCalledWith("foo");
  expect(find.step).toHaveBeenCalledWith(1);
  expect(find.search.mock.invocationCallOrder[0]!).toBeLessThan(
    find.step.mock.invocationCallOrder[0]!,
  );
});

it("find next while closed ignores the editor selection", async () => {
  await open();
  await typeText("foo");
  await key("Enter");
  await key("Escape", {}, document.body);
  find.search.mockClear();
  find.selectionText.mockReturnValue("bar");
  await open("findPrev");
  expect(find.search).toHaveBeenCalledWith("foo");
  expect(input().value).toBe("foo");
  expect(find.step).toHaveBeenCalledWith(-1);
});

it("find action while open only refocuses and selects the input", async () => {
  await open();
  await typeText("foo");
  await key("Enter");
  find.search.mockClear();
  input().blur();
  await open("find");
  expect(document.activeElement).toBe(input());
  expect(input().selectionStart).toBe(0);
  expect(input().selectionEnd).toBe(3);
  expect(find.search).not.toHaveBeenCalled();
  expect(find.step).not.toHaveBeenCalled();
});

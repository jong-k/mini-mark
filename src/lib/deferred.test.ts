// @vitest-environment jsdom
import { act, createElement, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { deferred } from "./deferred";

it("resolves the promise created on first render after re-renders", async () => {
  let ready: ReturnType<typeof deferred<void>> | null = null;
  let rerender: () => void = () => {};
  function Probe() {
    const [signal] = useState(deferred<void>);
    const [, setN] = useState(0);
    ready = signal;
    rerender = () => setN((n) => n + 1);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe))));
  const first = ready!.promise;
  await act(async () => rerender());
  await act(async () => rerender());
  let settled = false;
  void first.then(() => (settled = true));
  ready!.resolve();
  await Promise.resolve();
  expect(settled).toBe(true);
  root.unmount();
});

import { expect, it } from "vitest";
import { createTaskQueue } from "./task-queue";

function gate() {
  let open: () => void = () => {};
  const wait = new Promise<void>((r) => {
    open = r;
  });
  return { wait, open: () => open() };
}

it("runs tasks one at a time in order instead of dropping them", async () => {
  const q = createTaskQueue();
  const first = gate();
  const order: string[] = [];
  const a = q.enqueue(async () => {
    await first.wait;
    order.push("a");
  });
  const b = q.enqueue(async () => {
    order.push("b");
  });
  expect(q.idle()).toBe(false);
  expect(order).toEqual([]);
  first.open();
  await Promise.all([a, b]);
  expect(order).toEqual(["a", "b"]);
  expect(q.idle()).toBe(true);
});

it("keeps running later tasks when one rejects", async () => {
  const q = createTaskQueue();
  await q.enqueue(async () => {
    throw new Error("boom");
  });
  let ran = false;
  await q.enqueue(async () => {
    ran = true;
  });
  expect(ran).toBe(true);
  expect(q.idle()).toBe(true);
});

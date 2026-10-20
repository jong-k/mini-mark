/** 문서 동작을 순서대로 하나씩 실행한다. 진행 중인 동작이 끝날 때까지 다음 동작은 기다린다(버리지 않는다). */
export function createTaskQueue() {
  let tail: Promise<void> = Promise.resolve();
  let waiting = 0;
  return {
    enqueue(task: () => Promise<void>): Promise<void> {
      waiting++;
      const run = tail
        .then(task)
        .catch(() => {})
        .finally(() => {
          waiting--;
        });
      tail = run;
      return run;
    },
    idle(): boolean {
      return waiting === 0;
    },
  };
}

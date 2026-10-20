// ponytail: 2초 mtime 폴링. 지연이 문제되면 notify 크레이트로 교체.

export type WatchAction = "none" | "reload" | "ask";

export function nextWatchAction(
  known: number | null,
  current: number | null,
  isDirty: boolean,
): WatchAction {
  if (known === null || current === null || current === known) return "none";
  return isDirty ? "ask" : "reload";
}

export interface FileWatchDeps {
  path: string;
  known: number | null;
  currentPath: () => string | null;
  isDirty: () => boolean;
  /** 사용자 입력마다 증가. 읽는 동안 바뀌었으면 결과를 버린다. */
  changeCount: () => number;
  modifiedAt: (path: string) => Promise<number | null>;
  confirmReload: () => Promise<boolean>;
  read: (path: string) => Promise<string>;
}

export type FileWatchResult =
  | { type: "none" }
  | { type: "keep"; known: number }
  | { type: "reload"; known: number; content: string };

/**
 * 폴링 한 회. 읽는 동안 문서가 바뀌거나 입력이 생기면 결과를 버리고 기준값도 그대로 둔다.
 * 다시 불러오기를 확인한 뒤에도 대화상자가 닫히고 읽기가 끝나기 전까지 입력이 들어올 수 있다.
 * `read` 에러는 전파한다. 호출자가 표시하고 기준값을 소비한다.
 */
export async function pollFileChange(deps: FileWatchDeps): Promise<FileWatchResult> {
  const current = await deps.modifiedAt(deps.path);
  const action = nextWatchAction(deps.known, current, deps.isDirty());
  if (action === "none" || current === null) return { type: "none" };
  if (action === "ask" && !(await deps.confirmReload())) return { type: "keep", known: current };
  const changesBeforeRead = deps.changeCount();
  const content = await deps.read(deps.path);
  if (deps.currentPath() !== deps.path) return { type: "none" };
  if (deps.changeCount() !== changesBeforeRead) return { type: "none" };
  return { type: "reload", known: current, content };
}

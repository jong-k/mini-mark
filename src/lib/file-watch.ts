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
  modifiedAt: (path: string) => Promise<number | null>;
  confirmReload: () => Promise<boolean>;
  read: (path: string) => Promise<string>;
}

export type FileWatchResult =
  | { type: "none" }
  | { type: "keep"; known: number }
  | { type: "reload"; known: number; content: string };

/**
 * 폴링 한 회. 읽는 동안 문서가 바뀌거나(clean 경로에서) 입력이 생기면 결과를 버리고 기준값도 그대로 둔다.
 * `read` 에러는 전파한다. 호출자가 표시하고 기준값을 소비한다.
 */
export async function pollFileChange(deps: FileWatchDeps): Promise<FileWatchResult> {
  const current = await deps.modifiedAt(deps.path);
  const action = nextWatchAction(deps.known, current, deps.isDirty());
  if (action === "none" || current === null) return { type: "none" };
  // "ask"에서 버리기를 확인하면 사용자가 이미 입력 포기를 선택했으므로 읽은 뒤 isDirty는 다시 보지 않는다.
  const confirmed = action === "ask";
  if (confirmed && !(await deps.confirmReload())) return { type: "keep", known: current };
  const content = await deps.read(deps.path);
  if (deps.currentPath() !== deps.path) return { type: "none" };
  if (!confirmed && deps.isDirty()) return { type: "none" };
  return { type: "reload", known: current, content };
}

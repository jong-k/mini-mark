export interface ReadDocumentDeps {
  path: string;
  isDirty: () => boolean;
  /** 사용자 입력마다 증가. 읽는 동안 바뀌었으면 다시 묻는다. */
  changeCount: () => number;
  confirmDiscard: () => Promise<boolean>;
  modifiedAt: (path: string) => Promise<number | null>;
  read: (path: string) => Promise<string>;
}

export type ReadDocumentResult = { type: "cancel" } | { type: "open"; content: string; mtime: number | null };

/**
 * 문서를 열기 위한 확인과 읽기. 미저장 변경이 있으면 버릴지 묻는다.
 * 읽기 뒤에 stat하면 그 사이 외부 수정의 mtime만 남아 변경을 놓치므로 먼저 stat한다. 그러면 다음 폴링이 다시 불러온다.
 * 읽는 동안 입력이 생기면 setValue가 그 입력을 덮어쓰므로 다시 묻는다.
 */
export async function readDocument(deps: ReadDocumentDeps): Promise<ReadDocumentResult> {
  if (deps.isDirty() && !(await deps.confirmDiscard())) return { type: "cancel" };
  const mtime = await deps.modifiedAt(deps.path);
  const changesBeforeRead = deps.changeCount();
  const content = await deps.read(deps.path);
  if (deps.changeCount() !== changesBeforeRead && !(await deps.confirmDiscard())) return { type: "cancel" };
  return { type: "open", content, mtime };
}

export interface CanOverwriteDeps {
  /** 감시 기준 mtime. null이면 확인 없이 저장한다. */
  known: number | null;
  modifiedAt: () => Promise<number | null>;
  confirmOverwrite: () => Promise<boolean>;
}

/** 저장 전 외부 변경 확인. 2초 폴링 사이에 생긴 외부 수정을 확인 없이 덮어쓰지 않는다. 파일이 사라졌으면 다시 만든다. */
export async function canOverwrite(deps: CanOverwriteDeps): Promise<boolean> {
  if (deps.known === null) return true;
  const current = await deps.modifiedAt();
  if (current === null || current === deps.known) return true;
  return deps.confirmOverwrite();
}

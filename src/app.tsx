import { useEffect, useRef, useState } from "react";
import "./app.css";
import { Editor, type EditorHandle } from "./editor";
import { deferred } from "./lib/deferred";
import { canOverwrite, readDocument } from "./lib/document-file";
import { blockFileDrop } from "./lib/file-drop";
import { pollFileChange } from "./lib/file-watch";
import { formatMarkdown } from "./lib/format-markdown";
import { createTaskQueue } from "./lib/task-queue";
import {
  addRecentFile,
  confirmDiscard,
  confirmOverwrite,
  confirmReload,
  fileModifiedAt,
  onDocumentAction,
  onOpenFileRequested,
  onWindowCloseRequested,
  pickOpenPath,
  pickSavePath,
  readMarkdown,
  saveMarkdownAtomic,
  setWindowTitle,
  showError,
  takeOpenedFile,
} from "./lib/tauri";
import { windowTitle } from "./lib/window-title";

interface DocumentMeta {
  filePath: string | null;
  isDirty: boolean;
  /** 외부 변경 감지 기준 mtime. null이면 감시하지 않는다(새 문서). */
  knownMtime: number | null;
}

const statOrNull = (path: string) => fileModifiedAt(path).catch(() => null);

export default function App() {
  const editor = useRef<EditorHandle>(null);
  // 문서 메타데이터는 React 상태가 아니라 ref 하나에 둔다. 렌더가 없으니 모든 함수가 항상 최신값을 읽고, 바뀌면 창 제목만 갱신한다.
  const doc = useRef<DocumentMeta>({ filePath: null, isDirty: false, knownMtime: null });
  // 입력마다 증가. 읽는 동안 입력이 있었는지 readDocument와 pollFileChange가 비교한다.
  const changeCount = useRef(0);
  // 문서 동작은 큐로 직렬화한다. 저장 중 들어온 Cmd+N/Cmd+O나 Finder 열기는 버리지 않고 앞 동작이 끝난 뒤 실행한다.
  const [queue] = useState(createTaskQueue);
  // useRef(new Promise(...))는 렌더마다 executor가 돌아 resolver가 버려지는 Promise로 바뀐다. 지연 초기화로 한 번만 만든다.
  const [editorReady] = useState(deferred<void>);

  function update(patch: Partial<DocumentMeta>) {
    const before = windowTitle(doc.current.filePath, doc.current.isDirty);
    Object.assign(doc.current, patch);
    const after = windowTitle(doc.current.filePath, doc.current.isDirty);
    if (after !== before) void setWindowTitle(after);
  }

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      await showError(String(err));
    }
  }

  // 에디터 생성 전에 들어온 동작은 버리지 않고 기다린다.
  async function waitEditor(): Promise<EditorHandle> {
    await editorReady.promise;
    return editor.current!;
  }

  function newDocument() {
    return run(async () => {
      const h = await waitEditor();
      if (doc.current.isDirty && !(await confirmDiscard())) return;
      h.setFilePath(null);
      h.setValue("");
      update({ filePath: null, isDirty: false, knownMtime: null });
    });
  }

  // 큐에 넣지 않는다. 진입점(메뉴, Finder 열기, 폴링)이 queue.enqueue로 한 번만 감싼다.
  function openPath(path: string) {
    return run(async () => {
      const h = await waitEditor();
      const result = await readDocument({
        path,
        isDirty: () => doc.current.isDirty,
        changeCount: () => changeCount.current,
        confirmDiscard,
        modifiedAt: statOrNull,
        read: readMarkdown,
      });
      if (result.type === "cancel") return;
      h.setFilePath(path);
      h.setValue(result.content);
      update({ filePath: path, isDirty: false, knownMtime: result.mtime });
      // 최근 목록은 부가 기능이다. 실패해도 열기는 성공했으므로 오류를 보이지 않는다.
      await addRecentFile(path).catch(() => {});
    });
  }

  async function openDocument() {
    const path = await pickOpenPath().catch(async (err) => {
      await showError(String(err));
      return null;
    });
    if (path === null) return;
    await openPath(path);
  }

  function saveDocument(path: string) {
    return run(async () => {
      const h = await waitEditor();
      const { filePath, knownMtime } = doc.current;
      // 다른 경로로 저장하면 네이티브 대화상자가 이미 덮어쓰기를 물었다.
      if (
        path === filePath &&
        !(await canOverwrite({ known: knownMtime, modifiedAt: () => statOrNull(path), confirmOverwrite }))
      ) {
        return;
      }
      // getValue가 이 경로 기준으로 상대 경로를 직렬화한다. 먼저 불러야 한다.
      h.setFilePath(path);
      const source = h.getValue();
      let mtime: number;
      try {
        mtime = await saveMarkdownAtomic(path, formatMarkdown(source));
      } catch (err) {
        h.setFilePath(filePath);
        throw err;
      }
      // 저장 중 입력했으면 더티를 유지한다.
      update({ filePath: path, knownMtime: mtime, isDirty: h.getValue() !== source });
      await addRecentFile(path).catch(() => {});
    });
  }

  async function saveAs() {
    const path = await pickSavePath(doc.current.filePath ?? "Untitled.md").catch(async (err) => {
      await showError(String(err));
      return null;
    });
    if (path === null) return;
    await saveDocument(path);
  }

  async function save() {
    const { filePath } = doc.current;
    if (filePath) await saveDocument(filePath);
    else await saveAs();
  }

  async function tick() {
    const { filePath, knownMtime } = doc.current;
    const h = editor.current;
    if (filePath === null || h === null) return;
    const result = await pollFileChange({
      path: filePath,
      known: knownMtime,
      currentPath: () => doc.current.filePath,
      isDirty: () => doc.current.isDirty,
      changeCount: () => changeCount.current,
      modifiedAt: statOrNull,
      confirmReload,
      read: readMarkdown,
    }).catch(async (err) => {
      // 실패를 소비하지 않으면 2초마다 같은 오류가 뜬다. 한 번 보이고 다음 외부 변경에서 다시 시도한다.
      await showError(String(err));
      const current = await statOrNull(filePath);
      return current === null ? { type: "none" as const } : { type: "keep" as const, known: current };
    });
    if (result.type === "none") return;
    update({ knownMtime: result.known });
    if (result.type !== "reload") return;
    // 내용이 같으면(git checkout, 포매터 재저장, touch) 본문을 바꾸지 않아 undo 기록과 커서를 지킨다.
    if (formatMarkdown(result.content) !== formatMarkdown(h.getValue())) h.setValue(result.content);
    update({ isDirty: false });
  }

  const actions = { new: newDocument, open: openDocument, save, saveAs };

  useEffect(() => {
    void setWindowTitle(windowTitle(null, false));
    const opening = onOpenFileRequested((p) => void queue.enqueue(() => openPath(p)));
    // 리스너와 에디터가 모두 준비된 뒤 가져온다. take가 Rust의 ready를 세워 이후 요청은 이벤트로만 온다.
    void Promise.all([opening, editorReady.promise]).then(async () => {
      const p = await takeOpenedFile().catch(() => null);
      if (p !== null) await queue.enqueue(() => openPath(p));
    });
    // 단축키는 File 메뉴 accelerator가 받아 이 이벤트로 온다.
    const acting = onDocumentAction((a) => void queue.enqueue(() => actions[a]()));
    // ponytail: 버리기/취소 2버튼. 저장/버리기/취소 3버튼이 필요하면 커스텀 모달로 교체.
    const closing = onWindowCloseRequested(async () => !doc.current.isDirty || (await confirmDiscard()));
    // 틱은 큐가 비었을 때만 들어간다. 문서 동작 중에는 건너뛰고, 틱 중 들어온 사용자 요청은 큐에서 기다린다.
    const interval = setInterval(() => {
      if (queue.idle()) void queue.enqueue(tick);
    }, 2000);
    window.addEventListener("dragover", blockFileDrop);
    window.addEventListener("drop", blockFileDrop);
    return () => {
      clearInterval(interval);
      for (const listening of [opening, acting, closing]) void listening.then((fn) => fn());
      window.removeEventListener("dragover", blockFileDrop);
      window.removeEventListener("drop", blockFileDrop);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 한 번만 등록한다. 핸들러는 doc ref로 최신값을 읽는다.
  }, []);

  return (
    <Editor
      handleRef={editor}
      onChange={() => {
        changeCount.current++;
        update({ isDirty: true });
      }}
      onReady={() => editorReady.resolve()}
    />
  );
}

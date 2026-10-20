import { useEffect, useRef, useState } from "react";
import "./app.css";
import { Editor, type EditorHandle } from "./editor";
import { deferred } from "./lib/deferred";
import { blockFileDrop } from "./lib/file-drop";
import { pollFileChange } from "./lib/file-watch";
import { formatMarkdown } from "./lib/format-markdown";
import {
  addRecentFile,
  confirmDiscard,
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

export default function App() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const editor = useRef<EditorHandle>(null);
  // 외부 변경 감지 기준 mtime. null이면 감시하지 않는다(새 문서, 저장 진행 중).
  const knownMtime = useRef<number | null>(null);

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      await showError(String(err));
    }
  }

  function newDocument() {
    return run(async () => {
      const h = editor.current;
      if (!h) return;
      if (isDirty && !(await confirmDiscard())) return;
      h.setFilePath(null);
      h.setValue("");
      setFilePath(null);
      setIsDirty(false);
      knownMtime.current = null;
    });
  }

  // 가드를 잡지 않는다. 진입점(메뉴, Finder 열기, 폴링)이 guarded로 한 번만 감싼다.
  function openPath(path: string) {
    return run(async () => {
      const h = editor.current;
      if (!h) return;
      if (isDirtyRef.current && !(await confirmDiscard())) return;
      const content = await readMarkdown(path);
      h.setFilePath(path);
      h.setValue(content);
      setFilePath(path);
      setIsDirty(false);
      knownMtime.current = await fileModifiedAt(path).catch(() => null);
      await addRecentFile(path);
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
      const h = editor.current;
      if (!h) return;
      // getValue가 이 경로 기준으로 상대 경로 이미지를 직렬화한다. 먼저 불러야 한다.
      h.setFilePath(path);
      const source = h.getValue();
      // 저장 중 폴링이 자기 저장을 외부 변경으로 오인하지 않도록 감시를 멈춘다.
      knownMtime.current = null;
      try {
        await saveMarkdownAtomic(path, formatMarkdown(source));
      } catch (err) {
        h.setFilePath(filePath);
        knownMtime.current = filePath === null ? null : await fileModifiedAt(filePath).catch(() => null);
        throw err;
      }
      knownMtime.current = await fileModifiedAt(path).catch(() => null);
      setFilePath(path);
      if (h.getValue() === source) setIsDirty(false);
      await addRecentFile(path);
    });
  }

  async function saveAs() {
    const path = await pickSavePath(filePath ?? "Untitled.md").catch(async (err) => {
      await showError(String(err));
      return null;
    });
    if (path === null) return;
    await saveDocument(path);
  }

  async function save() {
    if (filePath) await saveDocument(filePath);
    else await saveAs();
  }

  useEffect(() => {
    setWindowTitle(windowTitle(filePath, isDirty));
  }, [filePath, isDirty]);

  const actions = useRef({ new: newDocument, open: openDocument, save, saveAs });
  actions.current = { new: newDocument, open: openDocument, save, saveAs };

  const busy = useRef(false);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  async function tick() {
    const path = filePathRef.current;
    const h = editor.current;
    if (path === null || h === null) return;
    const result = await pollFileChange({
      path,
      known: knownMtime.current,
      currentPath: () => filePathRef.current,
      isDirty: () => isDirtyRef.current,
      modifiedAt: (p) => fileModifiedAt(p).catch(() => null),
      confirmReload,
      read: readMarkdown,
    }).catch(async (err) => {
      // 실패를 소비하지 않으면 2초마다 같은 오류가 뜬다. 한 번 보이고 다음 외부 변경에서 다시 시도한다.
      await showError(String(err));
      const current = await fileModifiedAt(path).catch(() => null);
      return current === null ? { type: "none" as const } : { type: "keep" as const, known: current };
    });
    if (result.type === "none") return;
    knownMtime.current = result.known;
    if (result.type === "reload") {
      h.setValue(result.content);
      setIsDirty(false);
    }
  }
  const tickRef = useRef(tick);
  tickRef.current = tick;

  // 저장 중 Cmd+N/Cmd+O가 끼어들면 새 문서가 이전 경로에 묶인다. 진행 중인 동작이 끝날 때까지 다른 진입을 무시한다.
  // 이벤트 진입점에서만 부른다. 문서 함수 안에서 중첩하면 안쪽 호출이 무시된다.
  async function guarded(fn: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    try {
      await fn();
    } finally {
      busy.current = false;
    }
  }
  const guardedRef = useRef(guarded);
  guardedRef.current = guarded;

  // useRef(new Promise(...))는 렌더마다 executor가 돌아 resolver가 버려지는 Promise로 바뀐다. 지연 초기화로 한 번만 만든다.
  const [editorReady] = useState(deferred<void>);

  useEffect(() => {
    const listening = onOpenFileRequested((p) => void guardedRef.current(() => openPath(p)));
    // 리스너와 에디터가 모두 준비된 뒤 가져온다. take가 Rust의 ready를 세워 이후 요청은 이벤트로만 온다.
    void Promise.all([listening, editorReady.promise]).then(async () => {
      const p = await takeOpenedFile().catch(() => null);
      if (p !== null) await guardedRef.current(() => openPath(p));
    });
    // guarded가 busy를 잡으므로 틱 동안 메뉴와 Finder 열기는 무시되고, 문서 동작 중에는 틱이 건너뛴다.
    const interval = setInterval(() => void guardedRef.current(() => tickRef.current()), 2000);
    return () => {
      clearInterval(interval);
      void listening.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    // ponytail: 버리기/취소 2버튼. 저장/버리기/취소 3버튼이 필요하면 커스텀 모달로 교체.
    const unlisten = onWindowCloseRequested(
      async () => !isDirtyRef.current || (await confirmDiscard()),
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    // 단축키는 File 메뉴 accelerator가 받아 이 이벤트로 온다.
    const listening = onDocumentAction((a) => void guardedRef.current(() => actions.current[a]()));
    window.addEventListener("dragover", blockFileDrop);
    window.addEventListener("drop", blockFileDrop);
    return () => {
      void listening.then((fn) => fn());
      window.removeEventListener("dragover", blockFileDrop);
      window.removeEventListener("drop", blockFileDrop);
    };
  }, []);

  return (
    <Editor
      handleRef={editor}
      onChange={() => setIsDirty(true)}
      onReady={() => editorReady.resolve()}
    />
  );
}

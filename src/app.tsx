import { useEffect, useRef, useState } from "react";
import "./app.css";
import { Editor, type EditorHandle } from "./editor";
import { matchShortcut } from "./lib/document-shortcuts";
import { blockFileDrop } from "./lib/file-drop";
import { formatMarkdown } from "./lib/format-markdown";
import {
  confirmDiscard,
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
      try {
        await saveMarkdownAtomic(path, formatMarkdown(source));
      } catch (err) {
        h.setFilePath(filePath);
        throw err;
      }
      setFilePath(path);
      if (h.getValue() !== source) return;
      setIsDirty(false);
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

  const editorReady = useRef<() => void>(() => {});
  const editorReadyPromise = useRef(
    new Promise<void>((resolve) => {
      editorReady.current = resolve;
    }),
  );

  useEffect(() => {
    const listening = onOpenFileRequested((p) => void guardedRef.current(() => openPath(p)));
    // 리스너와 에디터가 모두 준비된 뒤 가져온다. take가 Rust의 ready를 세워 이후 요청은 이벤트로만 온다.
    void Promise.all([listening, editorReadyPromise.current]).then(async () => {
      const p = await takeOpenedFile().catch(() => null);
      if (p !== null) await guardedRef.current(() => openPath(p));
    });
    return () => {
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
    function onKeyDown(e: KeyboardEvent) {
      const action = matchShortcut(e);
      if (action === null) return;
      e.preventDefault();
      void guardedRef.current(() => actions.current[action]());
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("dragover", blockFileDrop);
    window.addEventListener("drop", blockFileDrop);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("dragover", blockFileDrop);
      window.removeEventListener("drop", blockFileDrop);
    };
  }, []);

  return (
    <Editor
      handleRef={editor}
      onChange={() => setIsDirty(true)}
      onReady={() => editorReady.current()}
    />
  );
}

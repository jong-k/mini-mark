import { useEffect, useRef, useState } from "react";
import "./app.css";
import { Editor, type EditorHandle } from "./editor";
import { deferred } from "./lib/deferred";
import { blockFileDrop } from "./lib/file-drop";
import { pollFileChange } from "./lib/file-watch";
import { formatMarkdown } from "./lib/format-markdown";
import { createTaskQueue } from "./lib/task-queue";
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
  // 입력마다 증가. 폴링이 읽는 동안 입력이 있었는지 pollFileChange가 비교한다.
  const changeCount = useRef(0);

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

  // 큐에 넣지 않는다. 진입점(메뉴, Finder 열기, 폴링)이 queue.enqueue로 한 번만 감싼다.
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
      changeCount: () => changeCount.current,
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

  // 문서 동작은 큐로 직렬화한다. 저장 중 들어온 Cmd+N/Cmd+O나 Finder 열기는 버리지 않고 앞 동작이 끝난 뒤 실행한다.
  const [queue] = useState(createTaskQueue);

  // useRef(new Promise(...))는 렌더마다 executor가 돌아 resolver가 버려지는 Promise로 바뀐다. 지연 초기화로 한 번만 만든다.
  const [editorReady] = useState(deferred<void>);

  useEffect(() => {
    const listening = onOpenFileRequested((p) => void queue.enqueue(() => openPath(p)));
    // 리스너와 에디터가 모두 준비된 뒤 가져온다. take가 Rust의 ready를 세워 이후 요청은 이벤트로만 온다.
    void Promise.all([listening, editorReady.promise]).then(async () => {
      const p = await takeOpenedFile().catch(() => null);
      if (p !== null) await queue.enqueue(() => openPath(p));
    });
    // 틱은 큐가 비었을 때만 들어간다. 문서 동작 중에는 건너뛰고, 틱 중 들어온 사용자 요청은 큐에서 기다린다.
    const interval = setInterval(() => {
      if (queue.idle()) void queue.enqueue(() => tickRef.current());
    }, 2000);
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
    const listening = onDocumentAction((a) => void queue.enqueue(() => actions.current[a]()));
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
      onChange={() => {
        changeCount.current++;
        setIsDirty(true);
      }}
      onReady={() => editorReady.resolve()}
    />
  );
}

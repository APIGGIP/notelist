"use client";

import {
  CloudAlert,
  CloudCheck,
  FileText,
  ListTodo,
  LoaderCircle,
  PencilLine,
  Plus,
  RefreshCw,
  Trash2
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from "react";

import { formatCurrency, parsePriceInput } from "@/lib/money";
import type { NotebookMode, NotebookState, TodoItem } from "@/types/notebook";

import styles from "./notebook-workspace.module.css";

type NotebookWorkspaceProps = {
  initialState: NotebookState | null;
  bootstrapError: string | null;
};

type TodoEditorState = {
  id: string;
  title: string;
  price: string;
};

type NoteConflictState = {
  localText: string;
  serverState: NotebookState;
};

const MODE_STORAGE_KEY = "notesite:last-mode";
const SYNC_STORAGE_KEY = "notesite:last-sync";
const POLL_INTERVAL_MS = 5000;
const NOTE_SAVE_DELAY_MS = 750;
const FETCH_INIT: RequestInit = {
  cache: "no-store",
  headers: {
    "Cache-Control": "no-store"
  }
};

function formatSyncLabel(timestamp: string | null) {
  if (!timestamp) {
    return "尚未同步";
  }

  return `已同步 ${new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp))}`;
}

function requestJson<T>(url: string, init?: RequestInit) {
  return fetch(url, {
    ...FETCH_INIT,
    ...init,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  }).then(async (response) => {
    const payload = response.status === 204 ? null : ((await response.json()) as T | { error?: string });

    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "Request failed.";

      return Promise.reject(
        Object.assign(new Error(message), {
          status: response.status,
          payload
        })
      );
    }

    return payload as T;
  });
}

function useEvent<T extends (...args: never[]) => unknown>(handler: T) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  return useCallback((...args: Parameters<T>) => handlerRef.current(...args), []);
}

function ModalShell({
  title,
  description,
  onClose,
  children,
  actions
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className={styles.modalOverlay} role="presentation" onClick={onClose}>
      <div
        className={styles.modalCard}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
        </div>
        <div className={styles.modalBody}>{children}</div>
        <div className={styles.modalActions}>{actions}</div>
      </div>
    </div>
  );
}

export function NotebookWorkspace({ initialState, bootstrapError }: NotebookWorkspaceProps) {
  const [mode, setMode] = useState<NotebookMode>("note");
  const [bootError, setBootError] = useState<string | null>(bootstrapError);
  const [noteText, setNoteText] = useState(initialState?.noteText ?? "");
  const [noteRevision, setNoteRevision] = useState(initialState?.noteRevision ?? 0);
  const [stateRevision, setStateRevision] = useState(initialState?.stateRevision ?? 0);
  const [todos, setTodos] = useState<TodoItem[]>(initialState?.todos ?? []);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialState?.updatedAt ?? null);
  const [loadingState, setLoadingState] = useState(initialState ? false : true);
  const [refreshingState, setRefreshingState] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteDirty, setNoteDirty] = useState(false);
  const [noteSaveError, setNoteSaveError] = useState<string | null>(null);
  const [todoError, setTodoError] = useState<string | null>(null);
  const [newTodoTitle, setNewTodoTitle] = useState("");
  const [newTodoPrice, setNewTodoPrice] = useState("");
  const [newTodoError, setNewTodoError] = useState<string | null>(null);
  const [busyTodoId, setBusyTodoId] = useState<string | null>(null);
  const [creatingTodo, setCreatingTodo] = useState(false);
  const [editTodo, setEditTodo] = useState<TodoEditorState | null>(null);
  const [editTodoError, setEditTodoError] = useState<string | null>(null);
  const [deleteTodoItem, setDeleteTodoItem] = useState<TodoItem | null>(null);
  const [noteConflict, setNoteConflict] = useState<NoteConflictState | null>(null);

  const titleInputId = useId();
  const priceInputId = useId();
  const editTitleId = useId();
  const editPriceId = useId();

  const noteTextRef = useRef(noteText);
  const noteRevisionRef = useRef(noteRevision);
  const stateRevisionRef = useRef(stateRevision);
  const noteDirtyRef = useRef(noteDirty);
  const lastPersistedTextRef = useRef(initialState?.noteText ?? "");
  const saveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const queuedSaveRef = useRef(false);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const bootstrappedRef = useRef(Boolean(initialState));
  const syncRequestIdRef = useRef(0);

  useEffect(() => {
    noteTextRef.current = noteText;
  }, [noteText]);

  useEffect(() => {
    noteRevisionRef.current = noteRevision;
  }, [noteRevision]);

  useEffect(() => {
    stateRevisionRef.current = stateRevision;
  }, [stateRevision]);

  useEffect(() => {
    noteDirtyRef.current = noteDirty;
  }, [noteDirty]);

  useEffect(() => {
    const storedMode = window.localStorage.getItem(MODE_STORAGE_KEY);

    if (storedMode === "note" || storedMode === "todo") {
      setMode(storedMode);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);

  const broadcastSnapshot = useEvent((snapshot: NotebookState) => {
    try {
      window.localStorage.setItem(
        SYNC_STORAGE_KEY,
        JSON.stringify({
          revision: snapshot.stateRevision,
          time: Date.now()
        })
      );
    } catch {
      // Ignore storage quota errors.
    }

    broadcastChannelRef.current?.postMessage({
      type: "snapshot",
      snapshot
    });
  });

  const applyIncomingSnapshot = useEvent(
    (snapshot: NotebookState, options?: { replaceNote?: boolean; markBootstrapped?: boolean }) => {
      if (snapshot.stateRevision < stateRevisionRef.current) {
        return;
      }

      setTodos(snapshot.todos);
      setStateRevision(snapshot.stateRevision);
      stateRevisionRef.current = snapshot.stateRevision;
      setUpdatedAt(snapshot.updatedAt);

      const shouldReplaceNote =
        options?.replaceNote || !noteDirtyRef.current || snapshot.noteText === noteTextRef.current;

      if (shouldReplaceNote) {
        noteTextRef.current = snapshot.noteText;
        lastPersistedTextRef.current = snapshot.noteText;
        noteRevisionRef.current = snapshot.noteRevision;
        setNoteText(snapshot.noteText);
        setNoteRevision(snapshot.noteRevision);
        setNoteDirty(false);
        noteDirtyRef.current = false;
        setNoteSaveError(null);
      }

      if (options?.markBootstrapped) {
        bootstrappedRef.current = true;
        setLoadingState(false);
        setBootError(null);
      }
    }
  );

  const fetchLatestState = useEvent(async (reason: "bootstrap" | "poll" | "focus" | "manual") => {
    const requestId = syncRequestIdRef.current + 1;
    syncRequestIdRef.current = requestId;

    if (reason === "bootstrap") {
      setLoadingState(true);
    } else {
      setRefreshingState(true);
    }

    try {
      const since = reason === "bootstrap" ? undefined : stateRevisionRef.current;
      const query = since !== undefined ? `?since=${since}` : "";
      const response = await fetch(`/api/state${query}`, FETCH_INIT);

      if (response.status === 204) {
        return;
      }

      const payload = (await response.json()) as NotebookState | { error?: string };

      if (!response.ok) {
        throw new Error(
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "無法讀取最新資料。"
        );
      }

      if (requestId !== syncRequestIdRef.current) {
        return;
      }

      applyIncomingSnapshot(payload as NotebookState, {
        markBootstrapped: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "無法讀取最新資料。";

      if (!bootstrappedRef.current) {
        setBootError(message);
      }
    } finally {
      setLoadingState(false);
      setRefreshingState(false);
    }
  });

  useEffect(() => {
    if (!initialState) {
      void fetchLatestState("bootstrap");
      return;
    }

    bootstrappedRef.current = true;
  }, [fetchLatestState, initialState]);

  useEffect(() => {
    if (typeof BroadcastChannel !== "undefined") {
      broadcastChannelRef.current = new BroadcastChannel("notesite-sync");
      broadcastChannelRef.current.onmessage = (event) => {
        if (event.data?.type === "snapshot" && event.data.snapshot) {
          applyIncomingSnapshot(event.data.snapshot as NotebookState);
        }
      };
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key === SYNC_STORAGE_KEY && event.newValue) {
        void fetchLatestState("manual");
      }
    };

    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("storage", onStorage);
      broadcastChannelRef.current?.close();
    };
  }, [applyIncomingSnapshot, fetchLatestState]);

  const syncEnabled = !loadingState && !bootError;

  useEffect(() => {
    if (!syncEnabled) {
      return;
    }

    const interval = window.setInterval(() => {
      if (!document.hidden) {
        void fetchLatestState("poll");
      }
    }, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (!document.hidden) {
        void fetchLatestState("focus");
      }
    };

    const onFocus = () => {
      void fetchLatestState("focus");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchLatestState, syncEnabled]);

  const flushNote = useEvent(async (force = false, revisionOverride?: number) => {
    if ((!noteDirtyRef.current && !force) || !bootstrappedRef.current) {
      return;
    }

    if (saveInFlightRef.current) {
      queuedSaveRef.current = true;
      return;
    }

    saveInFlightRef.current = true;
    setNoteSaving(true);
    setNoteSaveError(null);

    const draft = noteTextRef.current;
    const baseRevision = revisionOverride ?? noteRevisionRef.current;

    let conflictDetected = false;

    try {
      const response = await fetch("/api/note", {
        ...FETCH_INIT,
        method: "PUT",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        },
        body: JSON.stringify({
          text: draft,
          baseRevision,
          force
        })
      });

      const payload =
        response.status === 204
          ? null
          : ((await response.json()) as
              | NotebookState
              | {
                  conflict: true;
                  state: NotebookState;
                }
              | { error?: string });

      if (response.status === 409 && payload && "state" in payload) {
        conflictDetected = true;
        setNoteConflict({
          localText: draft,
          serverState: payload.state
        });
        return;
      }

      if (!response.ok) {
        throw new Error(
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "無法儲存筆記。"
        );
      }

      const snapshot = payload as NotebookState;

      setTodos(snapshot.todos);
      setStateRevision(snapshot.stateRevision);
      stateRevisionRef.current = snapshot.stateRevision;
      setUpdatedAt(snapshot.updatedAt);
      setNoteRevision(snapshot.noteRevision);
      noteRevisionRef.current = snapshot.noteRevision;
      lastPersistedTextRef.current = snapshot.noteText;
      setNoteConflict(null);

      if (noteTextRef.current === draft) {
        noteTextRef.current = snapshot.noteText;
        setNoteText(snapshot.noteText);
        setNoteDirty(false);
        noteDirtyRef.current = false;
      } else {
        setNoteDirty(true);
        noteDirtyRef.current = true;
      }

      broadcastSnapshot(snapshot);
    } catch (error) {
      setNoteSaveError(error instanceof Error ? error.message : "無法儲存筆記。");
    } finally {
      setNoteSaving(false);
      saveInFlightRef.current = false;

      if (conflictDetected) {
        return;
      }

      if (queuedSaveRef.current) {
        queuedSaveRef.current = false;
        void flushNote();
      } else if (noteDirtyRef.current && noteTextRef.current !== lastPersistedTextRef.current) {
        void flushNote();
      }
    }
  });

  useEffect(() => {
    if (!bootstrappedRef.current) {
      return;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    if (!noteDirty || noteText === lastPersistedTextRef.current) {
      return;
    }

    saveTimerRef.current = window.setTimeout(() => {
      void flushNote();
    }, NOTE_SAVE_DELAY_MS);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [flushNote, noteDirty, noteText]);

  useEffect(() => {
    const flushOnLeave = () => {
      if (!noteDirtyRef.current || !bootstrappedRef.current) {
        return;
      }

      void fetch("/api/note", {
        ...FETCH_INIT,
        method: "PUT",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        },
        body: JSON.stringify({
          text: noteTextRef.current,
          baseRevision: noteRevisionRef.current
        })
      });
    };

    window.addEventListener("pagehide", flushOnLeave);

    return () => {
      window.removeEventListener("pagehide", flushOnLeave);
    };
  }, []);

  const runTodoMutation = useEvent(
    async ({
      endpoint,
      method,
      body,
      busyId
    }: {
      endpoint: string;
      method: "POST" | "PATCH" | "DELETE";
      body?: unknown;
      busyId?: string;
    }) => {
      setTodoError(null);

      if (busyId) {
        setBusyTodoId(busyId);
      }

      try {
        const snapshot = await requestJson<NotebookState>(endpoint, {
          method,
          body: body ? JSON.stringify(body) : undefined
        });

        applyIncomingSnapshot(snapshot, {
          replaceNote: false,
          markBootstrapped: true
        });
        broadcastSnapshot(snapshot);
      } catch (error) {
        setTodoError(error instanceof Error ? error.message : "待辦操作失敗。");
        throw error;
      } finally {
        if (busyId) {
          setBusyTodoId(null);
        }
      }
    }
  );

  const onNoteChange = (value: string) => {
    setNoteText(value);
    noteTextRef.current = value;
    setNoteDirty(true);
    noteDirtyRef.current = true;
    setNoteSaveError(null);
  };

  const onAddTodo = async () => {
    const title = newTodoTitle.trim();
    const parsedPrice = parsePriceInput(newTodoPrice);

    if (!title) {
      setNewTodoError("請先輸入待辦內容。");
      return;
    }

    if (parsedPrice.cents === null) {
      setNewTodoError(parsedPrice.error ?? "價格格式不正確。");
      return;
    }

    setCreatingTodo(true);
    setNewTodoError(null);

    try {
      await runTodoMutation({
        endpoint: "/api/todos",
        method: "POST",
        body: {
          title,
          priceCents: parsedPrice.cents
        }
      });

      setNewTodoTitle("");
      setNewTodoPrice("");
    } finally {
      setCreatingTodo(false);
    }
  };

  const onTodoInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void onAddTodo();
    }
  };

  const onToggleTodo = async (todo: TodoItem) => {
    await runTodoMutation({
      endpoint: `/api/todos/${todo.id}`,
      method: "PATCH",
      body: {
        completed: !todo.completed
      },
      busyId: todo.id
    });
  };

  const onOpenEditTodo = (todo: TodoItem) => {
    setEditTodo({
      id: todo.id,
      title: todo.title,
      price: todo.priceCents === 0 ? "" : String(todo.priceCents / 100)
    });
    setEditTodoError(null);
  };

  const onSaveEditTodo = async () => {
    if (!editTodo) {
      return;
    }

    const title = editTodo.title.trim();
    const parsedPrice = parsePriceInput(editTodo.price);

    if (!title) {
      setEditTodoError("待辦內容不能留白。");
      return;
    }

    if (parsedPrice.cents === null) {
      setEditTodoError(parsedPrice.error ?? "價格格式不正確。");
      return;
    }

    await runTodoMutation({
      endpoint: `/api/todos/${editTodo.id}`,
      method: "PATCH",
      body: {
        title,
        priceCents: parsedPrice.cents
      },
      busyId: editTodo.id
    });

    setEditTodo(null);
  };

  const onConfirmDeleteTodo = async () => {
    if (!deleteTodoItem) {
      return;
    }

    await runTodoMutation({
      endpoint: `/api/todos/${deleteTodoItem.id}`,
      method: "DELETE",
      busyId: deleteTodoItem.id
    });

    setDeleteTodoItem(null);
  };

  const onKeepServerNote = () => {
    if (!noteConflict) {
      return;
    }

    applyIncomingSnapshot(noteConflict.serverState, {
      replaceNote: true,
      markBootstrapped: true
    });
    setNoteConflict(null);
  };

  const onOverwriteWithLocalNote = async () => {
    if (!noteConflict) {
      return;
    }

    setNoteConflict(null);
    setNoteText(noteConflict.localText);
    noteTextRef.current = noteConflict.localText;
    setNoteDirty(true);
    noteDirtyRef.current = true;

    await flushNote(true, noteConflict.serverState.noteRevision);
  };

  const totalCents = todos.reduce((sum, item) => sum + item.priceCents, 0);
  const activeCents = todos.reduce((sum, item) => (item.completed ? sum : sum + item.priceCents), 0);

  const syncStatus = noteSaveError
    ? "儲存失敗"
    : noteSaving
      ? "儲存中..."
      : noteDirty
        ? "準備同步"
        : formatSyncLabel(updatedAt);

  return (
    <main className={styles.pageShell}>
      <div className={styles.workspaceCard}>
        <header className={styles.topBar}>
          <div className={styles.brandBlock}>
            <div className={styles.brandEyebrow}>Solo Notebook</div>
            <div className={styles.brandTitleRow}>
              <h1>單獨的筆記本</h1>
              <span className={styles.syncBadge} data-state={noteSaveError ? "error" : noteSaving ? "saving" : "idle"}>
                {noteSaveError ? <CloudAlert size={15} /> : noteSaving ? <LoaderCircle size={15} /> : <CloudCheck size={15} />}
                <span>{syncStatus}</span>
              </span>
            </div>
          </div>

          <div className={styles.modeSwitch} role="tablist" aria-label="切換模式">
            <button
              type="button"
              className={styles.modeButton}
              data-active={mode === "note"}
              onClick={() => setMode("note")}
            >
              <FileText size={16} />
              <span>筆記</span>
            </button>
            <button
              type="button"
              className={styles.modeButton}
              data-active={mode === "todo"}
              onClick={() => setMode("todo")}
            >
              <ListTodo size={16} />
              <span>To-Do List</span>
            </button>
          </div>
        </header>

        {bootError ? (
          <section className={styles.setupState}>
            <div className={styles.setupCard}>
              <p className={styles.setupEyebrow}>無法啟動工作區</p>
              <h2>需要先完成資料庫連線設定</h2>
              <p>{bootError}</p>
              <button type="button" className={styles.secondaryButton} onClick={() => void fetchLatestState("bootstrap")}>
                <RefreshCw size={16} />
                <span>重新嘗試</span>
              </button>
            </div>
          </section>
        ) : loadingState ? (
          <section className={styles.loadingState}>
            <div className={styles.loadingCard}>
              <LoaderCircle size={22} className={styles.spinningIcon} />
              <div>
                <h2>正在連線你的筆記本</h2>
                <p>雲端資料同步中，幾秒內就會完成。</p>
              </div>
            </div>
          </section>
        ) : (
          <section className={styles.contentArea}>
            {mode === "note" ? (
              <div className={styles.notePanel}>
                <div className={styles.panelMeta}>
                  <div>
                    <h2>筆記</h2>
                    <p>直接輸入即可，自動儲存並同步到其他視窗與裝置。</p>
                  </div>
                  <span className={styles.metaText}>
                    {refreshingState ? "同步更新中..." : `${noteText.length.toLocaleString("zh-TW")} 字`}
                  </span>
                </div>

                <div className={styles.noteSurface}>
                  <textarea
                    className={styles.noteEditor}
                    value={noteText}
                    onChange={(event) => onNoteChange(event.target.value)}
                    placeholder="在這裡開始寫你的長篇筆記。想法、草稿、清單、會議紀錄，都可以直接往下寫。"
                    spellCheck={false}
                  />
                </div>

                {noteSaveError ? <p className={styles.inlineError}>{noteSaveError}</p> : null}
              </div>
            ) : (
              <div className={styles.todoPanel}>
                <div className={styles.summaryGrid}>
                  <article className={styles.summaryCard}>
                    <span>總金額</span>
                    <strong>{formatCurrency(totalCents)}</strong>
                  </article>
                  <article className={styles.summaryCard}>
                    <span>未勾選金額</span>
                    <strong>{formatCurrency(activeCents)}</strong>
                  </article>
                </div>

                <div className={styles.addCard}>
                  <div className={styles.panelMeta}>
                    <div>
                      <h2>To-Do List</h2>
                      <p>最新項目會排在最上面，勾選、編輯、刪除都會即時同步。</p>
                    </div>
                    <span className={styles.metaText}>{todos.length} 筆</span>
                  </div>

                  <div className={styles.addGrid}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel} id={titleInputId}>
                        項目內容
                      </span>
                      <input
                        aria-labelledby={titleInputId}
                        className={styles.input}
                        value={newTodoTitle}
                        onChange={(event) => setNewTodoTitle(event.target.value)}
                        onKeyDown={onTodoInputKeyDown}
                        placeholder="例如：咖啡豆、文具、訂閱費"
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel} id={priceInputId}>
                        價格
                      </span>
                      <input
                        aria-labelledby={priceInputId}
                        className={styles.input}
                        value={newTodoPrice}
                        onChange={(event) => setNewTodoPrice(event.target.value)}
                        onKeyDown={onTodoInputKeyDown}
                        inputMode="decimal"
                        placeholder="0"
                      />
                    </label>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => void onAddTodo()}
                      disabled={creatingTodo}
                    >
                      {creatingTodo ? <LoaderCircle size={16} className={styles.spinningIcon} /> : <Plus size={16} />}
                      <span>新增</span>
                    </button>
                  </div>

                  {newTodoError ? <p className={styles.inlineError}>{newTodoError}</p> : null}
                  {todoError ? <p className={styles.inlineError}>{todoError}</p> : null}
                </div>

                <div className={styles.listCard}>
                  {todos.length === 0 ? (
                    <div className={styles.emptyState}>
                      <ListTodo size={20} />
                      <div>
                        <h3>待辦清單還是空的</h3>
                        <p>先從上方輸入一筆項目與價格，之後就會一直保存在雲端。</p>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.todoList}>
                      {todos.map((todo) => (
                        <article
                          key={todo.id}
                          className={styles.todoRow}
                          data-completed={todo.completed}
                          data-busy={busyTodoId === todo.id}
                        >
                          <label className={styles.checkboxWrap}>
                            <input
                              type="checkbox"
                              className={styles.checkbox}
                              checked={todo.completed}
                              onChange={() => void onToggleTodo(todo)}
                              disabled={busyTodoId === todo.id}
                            />
                            <span className={styles.checkboxVisual} />
                          </label>

                          <div className={styles.todoContent}>
                            <span className={styles.todoTitle}>{todo.title}</span>
                            <span className={styles.todoMetaMobile}>{formatCurrency(todo.priceCents)}</span>
                          </div>

                          <span className={styles.todoPrice}>{formatCurrency(todo.priceCents)}</span>

                          <button
                            type="button"
                            className={styles.iconButton}
                            onClick={() => onOpenEditTodo(todo)}
                            aria-label={`編輯 ${todo.title}`}
                          >
                            <PencilLine size={16} />
                          </button>

                          <button
                            type="button"
                            className={styles.iconButton}
                            onClick={() => setDeleteTodoItem(todo)}
                            aria-label={`刪除 ${todo.title}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {editTodo ? (
        <ModalShell
          title="編輯待辦"
          description="更新項目名稱與價格，儲存後會立刻同步。"
          onClose={() => setEditTodo(null)}
          actions={
            <>
              <button type="button" className={styles.ghostButton} onClick={() => setEditTodo(null)}>
                取消
              </button>
              <button type="button" className={styles.primaryButton} onClick={() => void onSaveEditTodo()}>
                儲存修改
              </button>
            </>
          }
        >
          <div className={styles.modalFieldStack}>
            <label className={styles.field}>
              <span className={styles.fieldLabel} id={editTitleId}>
                項目內容
              </span>
              <input
                aria-labelledby={editTitleId}
                className={styles.input}
                value={editTodo.title}
                onChange={(event) =>
                  setEditTodo((current) => (current ? { ...current, title: event.target.value } : current))
                }
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel} id={editPriceId}>
                價格
              </span>
              <input
                aria-labelledby={editPriceId}
                className={styles.input}
                inputMode="decimal"
                value={editTodo.price}
                onChange={(event) =>
                  setEditTodo((current) => (current ? { ...current, price: event.target.value } : current))
                }
              />
            </label>
            {editTodoError ? <p className={styles.inlineError}>{editTodoError}</p> : null}
          </div>
        </ModalShell>
      ) : null}

      {deleteTodoItem ? (
        <ModalShell
          title="刪除此項目？"
          description="刪除後會立刻同步到其他視窗與裝置。"
          onClose={() => setDeleteTodoItem(null)}
          actions={
            <>
              <button type="button" className={styles.ghostButton} onClick={() => setDeleteTodoItem(null)}>
                取消
              </button>
              <button type="button" className={styles.dangerButton} onClick={() => void onConfirmDeleteTodo()}>
                刪除
              </button>
            </>
          }
        >
          <div className={styles.confirmCard}>
            <strong>{deleteTodoItem.title}</strong>
            <span>{formatCurrency(deleteTodoItem.priceCents)}</span>
          </div>
        </ModalShell>
      ) : null}

      {noteConflict ? (
        <ModalShell
          title="偵測到同步衝突"
          description="另一個視窗或裝置已經先更新筆記。請選擇要保留哪一份內容。"
          onClose={() => setNoteConflict(null)}
          actions={
            <>
              <button type="button" className={styles.ghostButton} onClick={onKeepServerNote}>
                使用雲端版本
              </button>
              <button type="button" className={styles.primaryButton} onClick={() => void onOverwriteWithLocalNote()}>
                用我的內容覆蓋
              </button>
            </>
          }
        >
          <div className={styles.conflictGrid}>
            <section className={styles.conflictPane}>
              <span className={styles.conflictLabel}>雲端版本</span>
              <pre>{noteConflict.serverState.noteText || "目前是空白筆記"}</pre>
            </section>
            <section className={styles.conflictPane}>
              <span className={styles.conflictLabel}>目前這個視窗的內容</span>
              <pre>{noteConflict.localText || "目前是空白筆記"}</pre>
            </section>
          </div>
        </ModalShell>
      ) : null}
    </main>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { supabase } from "./supabaseClient";

const STORAGE_KEY = "todo.tasks.v1";
const FILTER_KEY = "todo.filter.v1";
const FILTERS = {
  all: "all",
  active: "active",
  done: "done",
};

export default function App() {
  const isSupabaseReady = Boolean(supabase);

  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [authError, setAuthError] = useState("");
  const [remoteError, setRemoteError] = useState("");
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [session, setSession] = useState(null);

  const [tasks, setTasks] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore storage errors and fall back to defaults
    }
    return [
      { id: 1, title: "Сделать первый вайб-проект 😎", done: false },
      { id: 2, title: "Добавить задачу", done: false },
    ];
  });

  const [filter, setFilter] = useState(() => {
    try {
      const raw = localStorage.getItem(FILTER_KEY);
      if (raw && FILTERS[raw]) return raw;
    } catch {
      // ignore storage errors and fall back to defaults
    }
    return FILTERS.all;
  });

  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");

  const user = session?.user ?? null;
  const prevUserIdRef = useRef(null);

  useEffect(() => {
    if (!isSupabaseReady) return;

    let isActive = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isActive) return;
      if (error) {
        setAuthError(error.message);
        return;
      }
      setSession(data.session);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      isActive = false;
      data.subscription.unsubscribe();
    };
  }, [isSupabaseReady]);

  useEffect(() => {
    // localStorage is a fallback when the user is not logged in.
    if (user) return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      // ignore storage errors
    }
  }, [tasks, user]);

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, filter);
    } catch {
      // ignore storage errors
    }
  }, [filter]);

  useEffect(() => {
    if (!isSupabaseReady) return;

    const prevUserId = prevUserIdRef.current;
    const nextUserId = user?.id ?? null;
    prevUserIdRef.current = nextUserId;

    // Logout: restore local tasks.
    if (prevUserId && !nextUserId) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) setTasks(JSON.parse(raw));
      } catch {
        // ignore storage errors
      }
      setRemoteError("");
      setRemoteLoading(false);
      return;
    }

    if (!nextUserId) return;

    (async () => {
      setRemoteError("");
      setRemoteLoading(true);
      try {
        // Prefer created_at ordering, but keep a fallback for simpler schemas.
        let res = await supabase
          .from("tasks")
          .select("id,title,done,user_id,created_at")
          .eq("user_id", nextUserId)
          .order("created_at", { ascending: false });

        if (res.error && /created_at/i.test(res.error.message)) {
          res = await supabase
            .from("tasks")
            .select("id,title,done,user_id")
            .eq("user_id", nextUserId)
            .order("id", { ascending: false });
        }

        if (res.error) throw res.error;
        setTasks((res.data ?? []).map((t) => ({ id: t.id, title: t.title, done: !!t.done })));
        setEditingId(null);
        setEditingText("");
      } catch (e) {
        setRemoteError(e?.message || "Не удалось загрузить задачи из Supabase.");
      } finally {
        setRemoteLoading(false);
      }
    })();
  }, [isSupabaseReady, user?.id]);

  const doneCount = useMemo(() => tasks.filter((t) => t.done).length, [tasks]);
  const hasCompleted = doneCount > 0;

  const filteredTasks = useMemo(() => {
    if (filter === FILTERS.active) return tasks.filter((t) => !t.done);
    if (filter === FILTERS.done) return tasks.filter((t) => t.done);
    return tasks;
  }, [filter, tasks]);

  const emptyMessages = {
    [FILTERS.all]: "Пока задач нет. Добавь первую 🙂",
    [FILTERS.active]: "Активных задач нет. Можно выдохнуть 🙂",
    [FILTERS.done]: "Выполненных задач пока нет.",
  };

  async function addTask() {
    const title = text.trim();
    if (!title) return;

    if (isSupabaseReady && user) {
      setRemoteError("");
      const { data, error } = await supabase
        .from("tasks")
        .insert({ title, done: false, user_id: user.id })
        .select("id,title,done")
        .single();

      if (error) {
        setRemoteError(error.message);
        return;
      }

      setTasks((prev) => [{ id: data.id, title: data.title, done: !!data.done }, ...prev]);
      setText("");
      return;
    }

    const newTask = { id: Date.now(), title, done: false };
    setTasks((prev) => [newTask, ...prev]);
    setText("");
  }

  async function toggleTask(id) {
    const current = tasks.find((t) => t.id === id);
    if (!current) return;

    const nextDone = !current.done;

    if (isSupabaseReady && user) {
      setRemoteError("");
      const prevTasks = tasks;
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: nextDone } : t)));

      const { error } = await supabase
        .from("tasks")
        .update({ done: nextDone })
        .eq("id", id)
        .eq("user_id", user.id);

      if (error) {
        setTasks(prevTasks);
        setRemoteError(error.message);
      }
      return;
    }

    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: nextDone } : t)));
  }

  async function removeTask(id) {
    if (isSupabaseReady && user) {
      setRemoteError("");
      const prevTasks = tasks;
      setTasks((prev) => prev.filter((t) => t.id !== id));

      const { error } = await supabase.from("tasks").delete().eq("id", id).eq("user_id", user.id);
      if (error) {
        setTasks(prevTasks);
        setRemoteError(error.message);
      }
      return;
    }

    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  async function clearCompleted() {
    if (isSupabaseReady && user) {
      setRemoteError("");
      const prevTasks = tasks;
      setTasks((prev) => prev.filter((t) => !t.done));

      const { error } = await supabase.from("tasks").delete().eq("user_id", user.id).eq("done", true);
      if (error) {
        setTasks(prevTasks);
        setRemoteError(error.message);
      }
      return;
    }

    setTasks((prev) => prev.filter((t) => !t.done));
  }

  function startEditing(task) {
    setEditingId(task.id);
    setEditingText(task.title);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditingText("");
  }

  async function saveEditing(id) {
    const title = editingText.trim();
    if (!title) {
      cancelEditing();
      return;
    }

    if (isSupabaseReady && user) {
      setRemoteError("");
      const prevTasks = tasks;
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
      cancelEditing();

      const { error } = await supabase
        .from("tasks")
        .update({ title })
        .eq("id", id)
        .eq("user_id", user.id);

      if (error) {
        setTasks(prevTasks);
        setRemoteError(error.message);
      }
      return;
    }

    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
    cancelEditing();
  }

  async function sendMagicLink() {
    if (!isSupabaseReady) return;
    const trimmed = email.trim();
    if (!trimmed) return;

    setAuthError("");
    setAuthInfo("");

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: `${window.location.origin}/todo-vibecode/` },
    });

    if (error) {
      setAuthError(error.message);
      return;
    }

    setAuthInfo("Письмо отправлено. Открой magic link в почте, чтобы войти.");
  }

  async function signOut() {
    if (!isSupabaseReady) return;
    setAuthError("");
    setAuthInfo("");
    const { error } = await supabase.auth.signOut();
    if (error) setAuthError(error.message);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "linear-gradient(160deg, #0f1115 0%, #181b21 60%, #111318 100%)",
        color: "#e7eaf0",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "rgba(20,22,27,0.9)",
          borderRadius: 18,
          padding: 20,
          boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
          border: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(6px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, letterSpacing: 0.2 }}>ToDo — вайбкодинг ✨</h1>
            <p style={{ marginTop: 6, color: "#9aa3b2", fontSize: 13 }}>
              Добавляй задачи, отмечай выполненное, удаляй — всё в реальном времени.
            </p>
          </div>
          <div style={{ fontSize: 12, color: "#9aa3b2", whiteSpace: "nowrap" }}>
            Сделано: <b style={{ color: "#e7eaf0" }}>{doneCount}</b> / <b>{tasks.length}</b>
          </div>
        </div>

        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            background: "#0f1115",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {!isSupabaseReady ? (
            <div style={{ fontSize: 12, color: "#8b96a8" }}>
              Supabase не настроен. Добавь <code style={{ color: "#cfd6e3" }}>VITE_SUPABASE_URL</code> и{" "}
              <code style={{ color: "#cfd6e3" }}>VITE_SUPABASE_ANON_KEY</code> в <code style={{ color: "#cfd6e3" }}>.env</code>, и
              перезапусти dev-сервер.
            </div>
          ) : user ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, color: "#8b96a8" }}>
                Вход: <span style={{ color: "#e7eaf0" }}>{user.email}</span>
              </div>
              <button
                onClick={signOut}
                style={{
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "transparent",
                  color: "#cfd6e3",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Выйти
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMagicLink()}
                placeholder="email для magic link"
                style={{
                  flex: 1,
                  minWidth: 220,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "#141922",
                  color: "#e7eaf0",
                  outline: "none",
                  fontSize: 13,
                }}
              />
              <button
                onClick={sendMagicLink}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "#141922",
                  color: "#e7eaf0",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                Войти (OTP)
              </button>
              <div style={{ width: "100%" }}>
                {authError ? <div style={{ marginTop: 8, fontSize: 12, color: "#ffb4b4" }}>{authError}</div> : null}
                {authInfo ? <div style={{ marginTop: 8, fontSize: 12, color: "#8b96a8" }}>{authInfo}</div> : null}
                <div style={{ marginTop: 8, fontSize: 12, color: "#667386" }}>
                  До логина задачи хранятся локально. После логина — в Supabase.
                </div>
              </div>
            </div>
          )}

          {remoteError ? <div style={{ marginTop: 10, fontSize: 12, color: "#ffb4b4" }}>{remoteError}</div> : null}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            placeholder="Например: выучить React за 10 минут"
            style={{
              flex: 1,
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "#0f1115",
              color: "#e7eaf0",
              outline: "none",
              fontSize: 14,
            }}
          />
          <button
            onClick={addTask}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "linear-gradient(140deg, #2a3440, #1b222c)",
              color: "#e7eaf0",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            ➕
          </button>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { key: FILTERS.all, label: "Все" },
              { key: FILTERS.active, label: "Активные" },
              { key: FILTERS.done, label: "Выполненные" },
            ].map((item) => {
              const isActive = filter === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setFilter(item.key)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: isActive ? "#1b2330" : "transparent",
                    color: isActive ? "#e7eaf0" : "#8b96a8",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: isActive ? 700 : 500,
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <button
            onClick={clearCompleted}
            disabled={!hasCompleted}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.08)",
              background: hasCompleted ? "#141922" : "transparent",
              color: hasCompleted ? "#cfd6e3" : "#5f6b7a",
              cursor: hasCompleted ? "pointer" : "not-allowed",
              fontSize: 12,
            }}
          >
            Очистить выполненные
          </button>
        </div>

        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          {remoteLoading ? (
            <div style={{ padding: 14, borderRadius: 12, background: "#141922", color: "#8f98a8" }}>
              Загружаю задачи из Supabase…
            </div>
          ) : null}

          {filteredTasks.length === 0 ? (
            <div style={{ padding: 14, borderRadius: 12, background: "#141922", color: "#8f98a8" }}>
              {emptyMessages[filter]}
            </div>
          ) : (
            filteredTasks.map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 12,
                  borderRadius: 12,
                  background: t.done ? "rgba(20,25,34,0.6)" : "#141922",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={() => toggleTask(t.id)}
                  style={{ width: 18, height: 18 }}
                />

                {editingId === t.id ? (
                  <input
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditing(t.id);
                      if (e.key === "Escape") cancelEditing();
                    }}
                    onBlur={() => saveEditing(t.id)}
                    autoFocus
                    style={{
                      flex: 1,
                      fontSize: 15,
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "#0f1115",
                      color: "#e7eaf0",
                      outline: "none",
                    }}
                  />
                ) : (
                  <div
                    onClick={() => startEditing(t)}
                    style={{
                      flex: 1,
                      fontSize: 15,
                      textDecoration: t.done ? "line-through" : "none",
                      opacity: t.done ? 0.6 : 1,
                      color: t.done ? "#98a1b2" : "#e7eaf0",
                      cursor: "text",
                    }}
                  >
                    {t.title}
                  </div>
                )}

                <button
                  onClick={() => removeTask(t.id)}
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: 18,
                    color: "#9aa3b2",
                  }}
                  title="Удалить"
                >
                  🗑️
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

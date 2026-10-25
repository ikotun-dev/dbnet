"use client";
import { useEffect, useRef, useState } from "react";
import { parseConnectionURL } from "../lib/connection-url.mjs";
import {
  Database,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Table2,
  Code2,
  Play,
  X,
  Clock3,
  PanelRight,
  RefreshCw,
  ArrowDownToLine,
  Check,
  ArrowUpRight,
  ShieldCheck,
  Sun,
  Moon,
  Filter,
  ArrowUp,
  ArrowDown,
  KeyRound,
  Plug,
  PanelLeft,
  Trash2,
} from "lucide-react";
type Profile = {
  id: string;
  name: string;
  driver: string;
  host: string;
  port: string;
  user: string;
  database: string;
  tls: boolean;
  tlsMode?: string;
  caCert?: string;
  password?: string;
  color?: string;
};
type Result = {
  columns: string[];
  rows: (string | null)[][];
  duration: number;
  truncated: boolean;
  message: string;
  structure?: (string | null)[][];
  primaryKeys?: string[];
  hasNext?: boolean;
  offset?: number;
};
type Doc = {
  id: string;
  name: string;
  kind: "table" | "sql";
  sql: string;
  schema?: string;
  offset: number;
  limit: number;
  sort: string;
  desc: boolean;
  filterColumn: string;
  filterValue: string;
  trail: number[];
  mode: "data" | "structure";
};
type Workspace = {
  id: string;
  profile: Profile;
  session: string;
  tables: string[][];
  tabs: Doc[];
  active: string;
  results: Record<string, Result>;
  errors: Record<string, string>;
};
const blank: Profile = {
  id: "",
  name: "",
  driver: "postgres",
  host: "localhost",
  port: "5432",
  user: "postgres",
  database: "postgres",
  tls: false,
  password: "",
  color: "#007aff",
};
const defaults = {
  offset: 0,
  limit: 100,
  sort: "",
  desc: false,
  filterColumn: "",
  filterValue: "",
  trail: [] as number[],
  mode: "data" as const,
};
const passwordStorageKey = "dbnet-connection-passwords";
const connectionColors = [
  { name: "Blue", value: "#007aff" },
  { name: "Purple", value: "#af52de" },
  { name: "Pink", value: "#ff2d55" },
  { name: "Red", value: "#ff3b30" },
  { name: "Orange", value: "#ff9500" },
  { name: "Yellow", value: "#ffcc00" },
  { name: "Green", value: "#34c759" },
  { name: "Graphite", value: "#8e8e93" },
];
function profileColor(profile: Profile) {
  return profile.color || (profile.driver === "postgres" ? "#478dc7" : "#d2a15a");
}
function storedPasswords(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(passwordStorageKey) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}
function rememberProfilePassword(id: string, password: string, remember: boolean) {
  if (!id) return;
  try {
    const passwords = storedPasswords();
    if (remember && password) passwords[id] = password;
    else delete passwords[id];
    if (Object.keys(passwords).length)
      localStorage.setItem(passwordStorageKey, JSON.stringify(passwords));
    else localStorage.removeItem(passwordStorageKey);
  } catch {
    // Private browsing or browser policy can make local storage unavailable.
  }
}
async function api(path: string, body?: unknown, method = "POST") {
  const response = await fetch(
    "/api/" + path,
    body === undefined
      ? {}
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Request failed");
  return data;
}
export default function Home() {
  const [profiles, setProfiles] = useState<Profile[]>([]),
    [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [selected, setSelected] = useState("");
  const [modal, setModal] = useState(false),
    [form, setForm] = useState<Profile>(blank),
    [rememberPassword, setRememberPassword] = useState(true),
    [confirmDelete, setConfirmDelete] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [connectionURL, setConnectionURL] = useState("");
  const [filter, setFilter] = useState(""),
    [section, setSection] = useState("tables"),
    [history, setHistory] = useState<
      { sql: string; name: string; at: string }[]
    >([]);
  const [theme, setTheme] = useState("light"),
    [inspect, setInspect] = useState(false),
    [picked, setPicked] = useState<(string | null)[] | null>(null),
    [sidebar, setSidebar] = useState(true),
    [filtersVisible, setFiltersVisible] = useState(false);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const sequences = useRef<Record<string, number>>({}),
    editor = useRef<HTMLTextAreaElement>(null);
  const ws = workspaces.find((w) => w.id === selected),
    tab = ws?.tabs.find((t) => t.id === ws.active),
    result = tab && ws?.results[tab.id],
    error = tab && ws?.errors[tab.id];
  const tableView = tab?.kind === "table",
    structure = tableView && tab.mode === "structure",
    working = !!(tab && loading[tab.id]);
  const displayColumns = structure
      ? ["Column", "Type", "Nullable", "Default"]
      : result?.columns || [],
    displayRows = structure ? result?.structure || [] : result?.rows || [];
  useEffect(() => {
    api("connections")
      .then(setProfiles)
      .catch((e) => setNotice(e.message));
    try {
      setHistory(JSON.parse(localStorage.getItem("dbnet-history") || "[]"));
      setTheme(
        localStorage.getItem("dbnet-theme") === "dark" ? "dark" : "light",
      );
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (!modal) setConnectionURL("");
  }, [modal]);
  useEffect(() => {
    setPicked(null);
  }, [selected, ws?.active, tab?.mode, result]);
  function toggleTheme() {
    const value = theme === "dark" ? "light" : "dark";
    setTheme(value);
    try {
      localStorage.setItem("dbnet-theme", value);
    } catch {}
  }
  function update(id: string, fn: (w: Workspace) => Workspace) {
    setWorkspaces((all) => all.map((w) => (w.id === id ? fn(w) : w)));
  }
  function patchDoc(changes: Partial<Doc>) {
    if (ws && tab)
      update(ws.id, (w) => ({
        ...w,
        tabs: w.tabs.map((t) => (t.id === tab.id ? { ...t, ...changes } : t)),
      }));
  }
  function importConnectionURL() {
    try {
      setForm({ ...parseConnectionURL(connectionURL), color: "#007aff" });
      setRememberPassword(true);
      setConnectionURL("");
      setNotice(
        "Link imported. Review the connection and TLS mode, then connect.",
      );
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  function openConnection(profile = blank) {
    const password = profile.id ? storedPasswords()[profile.id] || "" : "";
    setForm({ ...profile, password, color: profileColor(profile) });
    setRememberPassword(true);
    setConfirmDelete(false);
    setNotice("");
    setModal(true);
  }
  async function loadPage(w: Workspace, t: Doc) {
    const seq = (sequences.current[t.id] || 0) + 1;
    sequences.current[t.id] = seq;
    setLoading((v) => ({ ...v, [t.id]: true }));
    update(w.id, (a) => ({ ...a, errors: { ...a.errors, [t.id]: "" } }));
    try {
      const data: Result = await api("browse", {
        session: w.session,
        schema: t.schema,
        table: t.name,
        offset: t.offset,
        limit: t.limit,
        sort: t.sort,
        desc: t.desc,
        filterColumn: t.filterColumn,
        filterValue: t.filterValue,
      });
      if (sequences.current[t.id] === seq)
        update(w.id, (a) => ({
          ...a,
          results: { ...a.results, [t.id]: data },
        }));
    } catch (e) {
      if (sequences.current[t.id] === seq)
        update(w.id, (a) => ({
          ...a,
          errors: { ...a.errors, [t.id]: (e as Error).message },
        }));
    } finally {
      if (sequences.current[t.id] === seq)
        setLoading((v) => ({ ...v, [t.id]: false }));
    }
  }
  function openTable(row: string[], target = ws) {
    if (!target) return;
    setPicked(null);
    setFiltersVisible(false);
    const existing = target.tabs.find(
      (t) => t.kind === "table" && t.schema === row[0] && t.name === row[1],
    );
    if (existing) {
      update(target.id, (w) => ({ ...w, active: existing.id }));
      return;
    }
    const t: Doc = {
      ...defaults,
      id: crypto.randomUUID(),
      name: row[1],
      schema: row[0],
      kind: "table",
      sql: "",
    };
    update(target.id, (w) => ({ ...w, tabs: [...w.tabs, t], active: t.id }));
    loadPage(target, t);
  }
  function changePage(changes: Partial<Doc>) {
    if (!ws || !tab) return;
    patchDoc(changes);
    loadPage(ws, { ...tab, ...changes });
  }
  async function connect() {
    setBusy(true);
    setNotice("");
    try {
      const { session } = await api("connect", form);
      let profile: Profile = { ...form, password: undefined };
      if (!profile.id) {
        try {
          profile = await api("connections", form);
          setProfiles((p) => [...p, profile]);
        } catch {
          setNotice("Connected, but the profile could not be saved.");
        }
      }
      rememberProfilePassword(
        profile.id,
        form.password || "",
        rememberPassword,
      );
      const w: Workspace = {
        id: crypto.randomUUID(),
        profile,
        session,
        tables: [],
        tabs: [],
        active: "",
        results: {},
        errors: {},
      };
      setWorkspaces((all) => [...all, w]);
      setSelected(w.id);
      setModal(false);
      setSection("tables");
      setFilter("");
      try {
        const data = await api("tables", { session });
        update(w.id, (a) => ({ ...a, tables: data.rows }));
        if (data.rows.length) openTable(data.rows[0], w);
      } catch (e) {
        setNotice((e as Error).message);
      }
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setNotice("");
    try {
      await api("test", form);
      setNotice("Connection successful.");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const updating = !!form.id;
      const p = await api(
        "connections",
        form,
        updating ? "PATCH" : "POST",
      );
      rememberProfilePassword(
        p.id,
        form.password || "",
        rememberPassword,
      );
      setProfiles((all) =>
        updating ? all.map((item) => (item.id === p.id ? p : item)) : [...all, p],
      );
      if (updating)
        setWorkspaces((all) =>
          all.map((w) =>
            w.profile.id === p.id ? { ...w, profile: p } : w,
          ),
        );
      setModal(false);
      setNotice(
        rememberPassword && form.password
          ? `Connection ${updating ? "updated" : "saved"}. Its password is remembered in this browser.`
          : `Connection ${updating ? "updated" : "saved"} without a password.`,
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteProfile() {
    if (!form.id || !confirmDelete) return;
    setBusy(true);
    try {
      await api("connections", { id: form.id }, "DELETE");
      rememberProfilePassword(form.id, "", false);
      setProfiles((all) => all.filter((p) => p.id !== form.id));
      setModal(false);
      setConfirmDelete(false);
      setNotice(`Deleted saved connection “${form.name}”.`);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function newTab(name?: string, sql?: string) {
    if (!ws) return;
    const t: Doc = {
      ...defaults,
      id: crypto.randomUUID(),
      name:
        name ||
        "SQL Query " + (ws.tabs.filter((t) => t.kind === "sql").length + 1),
      kind: "sql",
      sql: sql || "",
    };
    update(ws.id, (w) => ({ ...w, tabs: [...w.tabs, t], active: t.id }));
    setTimeout(() => editor.current?.focus(), 0);
  }
  async function run() {
    if (!ws || !tab || working || tab.kind !== "sql") return;
    const wid = ws.id,
      tid = tab.id,
      el = editor.current,
      text =
        el && el.selectionEnd > el.selectionStart
          ? el.value.slice(el.selectionStart, el.selectionEnd)
          : tab.sql;
    setLoading((v) => ({ ...v, [tid]: true }));
    update(wid, (w) => ({ ...w, errors: { ...w.errors, [tid]: "" } }));
    try {
      const data = await api("query", { session: ws.session, sql: text });
      update(wid, (w) =>
        w.tabs.some((t) => t.id === tid)
          ? { ...w, results: { ...w.results, [tid]: data } }
          : w,
      );
      setHistory((all) => {
        const h = [
          { sql: text, name: ws.profile.name, at: new Date().toISOString() },
          ...all,
        ].slice(0, 50);
        try {
          localStorage.setItem("dbnet-history", JSON.stringify(h));
        } catch {}
        return h;
      });
    } catch (e) {
      update(wid, (w) =>
        w.tabs.some((t) => t.id === tid)
          ? {
              ...w,
              errors: { ...w.errors, [tid]: (e as Error).message },
            }
          : w,
      );
    } finally {
      setLoading((v) => ({ ...v, [tid]: false }));
    }
  }
  function closeTab(t: Doc) {
    if (!ws) return;
    sequences.current[t.id] = (sequences.current[t.id] || 0) + 1;
    update(ws.id, (w) => {
      const tabs = w.tabs.filter((x) => x.id !== t.id),
        results = { ...w.results },
        errors = { ...w.errors };
      delete results[t.id];
      delete errors[t.id];
      return {
        ...w,
        tabs,
        results,
        errors,
        active: w.active === t.id ? tabs.at(-1)?.id || "" : w.active,
      };
    });
  }
  async function refresh() {
    if (!ws) return;
    if (tab?.kind === "table") {
      await loadPage(ws, tab);
      return;
    }
    try {
      const r = await api("tables", { session: ws.session });
      update(ws.id, (w) => ({ ...w, tables: r.rows }));
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function disconnect(w: Workspace) {
    try {
      await api("disconnect", { session: w.session });
      setWorkspaces((all) => all.filter((x) => x.id !== w.id));
      if (selected === w.id)
        setSelected(workspaces.find((x) => x.id !== w.id)?.id || "");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  function exportCSV() {
    if (!result) return;
    const cell = (v: string | null) =>
      '"' + (v ?? "").replaceAll('"', '""') + '"';
    const csv = [displayColumns, ...displayRows]
      .map((r) => r.map(cell).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = (tab?.name || "results") + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  const schemas = Array.from(new Set(ws?.tables.map((t) => t[0]) || []));
  return (
    <div className="app">
      <header className="app-titlebar">
        <div className="app-logo">
          <Database size={16} />
          <strong>DBNet</strong>
        </div>
        <span className="window-title">
          {ws
            ? ws.profile.name + " — " + ws.profile.database
            : "Database connections"}
        </span>
        <button
          className="icon"
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          title="Toggle appearance"
          onClick={toggleTheme}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </header>
      <div className="connection-tabs">
        {workspaces.map((w) => (
          <div
            className={
              w.id === selected ? "connection-tab active" : "connection-tab"
            }
            key={w.id}
          >
            <button onClick={() => setSelected(w.id)}>
              <span
                className="connection-color"
                style={{ backgroundColor: profileColor(w.profile) }}
              />
              {w.profile.name}
            </button>
            <button
              className="icon"
              aria-label={"Disconnect " + w.profile.name}
              onClick={() => disconnect(w)}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          className="new-connection"
          aria-label="New connection"
          title="New connection"
          onClick={() => openConnection()}
        >
          <Plus size={14} />
          {workspaces.length ? "" : "New connection"}
        </button>
        <span className="local-label">LOCAL WORKSPACE</span>
      </div>
      <div className="workspace-toolbar">
        <div className="toolbar-group">
          <button
            title="Toggle sidebar"
            aria-label="Toggle sidebar"
            className="icon"
            onClick={() => setSidebar(!sidebar)}
          >
            <PanelLeft size={17} />
          </button>
          <button onClick={() => openConnection()}>
            <Plug size={16} />
            <span>Connection</span>
          </button>
        </div>
        <div className="toolbar-group">
          <div className="database-label">
            <Database size={15} />
            <span>{ws?.profile.database || "Database"}</span>
          </div>
          <button
            disabled={!ws}
            onClick={() => newTab()}
            title="Open a SQL editor"
          >
            <Code2 size={17} />
            <span>SQL editor</span>
          </button>
        </div>
        <div className="toolbar-status">
          {ws ? (
            <>
              <span className="status-dot" />
              {ws.profile.host}
              <span className="driver-badge">
                {ws.profile.driver === "postgres" ? "PostgreSQL" : "MySQL"}
              </span>
            </>
          ) : (
            <span>No active connection</span>
          )}
        </div>
        <div className="toolbar-group toolbar-right">
          <button
            disabled={!ws || working}
            onClick={refresh}
            title="Reload data"
          >
            <RefreshCw size={16} />
            <span>Reload</span>
          </button>
          <button
            className={inspect ? "icon selected" : "icon"}
            aria-label="Toggle row inspector"
            onClick={() => setInspect(!inspect)}
          >
            <PanelRight size={17} />
          </button>
        </div>
      </div>
      <div className="workspace-body">
        {sidebar && (
          <aside className="sidebar">
            <div className="sidebar-segments">
              <button
                className={section === "tables" ? "active" : ""}
                onClick={() => setSection("tables")}
              >
                Items
              </button>
              <button
                className={section === "history" ? "active" : ""}
                onClick={() => setSection("history")}
              >
                History
              </button>
            </div>
            <label className="object-search">
              <Search size={13} />
              <input
                aria-label="Filter objects"
                placeholder={
                  section === "tables"
                    ? "Search database objects"
                    : "Search query history"
                }
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              {filter && (
                <button
                  className="icon"
                  aria-label="Clear search"
                  onClick={() => setFilter("")}
                >
                  <X size={11} />
                </button>
              )}
            </label>
            <div className="sidebar-content">
              {section === "tables" ? (
                ws ? (
                  <>
                    {schemas.map((schema) => (
                      <section className="schema-group" key={schema}>
                        <div className="schema-label">
                          <ChevronDown size={12} />
                          {schema}
                          <span>
                            {ws.tables.filter((t) => t[0] === schema).length}
                          </span>
                        </div>
                        {ws.tables
                          .filter(
                            (t) =>
                              t[0] === schema &&
                              t[1].toLowerCase().includes(filter.toLowerCase()),
                          )
                          .map((t) => (
                            <button
                              className={
                                "object-item " +
                                (tableView &&
                                tab.schema === t[0] &&
                                tab.name === t[1]
                                  ? "selected"
                                  : "")
                              }
                              key={t.join(".")}
                              title={t.join(".")}
                              onClick={() => openTable(t)}
                            >
                              <Table2 size={13} />
                              <span>{t[1]}</span>
                            </button>
                          ))}
                      </section>
                    ))}
                    {!ws.tables.length && (
                      <p className="sidebar-empty">
                        No tables found in this database.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="sidebar-empty">
                    Connect to a database to browse its tables.
                  </p>
                )
              ) : (
                <div className="history-list">
                  {history
                    .filter((h) =>
                      h.sql.toLowerCase().includes(filter.toLowerCase()),
                    )
                    .map((h, i) => (
                      <button
                        key={i}
                        disabled={!ws}
                        title={h.sql}
                        onClick={() => newTab("History query", h.sql)}
                      >
                        <Clock3 size={13} />
                        <span>
                          {h.sql}
                          <small>
                            {h.name} · {new Date(h.at).toLocaleTimeString()}
                          </small>
                        </span>
                      </button>
                    ))}
                  {!history.length && (
                    <p className="sidebar-empty">
                      Queries you run appear here.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="saved-profiles">
              <div className="sidebar-heading">
                Connections
                <button
                  className="icon"
                  title="New connection"
                  onClick={() => openConnection()}
                >
                  <Plus size={13} />
                </button>
              </div>
              {profiles.map((p) => (
                <button key={p.id} onClick={() => openConnection(p)}>
                  <span
                    className="connection-color"
                    style={{ backgroundColor: profileColor(p) }}
                  />
                  <span>{p.name}</span>
                  <ArrowUpRight size={11} />
                </button>
              ))}
              {!profiles.length && (
                <p className="sidebar-empty">No saved connections</p>
              )}
            </div>
            <div className="sidebar-bottom">
              <span>{ws?.tables.length || 0} tables</span>
              <button
                className="icon"
                aria-label="Refresh table list"
                disabled={!ws}
                onClick={async () => {
                  if (ws)
                    try {
                      const r = await api("tables", { session: ws.session });
                      update(ws.id, (w) => ({ ...w, tables: r.rows }));
                    } catch (e) {
                      setNotice((e as Error).message);
                    }
                }}
              >
                <RefreshCw size={12} />
              </button>
            </div>
          </aside>
        )}
        <main>
          {ws ? (
            <>
              <div className="document-tabs">
                {ws.tabs.map((t) => (
                  <div
                    key={t.id}
                    className={t.id === ws.active ? "active" : ""}
                  >
                    <button
                      onClick={() => {
                        update(ws.id, (w) => ({ ...w, active: t.id }));
                        setFiltersVisible(false);
                      }}
                    >
                      {t.kind === "table" ? (
                        <Table2 size={13} />
                      ) : (
                        <Code2 size={13} />
                      )}
                      <span>{t.name}</span>
                    </button>
                    <button
                      className="icon"
                      aria-label={"Close " + t.name}
                      onClick={() => closeTab(t)}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                <button
                  className="icon add-tab"
                  aria-label="Open SQL editor"
                  title="New SQL editor"
                  onClick={() => newTab()}
                >
                  <Plus size={15} />
                </button>
              </div>
              {tab ? (
                <>
                  <div className="content-header">
                    <div className="object-path">
                      {tableView ? <Table2 size={15} /> : <Code2 size={15} />}
                      <span>{ws.profile.database}</span>
                      <ChevronRight size={11} />
                      {tableView && (
                        <>
                          <span>{tab.schema}</span>
                          <ChevronRight size={11} />
                        </>
                      )}
                      <strong>{tab.name}</strong>
                    </div>
                    {tableView ? (
                      <div className="view-segments">
                        <button
                          className={tab.mode === "data" ? "active" : ""}
                          onClick={() => patchDoc({ mode: "data" })}
                        >
                          Data
                        </button>
                        <button
                          className={tab.mode === "structure" ? "active" : ""}
                          onClick={() => patchDoc({ mode: "structure" })}
                        >
                          Structure
                        </button>
                      </div>
                    ) : (
                      <span className="editor-dialect">
                        {ws.profile.driver === "postgres"
                          ? "PostgreSQL"
                          : "MySQL"}
                      </span>
                    )}
                  </div>
                  {tab.kind === "sql" && (
                    <>
                      <div className="editor-wrap">
                        <div className="line-numbers">
                          {tab.sql.split("\n").map((_, i) => (
                            <span key={i}>{i + 1}</span>
                          ))}
                        </div>
                        <textarea
                          ref={editor}
                          className="editor"
                          aria-label="SQL editor"
                          spellCheck={false}
                          placeholder="Write a SQL query…"
                          value={tab.sql}
                          onChange={(e) => patchDoc({ sql: e.target.value })}
                          onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                              e.preventDefault();
                              run();
                            }
                          }}
                        />
                      </div>
                      <div className="query-toolbar">
                        <span>
                          {working ? "Executing…" : "Run selection or all SQL"}
                        </span>
                        <span className="query-limit">
                          Preview: 1,000 rows / 4 MB
                        </span>
                        <button
                          className="primary small"
                          disabled={working || !tab.sql.trim()}
                          onClick={run}
                        >
                          <Play size={12} />
                          {working ? "Running…" : "Run query"}
                          <kbd>⌘ ↵</kbd>
                        </button>
                      </div>
                    </>
                  )}
                  <div className="data-toolbar">
                    <span className="data-heading">
                      {tableView
                        ? structure
                          ? "Table structure"
                          : "Table data"
                        : "Query results"}
                    </span>
                    {tableView && !structure && (
                      <button
                        className={filtersVisible ? "selected" : ""}
                        onClick={() => setFiltersVisible(!filtersVisible)}
                      >
                        <Filter size={13} />
                        Filter
                        {tab.filterValue && <span className="filter-dot" />}
                      </button>
                    )}
                    <span className="toolbar-spacer" />
                    {result && (
                      <span className="timing">{result.duration} ms</span>
                    )}
                    <button disabled={!result || working} onClick={exportCSV}>
                      <ArrowDownToLine size={13} />
                      {tableView ? "Export page" : "Export CSV"}
                    </button>
                  </div>
                  {tableView && !structure && filtersVisible && (
                    <form
                      className="filter-bar"
                      onSubmit={(e) => {
                        e.preventDefault();
                        changePage({ offset: 0, trail: [] });
                      }}
                    >
                      <select
                        aria-label="Filter column"
                        value={tab.filterColumn}
                        onChange={(e) =>
                          patchDoc({ filterColumn: e.target.value })
                        }
                      >
                        <option value="">Choose column</option>
                        {result?.columns.map((c, i) => (
                          <option key={i} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <span>contains</span>
                      <input
                        aria-label="Filter value"
                        placeholder="Filter value…"
                        value={tab.filterValue}
                        onChange={(e) =>
                          patchDoc({ filterValue: e.target.value })
                        }
                      />
                      <button
                        className="secondary"
                        disabled={working || !tab.filterColumn}
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          changePage({
                            filterColumn: "",
                            filterValue: "",
                            offset: 0,
                            trail: [],
                          })
                        }
                      >
                        Clear
                      </button>
                    </form>
                  )}
                  <div className="results-area" aria-busy={working}>
                    {error ? (
                      <div className="error-panel">
                        <strong>
                          Unable to load {tableView ? "table" : "query results"}
                        </strong>
                        <pre>{error}</pre>
                        <button
                          className="secondary"
                          onClick={() =>
                            tableView ? loadPage(ws, tab) : run()
                          }
                        >
                          Retry
                        </button>
                      </div>
                    ) : result ? (
                      <>
                        <div className="grid-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th className="row-number">#</th>
                                {displayColumns.map((c, i) => (
                                  <th
                                    key={i}
                                    aria-sort={
                                      tableView && !structure && tab.sort === c
                                        ? tab.desc
                                          ? "descending"
                                          : "ascending"
                                        : undefined
                                    }
                                  >
                                    <button
                                      disabled={
                                        !tableView || structure || working
                                      }
                                      onClick={() =>
                                        changePage({
                                          sort: c,
                                          desc:
                                            tab.sort === c ? !tab.desc : false,
                                          offset: 0,
                                          trail: [],
                                        })
                                      }
                                    >
                                      {!structure &&
                                        result.primaryKeys?.includes(c) && (
                                          <KeyRound size={10} />
                                        )}
                                      <span>{c}</span>
                                      {tableView &&
                                        !structure &&
                                        tab.sort === c &&
                                        (tab.desc ? (
                                          <ArrowDown size={11} />
                                        ) : (
                                          <ArrowUp size={11} />
                                        ))}
                                    </button>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {displayRows.map((r, i) => (
                                <tr
                                  key={i}
                                  className={picked === r ? "selected" : ""}
                                  onClick={() => setPicked(r)}
                                  onDoubleClick={() => {
                                    setPicked(r);
                                    setInspect(true);
                                  }}
                                >
                                  <td className="row-number">
                                    {(tableView && !structure
                                      ? result.offset || 0
                                      : 0) +
                                      i +
                                      1}
                                  </td>
                                  {r.map((v, j) => (
                                    <td key={j} title={v === null ? "NULL" : v}>
                                      {v === null ? (
                                        <em>NULL</em>
                                      ) : v === "" ? (
                                        <span className="empty-value">
                                          empty
                                        </span>
                                      ) : (
                                        v
                                      )}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {!displayRows.length && (
                            <div className="result-empty">
                              <Table2 size={25} />
                              <h3>
                                {tableView
                                  ? "No rows to display"
                                  : result.message || "Query complete"}
                              </h3>
                              <p>
                                {tab.filterValue
                                  ? "Try a different filter."
                                  : tableView
                                    ? "This table has no rows on this page."
                                    : "The statement returned no rows."}
                              </p>
                            </div>
                          )}
                        </div>
                        {inspect && (
                          <aside className="inspector">
                            <header>
                              <strong>
                                {structure ? "Column details" : "Row details"}
                              </strong>
                              <button
                                className="icon"
                                aria-label="Close inspector"
                                onClick={() => setInspect(false)}
                              >
                                <X size={13} />
                              </button>
                            </header>
                            {picked ? (
                              displayColumns.map((c, i) => (
                                <div className="inspector-field" key={i}>
                                  <label>{c}</label>
                                  <pre>{picked[i] ?? "NULL"}</pre>
                                </div>
                              ))
                            ) : (
                              <p>Select a row to inspect its values.</p>
                            )}
                          </aside>
                        )}
                      </>
                    ) : (
                      <div className="result-empty">
                        <Table2 size={25} />
                        <h3>{working ? "Loading table…" : "Query results"}</h3>
                        <p>
                          {working
                            ? "Fetching a page from your database."
                            : "Run SQL to display results here."}
                        </p>
                      </div>
                    )}
                    {working && result && (
                      <div className="loading-cover">
                        <RefreshCw size={16} className="spin" />
                        Loading…
                      </div>
                    )}
                  </div>
                  {tableView && !structure && (
                    <div className="pagination">
                      <span>
                        {result && result.rows.length
                          ? "Rows " +
                            ((result.offset || 0) + 1) +
                            "–" +
                            ((result.offset || 0) + result.rows.length)
                          : "0 rows"}
                        {result?.truncated && " · page limited by size"}
                      </span>
                      {result && !result.primaryKeys?.length && (
                        <span
                          className="order-note"
                          title="Without a primary key, ordering may change as data changes."
                        >
                          No primary key
                        </span>
                      )}
                      <div className="page-controls">
                        <label>
                          Rows per page
                          <select
                            aria-label="Rows per page"
                            value={tab.limit}
                            disabled={working}
                            onChange={(e) =>
                              changePage({
                                limit: Number(e.target.value),
                                offset: 0,
                                trail: [],
                              })
                            }
                          >
                            {[50, 100, 250, 500].map((n) => (
                              <option key={n}>{n}</option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="icon"
                          aria-label="Previous page"
                          disabled={working || !tab.trail.length}
                          onClick={() =>
                            changePage({
                              offset: tab.trail.at(-1) || 0,
                              trail: tab.trail.slice(0, -1),
                            })
                          }
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <span>Page {tab.trail.length + 1}</span>
                        <button
                          className="icon"
                          aria-label="Next page"
                          disabled={working || !!error || !result?.hasNext}
                          onClick={() =>
                            changePage({
                              offset: tab.offset + (result?.rows.length || 0),
                              trail: [...tab.trail, tab.offset],
                            })
                          }
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="workspace-empty">
                  <Table2 size={33} />
                  <h2>Select a table</h2>
                  <p>Click a table in the sidebar to browse its data.</p>
                  <button className="secondary" onClick={() => newTab()}>
                    <Code2 size={14} />
                    Open SQL editor
                  </button>
                </div>
              )}
              <footer className="statusbar">
                <span className="status-dot" />
                Connected
                <span className="status-muted">
                  {ws.profile.database} ·{" "}
                  {ws.profile.driver === "postgres" ? "PostgreSQL" : "MySQL"}
                </span>
                <span className="status-right">
                  {working
                    ? "Loading…"
                    : error
                      ? "Error"
                      : tableView
                        ? "Read-only table browser"
                        : "SQL workspace"}
                  <span>UTF-8</span>
                </span>
              </footer>
            </>
          ) : (
            <div className="connection-home">
              <div className="home-icon">
                <Database size={30} />
              </div>
              <h1>Database connections</h1>
              <p>Open a connection to browse tables and work with your data.</p>
              <div className="connection-cards">
                {profiles.map((p) => (
                  <button
                    className="connection-card"
                    key={p.id}
                    onClick={() => openConnection(p)}
                  >
                    <Database size={22} style={{ color: profileColor(p) }} />
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.driver === "postgres" ? "PostgreSQL" : "MySQL"} ·{" "}
                        {p.host}:{p.port}
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
              <button className="primary" onClick={() => openConnection()}>
                <Plus size={15} />
                New connection
              </button>
              <span className="home-note">
                PostgreSQL & MySQL · Direct connections from your computer
              </span>
            </div>
          )}
        </main>
      </div>
      {notice && !modal && (
        <div className="toast" role="status">
          {notice}
          <button
            className="icon"
            aria-label="Dismiss"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(false);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connection-title"
          >
            <header>
              <div className="modal-icon">
                <Database size={20} />
              </div>
              <div>
                <h2 id="connection-title">
                  {form.id ? "Open connection" : "New connection"}
                </h2>
                <p>A new window into your data.</p>
              </div>
              <button
                className="icon"
                aria-label="Close dialog"
                disabled={busy}
                onClick={() => setModal(false)}
              >
                <X size={18} />
              </button>
            </header>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                connect();
              }}
            >
              <div className="connection-import">
                <label>
                  Connection URL
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Connection URL"
                    placeholder="postgresql://user:password@host:5432/database"
                    value={connectionURL}
                    onChange={(e) => setConnectionURL(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        importConnectionURL();
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !connectionURL.trim()}
                  onClick={importConnectionURL}
                >
                  Import link
                </button>
                <p>
                  Paste your provider’s PostgreSQL or MySQL URL. Imported
                  locally; the link is never saved.
                </p>
              </div>
              <div className="driver-options">
                {["postgres", "mysql"].map((d) => (
                  <button
                    type="button"
                    key={d}
                    className={form.driver === d ? "selected" : ""}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        driver: d,
                        port: d === "postgres" ? "5432" : "3306",
                        user: d === "postgres" ? "postgres" : "root",
                        database: d === "postgres" ? "postgres" : "",
                      }))
                    }
                  >
                    <span className={"db-dot " + d} />
                    {d === "postgres" ? "PostgreSQL" : "MySQL"}
                    {form.driver === d && <Check size={14} />}
                  </button>
                ))}
              </div>
              <label>
                Connection name
                <input
                  autoFocus
                  required
                  placeholder="e.g. Acme development"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <fieldset className="connection-color-picker">
                <legend>Tag color</legend>
                <div>
                  {connectionColors.map((color) => (
                    <button
                      type="button"
                      key={color.value}
                      className={form.color === color.value ? "selected" : ""}
                      aria-label={color.name}
                      title={color.name}
                      onClick={() => setForm({ ...form, color: color.value })}
                    >
                      <span style={{ backgroundColor: color.value }} />
                      {form.color === color.value && <Check size={11} />}
                    </button>
                  ))}
                  <label className="custom-color" title="Custom color">
                    <input
                      type="color"
                      aria-label="Custom connection color"
                      value={form.color || "#007aff"}
                      onChange={(e) =>
                        setForm({ ...form, color: e.target.value })
                      }
                    />
                  </label>
                </div>
              </fieldset>
              <div className="form-row">
                <label>
                  Host
                  <input
                    required
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                  />
                </label>
                <label className="port">
                  Port
                  <input
                    required
                    type="number"
                    min="1"
                    max="65535"
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: e.target.value })}
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  User
                  <input
                    required
                    value={form.user}
                    onChange={(e) => setForm({ ...form, user: e.target.value })}
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    autoComplete="off"
                    value={form.password || ""}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                  />
                </label>
              </div>
              <label className="remember-password">
                <input
                  type="checkbox"
                  checked={rememberPassword}
                  onChange={(e) => setRememberPassword(e.target.checked)}
                />
                <span>
                  Remember password on this device
                  <small>
                    Stored in this browser so saved connections can reconnect.
                  </small>
                </span>
              </label>
              <label>
                Database
                <input
                  value={form.database}
                  onChange={(e) =>
                    setForm({ ...form, database: e.target.value })
                  }
                />
              </label>
              <label>
                TLS mode
                <select
                  aria-label="TLS mode"
                  value={form.tlsMode || (form.tls ? "verify-full" : "disable")}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      tlsMode: e.target.value,
                      tls: e.target.value !== "disable",
                      caCert: ["verify-ca", "verify-full"].includes(
                        e.target.value,
                      )
                        ? form.caCert
                        : "",
                    })
                  }
                >
                  <option value="disable">Disabled — local connections</option>
                  <option value="require">
                    Encrypted only (require) — no CA upload
                  </option>
                  <option value="verify-ca">
                    Verify certificate authority (verify-ca)
                  </option>
                  <option value="verify-full">
                    Verify certificate and hostname (verify-full)
                  </option>
                </select>
              </label>
              {form.tlsMode === "require" && (
                <p className="tls-explanation">
                  Encrypted connection. Server identity is not verified; no CA
                  certificate is needed.
                </p>
              )}
              {form.tls && form.tlsMode !== "require" && (
                <div className="ca-settings">
                  <label>
                    CA certificate (optional)
                    <input
                      type="file"
                      accept=".pem,.crt,.cer"
                      aria-label="Upload CA certificate"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 256 * 1024) {
                          setNotice(
                            "CA certificate must be smaller than 256 KB.",
                          );
                          e.target.value = "";
                          return;
                        }
                        try {
                          const caCert = await file.text();
                          if (
                            !caCert.includes("-----BEGIN CERTIFICATE-----") ||
                            caCert.includes("PRIVATE KEY")
                          ) {
                            setNotice(
                              "Choose a PEM CA certificate, not a private key.",
                            );
                            e.target.value = "";
                            return;
                          }
                          setForm((f) => ({ ...f, caCert }));
                          setNotice(
                            "CA certificate loaded. Test the connection to verify it.",
                          );
                        } catch {
                          setNotice("Could not read the certificate file.");
                        }
                      }}
                    />
                  </label>
                  <p>
                    Optional provider CA certificate for verified TLS. Publicly
                    trusted certificates need no upload. Only this connection
                    will trust an uploaded CA.
                  </p>
                  {form.caCert && (
                    <div className="ca-loaded">
                      <Check size={13} /> CA certificate attached{" "}
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, caCert: "" })}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              )}
              <p className="security-note">
                <ShieldCheck size={14} /> The server profile never contains the
                password. Remembered passwords stay in this browser&apos;s local
                storage.
              </p>
              {notice && (
                <p className="form-notice" role="status">
                  {notice}
                </p>
              )}
              {form.id && confirmDelete && (
                <div className="delete-confirmation" role="alert">
                  <div>
                    <strong>Delete this saved connection?</strong>
                    <span>
                      Active database sessions will stay open until disconnected.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={deleteProfile}
                    disabled={busy}
                  >
                    Delete
                  </button>
                </div>
              )}
              <footer>
                <div className="footer-left">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={test}
                  >
                    Test connection
                  </button>
                  {form.id && (
                    <button
                      type="button"
                      className="delete-profile"
                      disabled={busy}
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 size={13} />
                      Delete
                    </button>
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={save}
                  >
                    {form.id ? "Save changes" : "Save profile"}
                  </button>
                  <button type="submit" className="primary" disabled={busy}>
                    {busy ? "Connecting…" : "Connect"}
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

import { supabase } from "./supabase.js";

let paused = false;
let onPauseChange = () => {};
let closeTimer = 0;
let editingId = null;
let loading = false;
let saving = false;
let listRequest = 0;
let cachedEntries = [];

export function isGamePaused() {
  return paused;
}

export function onDiaryPause(handler) {
  onPauseChange = handler;
}

function todayLabel() {
  return new Date().toLocaleDateString("zh-Hant", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const title = String(entry.title || "").trim();
  const content = String(entry.content || entry.body || "");
  const date = String(entry.date || todayLabel());
  const id = String(entry.id || "");
  if (!id) {
    return null;
  }
  return { id, date, title, content };
}

function setPaused(next) {
  paused = next;
  document.body.classList.toggle("diary-open", next);
  onPauseChange(next);
}

function els() {
  return {
    modal: document.getElementById("diary-modal"),
    paper: document.querySelector(".diary-paper"),
    status: document.getElementById("diary-status"),
    listView: document.getElementById("diary-list-view"),
    editView: document.getElementById("diary-edit-view"),
    list: document.getElementById("diary-list"),
    empty: document.getElementById("diary-empty"),
    date: document.getElementById("diary-date"),
    title: document.getElementById("diary-heading"),
    body: document.getElementById("diary-body"),
    save: document.getElementById("diary-save"),
    heading: document.getElementById("diary-label"),
  };
}

function isBusy() {
  return loading || saving;
}

function setStatus(message, kind = "info") {
  const { status } = els();
  if (!status) {
    return;
  }
  if (!message) {
    status.hidden = true;
    status.textContent = "";
    status.removeAttribute("data-kind");
    return;
  }
  status.hidden = false;
  status.textContent = message;
  status.dataset.kind = kind;
}

function setBusy(nextLoading, nextSaving) {
  loading = nextLoading;
  saving = nextSaving;
  const { paper, title, body, save } = els();
  paper?.classList.toggle("is-busy", isBusy());
  const freeze = isBusy();
  if (title) {
    title.disabled = freeze;
  }
  if (body) {
    body.disabled = freeze;
  }
  if (save) {
    save.disabled = freeze;
  }
}

function showView(name) {
  const { listView, editView, heading } = els();
  const isList = name === "list";
  listView.hidden = !isList;
  editView.hidden = isList;
  heading.textContent = "日記";
}

function previewText(content) {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "（空白頁）";
  }
  return text.length > 36 ? `${text.slice(0, 36)}…` : text;
}

function renderList(entries, options = {}) {
  const { list, empty } = els();
  cachedEntries = entries;
  list.replaceChildren();
  empty.hidden = Boolean(options.failed) || loading || entries.length > 0;

  for (const entry of entries) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "diary-item";
    item.dataset.diary = "open-entry";
    item.dataset.id = entry.id;

    const date = document.createElement("span");
    date.className = "diary-item-date";
    date.textContent = entry.date;

    const title = document.createElement("span");
    title.className = "diary-item-title";
    title.textContent = entry.title || "無標題";

    const preview = document.createElement("span");
    preview.className = "diary-item-preview";
    preview.textContent = previewText(entry.content);

    item.append(date, title, preview);
    list.append(item);
  }
}

async function fetchEntries() {
  const requestId = ++listRequest;
  setBusy(true, saving);
  setStatus("載入中…");

  const { data, error } = await supabase
    .from("diaries")
    .select("id, created_at, date, title, content")
    .order("created_at", { ascending: false });

  if (requestId !== listRequest) {
    return cachedEntries;
  }

  if (error) {
    setBusy(false, saving);
    setStatus("讀取失敗，請稍後再試。", "error");
    renderList([], { failed: true });
    return [];
  }

  const entries = (data || []).map(normalizeEntry).filter(Boolean);
  setBusy(false, saving);
  setStatus("");
  renderList(entries);
  return entries;
}

function fillForm(entry) {
  const { date, title, body } = els();
  date.textContent = entry?.date || todayLabel();
  title.value = entry?.title || "";
  body.value = entry?.content || "";
}

function openEditor(entry) {
  if (isBusy()) {
    return;
  }
  editingId = entry?.id || null;
  fillForm(entry);
  showView("edit");
  els().title?.focus();
}

async function showList() {
  editingId = null;
  showView("list");
  await fetchEntries();
}

export function openDiary() {
  const { modal } = els();
  if (!modal || paused) {
    return;
  }

  clearTimeout(closeTimer);
  editingId = null;
  renderList([]);
  showView("list");
  modal.hidden = false;
  modal.inert = false;
  requestAnimationFrame(() => {
    modal.classList.add("open");
  });
  setPaused(true);
  void fetchEntries();
}

export function closeDiary() {
  const { modal } = els();
  if (!modal || modal.hidden || saving) {
    return;
  }

  listRequest += 1;
  loading = false;
  setBusy(false, false);
  modal.classList.remove("open");
  modal.inert = true;
  setPaused(false);
  closeTimer = setTimeout(() => {
    modal.hidden = true;
  }, 240);
}

async function persist() {
  const { title, body, save } = els();
  if (isBusy() || !title || !body || !save) {
    return;
  }

  setBusy(false, true);
  save.textContent = "儲存中…";
  setStatus("儲存中…");

  const payload = {
    date: editingId
      ? cachedEntries.find((entry) => entry.id === editingId)?.date || todayLabel()
      : todayLabel(),
    title: title.value.trim(),
    content: body.value,
  };

  const query = editingId
    ? supabase.from("diaries").update(payload).eq("id", editingId).select("id, date, title, content").single()
    : supabase.from("diaries").insert(payload).select("id, date, title, content").single();

  const { data, error } = await query;

  if (error || !data) {
    setBusy(false, false);
    save.textContent = "儲存";
    setStatus("儲存失敗，請稍後再試。", "error");
    return;
  }

  const saved = normalizeEntry(data);
  if (saved) {
    editingId = saved.id;
    const others = cachedEntries.filter((entry) => entry.id !== saved.id);
    cachedEntries = [saved, ...others];
  }

  setBusy(false, false);
  setStatus("");
  save.textContent = "已儲存";
  clearTimeout(persist._timer);
  persist._timer = setTimeout(() => {
    save.textContent = "儲存";
  }, 900);
}

export function initDiary() {
  const modal = document.getElementById("diary-modal");
  if (!modal) {
    return;
  }

  modal.addEventListener("click", (event) => {
    const actionEl = event.target.closest("[data-diary]");
    const action = actionEl?.dataset.diary;
    if (action === "close" || action === "backdrop") {
      closeDiary();
    }
    if (action === "save") {
      void persist();
    }
    if (action === "new") {
      openEditor(null);
    }
    if (action === "back") {
      if (isBusy()) {
        return;
      }
      void showList();
    }
    if (action === "open-entry") {
      if (isBusy()) {
        return;
      }
      const entry = cachedEntries.find((item) => item.id === actionEl.dataset.id);
      if (entry) {
        openEditor(entry);
      }
    }
  });

  window.addEventListener("keydown", (event) => {
    if (!paused) {
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      if (isBusy()) {
        return;
      }
      const { editView } = els();
      if (editView && !editView.hidden) {
        void showList();
        return;
      }
      closeDiary();
    }
  });
}

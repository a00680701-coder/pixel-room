const STORAGE_KEY = "pixel-room-diary";

let paused = false;
let onPauseChange = () => {};
let closeTimer = 0;
let editingId = null;

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

function newId() {
  if (globalThis.crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  return `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadEntries() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(raw)) {
      return raw.map(normalizeEntry).filter(Boolean);
    }
    if (raw && typeof raw === "object") {
      const migrated = normalizeEntry({
        id: newId(),
        date: raw.date,
        title: raw.title,
        content: raw.content || raw.body,
        mood: raw.mood,
      });
      const list = migrated ? [migrated] : [];
      saveEntries(list);
      return list;
    }
  } catch {
    return [];
  }
  return [];
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const title = String(entry.title || "").trim();
  const content = String(entry.content || entry.body || "");
  const date = String(entry.date || todayLabel());
  const id = String(entry.id || newId());
  return { id, date, title, content };
}

function saveEntries(entries) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(entries.map(({ id, date, title, content }) => ({ id, date, title, content }))),
  );
}

function setPaused(next) {
  paused = next;
  document.body.classList.toggle("diary-open", next);
  onPauseChange(next);
}

function els() {
  return {
    modal: document.getElementById("diary-modal"),
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

function renderList() {
  const { list, empty } = els();
  const entries = loadEntries();
  list.replaceChildren();
  empty.hidden = entries.length > 0;

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

function fillForm(entry) {
  const { date, title, body } = els();
  date.textContent = entry?.date || todayLabel();
  title.value = entry?.title || "";
  body.value = entry?.content || "";
}

function openEditor(entry) {
  editingId = entry?.id || null;
  fillForm(entry);
  showView("edit");
  els().title?.focus();
}

export function openDiary() {
  const { modal } = els();
  if (!modal || paused) {
    return;
  }

  clearTimeout(closeTimer);
  editingId = null;
  renderList();
  showView("list");
  modal.hidden = false;
  modal.inert = false;
  requestAnimationFrame(() => {
    modal.classList.add("open");
  });
  setPaused(true);
}

export function closeDiary() {
  const { modal } = els();
  if (!modal || modal.hidden) {
    return;
  }

  modal.classList.remove("open");
  modal.inert = true;
  setPaused(false);
  closeTimer = setTimeout(() => {
    modal.hidden = true;
  }, 240);
}

function persist() {
  const { title, body, save } = els();
  const entries = loadEntries();
  const next = {
    id: editingId || newId(),
    date: editingId
      ? entries.find((entry) => entry.id === editingId)?.date || todayLabel()
      : todayLabel(),
    title: title.value.trim(),
    content: body.value,
  };

  const index = entries.findIndex((entry) => entry.id === next.id);
  if (index >= 0) {
    entries[index] = next;
  } else {
    entries.unshift(next);
    editingId = next.id;
  }

  saveEntries(entries);
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
      persist();
    }
    if (action === "new") {
      openEditor(null);
    }
    if (action === "back") {
      editingId = null;
      renderList();
      showView("list");
    }
    if (action === "open-entry") {
      const entry = loadEntries().find((item) => item.id === actionEl.dataset.id);
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
      const { editView } = els();
      if (editView && !editView.hidden) {
        editingId = null;
        renderList();
        showView("list");
        return;
      }
      closeDiary();
    }
  });
}

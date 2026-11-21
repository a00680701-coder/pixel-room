import { supabase } from "./supabase.js";

let paused = false;
let onPauseChange = () => {};
let closeTimer = 0;
let saveTimer = 0;
let editingId = null;
let editingDate = "";
let content = "";
let spreadIndex = 0;
let loading = false;
let saving = false;
let tocOpen = false;
let listRequest = 0;
let cachedEntries = [];
let expandedYears = new Set();
let expandedMonths = new Set();
let measureEl = null;

export function isGamePaused() {
  return paused;
}

export function onDiaryPause(handler) {
  onPauseChange = handler;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function parseEntryDate(entry) {
  const raw = String(entry?.date || "");
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const zh = raw.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (zh) {
    return new Date(Number(zh[1]), Number(zh[2]) - 1, Number(zh[3]));
  }
  const created = entry?.created_at ? new Date(entry.created_at) : new Date();
  return Number.isNaN(created.getTime()) ? new Date() : created;
}

function toIso(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatHead(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("zh-Hant", {
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
  const id = String(entry.id || "");
  if (!id) {
    return null;
  }
  const parsed = parseEntryDate(entry);
  return {
    id,
    date: toIso(parsed),
    title: String(entry.title || "").trim(),
    content: String(entry.content || entry.body || ""),
    created_at: entry.created_at || null,
  };
}

function setPaused(next) {
  paused = next;
  document.body.classList.toggle("diary-open", next);
  onPauseChange(next);
}

function els() {
  return {
    modal: document.getElementById("diary-modal"),
    book: document.getElementById("diary-book"),
    bookmark: document.querySelector(".diary-bookmark"),
    status: document.getElementById("diary-status"),
    left: document.getElementById("diary-left"),
    right: document.getElementById("diary-right"),
    leftHead: document.getElementById("diary-left-head"),
    rightHead: document.getElementById("diary-right-head"),
    leftNum: document.getElementById("diary-left-num"),
    rightNum: document.getElementById("diary-right-num"),
    tocLeft: document.getElementById("diary-toc-left"),
    tocRight: document.getElementById("diary-toc-right"),
    prev: document.getElementById("diary-prev"),
    next: document.getElementById("diary-next"),
  };
}

let persistLock = false;
let persistQueued = false;

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
  const { book, left, right } = els();
  book?.classList.toggle("is-busy", loading);
  const freeze = loading;
  if (left) {
    left.disabled = freeze;
  }
  if (right) {
    right.disabled = freeze;
  }
}

function formatSupabaseError(error) {
  if (!error) {
    return "未知錯誤";
  }
  if (typeof error === "string") {
    return error;
  }
  const parts = [
    error.message,
    error.code ? `code=${error.code}` : "",
    error.details,
    error.hint,
  ].filter(Boolean);
  return parts.join(" | ") || String(error);
}

function reportDiaryError(action, error) {
  const detail = formatSupabaseError(error);
  console.error(`[diary] ${action} failed`, error);
  return detail;
}

function ensureMeasure() {
  const { book, left } = els();
  if (!book || !left) {
    return null;
  }
  if (!measureEl) {
    measureEl = document.createElement("textarea");
    measureEl.className = "diary-measure";
    measureEl.tabIndex = -1;
    measureEl.setAttribute("aria-hidden", "true");
    measureEl.readOnly = true;
    book.append(measureEl);
  }
  const style = getComputedStyle(left);
  measureEl.style.width = `${left.clientWidth}px`;
  measureEl.style.height = `${left.clientHeight}px`;
  measureEl.style.font = style.font;
  measureEl.style.fontSize = style.fontSize;
  measureEl.style.lineHeight = style.lineHeight;
  measureEl.style.letterSpacing = style.letterSpacing;
  measureEl.style.padding = style.padding;
  return measureEl;
}

function lineMetrics() {
  const { left } = els();
  const style = getComputedStyle(left);
  const line = parseFloat(style.lineHeight) || 28;
  const lines = Math.max(1, Math.round(left.clientHeight / line));
  return { line, lines, height: line * lines };
}

function charsFitting(text, maxHeight) {
  const el = ensureMeasure();
  if (!el) {
    return text.length;
  }
  if (!text) {
    return 0;
  }
  let lo = 0;
  let hi = text.length;
  let fit = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    el.value = text.slice(0, mid);
    if (el.scrollHeight <= maxHeight + 1) {
      fit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return fit;
}

function splitPages(text) {
  const { height } = lineMetrics();
  const pages = [];
  let offset = 0;
  const source = String(text || "");
  if (!source) {
    return [{ start: 0, end: 0 }];
  }
  while (offset < source.length) {
    let take = charsFitting(source.slice(offset), height);
    if (take <= 0) {
      take = 1;
    }
    pages.push({ start: offset, end: offset + take });
    offset += take;
  }
  return pages;
}

function isPageFull(pageText) {
  const { height } = lineMetrics();
  return charsFitting(`${pageText}字`, height) <= pageText.length;
}

function spreadRange(text, index) {
  const pages = splitPages(text);
  const left = pages[index * 2];
  const right = pages[index * 2 + 1];
  const start = left?.start ?? text.length;
  const end = right?.end ?? left?.end ?? text.length;
  return { pages, start, end, left, right };
}

function lastWrittenSpread(text) {
  const pages = splitPages(text);
  if (text.length === 0) {
    return 0;
  }
  return Math.max(0, Math.ceil(pages.length / 2) - 1);
}

function isSpreadFull(text, index) {
  const { pages, right } = spreadRange(text, index);
  if (!right) {
    return false;
  }
  const last = pages[pages.length - 1];
  if (last !== right && pages.length > index * 2 + 2) {
    return true;
  }
  return isPageFull(text.slice(right.start, right.end));
}

function maxSpread(text) {
  const last = lastWrittenSpread(text);
  return isSpreadFull(text, last) ? last + 1 : last;
}

function localEntry(iso, id = null, body = "") {
  return { id, date: iso, title: "", content: body };
}

function currentEntry() {
  return cachedEntries.find((entry) => entry.date === editingDate) || localEntry(editingDate, editingId, content);
}

function renderSpread() {
  const { left, right, leftHead, rightHead, leftNum, rightNum, prev, next, book } = els();
  if (!left || !right) {
    return;
  }

  book?.classList.toggle("is-toc", tocOpen);
  els().bookmark?.classList.toggle("is-on", tocOpen);

  const dateLabel = formatHead(editingDate || todayIso());
  const { pages, left: leftPage, right: rightPage } = spreadRange(content, spreadIndex);
  left.value = leftPage ? content.slice(leftPage.start, leftPage.end) : "";
  right.value = rightPage ? content.slice(rightPage.start, rightPage.end) : "";
  leftHead.textContent = tocOpen ? "目錄" : dateLabel;
  rightHead.textContent = tocOpen ? "" : spreadIndex === 0 ? "日記" : "續";
  leftNum.textContent = String(spreadIndex * 2 + 1);
  rightNum.textContent = String(spreadIndex * 2 + 2);
  prev.disabled = tocOpen || spreadIndex <= 0;
  next.disabled = tocOpen || spreadIndex >= maxSpread(content);
  left.readOnly = tocOpen;
  right.readOnly = tocOpen;

  if (tocOpen) {
    renderToc();
  } else if (els().tocLeft) {
    els().tocLeft.hidden = true;
    els().tocRight.hidden = true;
  }
}

function entriesForToc() {
  const list = [...cachedEntries];
  if (editingDate && !list.some((entry) => entry.date === editingDate)) {
    list.push({
      id: editingId || "draft",
      date: editingDate,
      title: "",
      content,
    });
  }
  return list;
}

function tocTree() {
  const years = new Map();
  const sorted = [...entriesForToc()].sort((a, b) => b.date.localeCompare(a.date));
  for (const entry of sorted) {
    const date = parseEntryDate(entry);
    const year = String(date.getFullYear());
    const month = pad2(date.getMonth() + 1);
    if (!years.has(year)) {
      years.set(year, new Map());
    }
    const months = years.get(year);
    if (!months.has(month)) {
      months.set(month, []);
    }
    months.get(month).push({ entry, date });
  }
  return years;
}

function renderToc() {
  const { tocLeft, tocRight } = els();
  tocLeft.hidden = false;
  tocRight.hidden = false;
  tocLeft.replaceChildren();
  tocRight.replaceChildren();

  const title = document.createElement("p");
  title.className = "diary-toc-title";
  title.textContent = "目錄";
  tocLeft.append(title);

  const years = tocTree();
  if (years.size === 0) {
    const empty = document.createElement("p");
    empty.className = "diary-toc-empty";
    empty.textContent = "還沒有寫過的日子。";
    tocLeft.append(empty);
    return;
  }

  const yearKeys = [...years.keys()].sort((a, b) => Number(b) - Number(a));
  const leftYears = yearKeys.filter((_, i) => i % 2 === 0);
  const rightYears = yearKeys.filter((_, i) => i % 2 === 1);

  function paint(root, keys) {
    for (const year of keys) {
      const yearBtn = document.createElement("button");
      yearBtn.type = "button";
      yearBtn.className = `diary-toc-year${expandedYears.has(year) ? " is-open" : ""}`;
      yearBtn.dataset.diary = "toc-year";
      yearBtn.dataset.year = year;
      yearBtn.textContent = `${year}年`;
      root.append(yearBtn);

      const yearNest = document.createElement("div");
      yearNest.className = `diary-toc-nested${expandedYears.has(year) ? " is-open" : ""}`;
      const months = years.get(year);
      const monthKeys = [...months.keys()].sort((a, b) => Number(b) - Number(a));
      for (const month of monthKeys) {
        const key = `${year}-${month}`;
        const monthBtn = document.createElement("button");
        monthBtn.type = "button";
        monthBtn.className = `diary-toc-month${expandedMonths.has(key) ? " is-open" : ""}`;
        monthBtn.dataset.diary = "toc-month";
        monthBtn.dataset.month = key;
        monthBtn.textContent = `${Number(month)}月`;
        yearNest.append(monthBtn);

        const monthNest = document.createElement("div");
        monthNest.className = `diary-toc-nested${expandedMonths.has(key) ? " is-open" : ""}`;
        const days = months.get(month).sort((a, b) => b.date - a.date);
        const seen = new Set();
        for (const item of days) {
          if (seen.has(item.entry.date)) {
            continue;
          }
          seen.add(item.entry.date);
          const dayBtn = document.createElement("button");
          dayBtn.type = "button";
          dayBtn.className = "diary-toc-day";
          dayBtn.dataset.diary = "toc-day";
          dayBtn.dataset.date = item.entry.date;
          dayBtn.textContent = `${item.date.getDate()}日`;
          monthNest.append(dayBtn);
        }
        yearNest.append(monthNest);
      }
      root.append(yearNest);
    }
  }

  paint(tocLeft, leftYears);
  paint(tocRight, rightYears);
}

function openToc() {
  tocOpen = true;
  const now = parseEntryDate(currentEntry());
  expandedYears.add(String(now.getFullYear()));
  expandedMonths.add(`${now.getFullYear()}-${pad2(now.getMonth() + 1)}`);
  renderSpread();
}

function closeToc() {
  tocOpen = false;
  renderSpread();
}

function applyEdit(side) {
  const { left, right } = els();
  const caret = side === "left" ? left.selectionStart : right.selectionStart;
  const { start, end } = spreadRange(content, spreadIndex);
  const hadLater = content.slice(end).length > 0;
  let next = content.slice(0, start) + left.value + right.value + content.slice(end);

  if (!hadLater) {
    const allowed = splitPages(next).slice(0, spreadIndex * 2 + 2);
    const last = allowed[allowed.length - 1];
    const cap = last?.end ?? start;
    if (next.length > cap) {
      next = next.slice(0, cap);
    }
  }

  content = next;
  const entry = cachedEntries.find((item) => item.date === editingDate);
  if (entry) {
    entry.content = content;
  }
  renderSpread();

  if (tocOpen) {
    scheduleSave();
    return;
  }

  const newLeft = left.value.length;
  if (side === "left" && caret > newLeft) {
    const pos = Math.min(Math.max(0, caret - newLeft), right.value.length);
    right.focus();
    right.setSelectionRange(pos, pos);
  } else if (side === "left") {
    const pos = Math.min(caret, left.value.length);
    left.setSelectionRange(pos, pos);
  } else {
    const pos = Math.min(caret, right.value.length);
    right.setSelectionRange(pos, pos);
  }

  scheduleSave();
}

function emptyToday() {
  return localEntry(todayIso());
}

function openDay(entry, nextSpread = 0) {
  tocOpen = false;
  editingId = entry.id;
  editingDate = entry.date;
  content = entry.content || "";
  spreadIndex = Math.max(0, Math.min(nextSpread, maxSpread(content)));
  renderSpread();
  if (!loading) {
    els().left?.focus();
  }
}

async function fetchEntries() {
  const requestId = ++listRequest;
  setBusy(true, saving);
  setStatus("載入中…");

  try {
    const { data, error } = await supabase
      .from("diaries")
      .select("id, created_at, date, title, content")
      .order("created_at", { ascending: false });

    if (requestId !== listRequest) {
      return cachedEntries;
    }

    if (error) {
      setBusy(false, saving);
      setStatus(`讀取失敗：${reportDiaryError("select", error)}`, "error");
      cachedEntries = [];
      openDay(emptyToday());
      return [];
    }

    cachedEntries = (data || []).map(normalizeEntry).filter(Boolean);
    setBusy(false, saving);
    setStatus("");
    return cachedEntries;
  } catch (error) {
    if (requestId !== listRequest) {
      return cachedEntries;
    }
    setBusy(false, saving);
    setStatus(`讀取失敗：${reportDiaryError("select", error)}`, "error");
    cachedEntries = [];
    openDay(emptyToday());
    return [];
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persist();
  }, 700);
}

async function persist() {
  if (loading || !editingDate) {
    return;
  }
  if (!editingId && !content.trim()) {
    return;
  }
  if (persistLock) {
    persistQueued = true;
    return;
  }

  persistLock = true;
  saving = true;
  setStatus("儲存中…");

  const payload = {
    date: editingDate,
    title: content.trim().slice(0, 40),
    content,
  };

  const query = editingId
    ? supabase.from("diaries").update(payload).eq("id", editingId).select("id, created_at, date, title, content").single()
    : supabase.from("diaries").insert(payload).select("id, created_at, date, title, content").single();

  let data;
  let error;
  try {
    ({ data, error } = await query);
  } catch (caught) {
    error = caught;
  }

  saving = false;
  persistLock = false;
  if (error || !data) {
    setStatus(`儲存失敗：${reportDiaryError(editingId ? "update" : "insert", error || "沒有回傳資料")}`, "error");
    return;
  }

  const saved = normalizeEntry(data);
  if (saved) {
    editingId = saved.id;
    cachedEntries = [saved, ...cachedEntries.filter((entry) => entry.id !== saved.id && entry.date !== saved.date)];
  }
  setStatus("");
  if (persistQueued) {
    persistQueued = false;
    await persist();
  }
}

export function openDiary() {
  const { modal } = els();
  if (!modal || paused) {
    return;
  }

  clearTimeout(closeTimer);
  tocOpen = false;
  spreadIndex = 0;
  content = "";
  editingId = null;
  editingDate = todayIso();
  modal.hidden = false;
  modal.inert = false;
  requestAnimationFrame(() => {
    modal.classList.add("open");
    renderSpread();
  });
  setPaused(true);

  void fetchEntries().then((entries) => {
    const today = todayIso();
    const match = entries.find((entry) => entry.date === today);
    openDay(match || emptyToday());
  });
}

export function closeDiary() {
  const { modal } = els();
  if (!modal || modal.hidden) {
    return;
  }

  listRequest += 1;
  clearTimeout(saveTimer);
  if (content.trim() || editingId) {
    void persist();
  }
  loading = false;
  setBusy(false, false);
  modal.classList.remove("open");
  modal.inert = true;
  setPaused(false);
  closeTimer = setTimeout(() => {
    modal.hidden = true;
  }, 240);
}

function flip(delta) {
  if (tocOpen || loading) {
    return;
  }
  const next = spreadIndex + delta;
  if (next < 0 || next > maxSpread(content)) {
    return;
  }
  spreadIndex = next;
  renderSpread();
  els().left?.focus();
}

export function initDiary() {
  const modal = document.getElementById("diary-modal");
  if (!modal) {
    return;
  }

  const { left, right } = els();
  left?.addEventListener("input", () => applyEdit("left"));
  right?.addEventListener("input", () => applyEdit("right"));

  modal.addEventListener("click", (event) => {
    const actionEl = event.target.closest("[data-diary]");
    const action = actionEl?.dataset.diary;
    if (action === "close" || action === "backdrop") {
      closeDiary();
    }
    if (action === "toc") {
      if (tocOpen) {
        closeToc();
      } else {
        openToc();
      }
    }
    if (action === "prev") {
      flip(-1);
    }
    if (action === "next") {
      flip(1);
    }
    if (action === "toc-year") {
      const year = actionEl.dataset.year;
      if (expandedYears.has(year)) {
        expandedYears.delete(year);
      } else {
        expandedYears.add(year);
      }
      renderToc();
    }
    if (action === "toc-month") {
      const month = actionEl.dataset.month;
      if (expandedMonths.has(month)) {
        expandedMonths.delete(month);
      } else {
        expandedMonths.add(month);
      }
      renderToc();
    }
    if (action === "toc-day") {
      const entry = cachedEntries.find((item) => item.date === actionEl.dataset.date);
      if (entry) {
        openDay(entry);
      }
    }
  });

  window.addEventListener("keydown", (event) => {
    if (!paused) {
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      if (tocOpen) {
        closeToc();
        return;
      }
      closeDiary();
    }
    if (tocOpen || event.target?.closest?.(".diary-lines")) {
      return;
    }
    if (event.code === "ArrowLeft") {
      flip(-1);
    }
    if (event.code === "ArrowRight") {
      flip(1);
    }
  });

  window.addEventListener("resize", () => {
    if (paused) {
      renderSpread();
    }
  });
}

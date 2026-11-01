const STORAGE_KEY = "pixel-room-diary";

let paused = false;
let onPauseChange = () => {};
let closeTimer = 0;

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

function loadEntry() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveEntry(entry) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
}

function setPaused(next) {
  paused = next;
  document.body.classList.toggle("diary-open", next);
  onPauseChange(next);
}

function els() {
  return {
    modal: document.getElementById("diary-modal"),
    date: document.getElementById("diary-date"),
    title: document.getElementById("diary-heading"),
    body: document.getElementById("diary-body"),
    save: document.getElementById("diary-save"),
  };
}

function selectedMood() {
  return document.querySelector(".diary-mood[aria-pressed='true']")?.dataset.mood || "calm";
}

function setMood(id) {
  for (const btn of document.querySelectorAll(".diary-mood")) {
    btn.setAttribute("aria-pressed", btn.dataset.mood === id ? "true" : "false");
  }
}

function fillForm() {
  const { date, title, body } = els();
  const saved = loadEntry() || {};
  date.textContent = todayLabel();
  title.value = saved.title || "";
  body.value = saved.body || "";
  setMood(saved.mood || "calm");
}

export function openDiary() {
  const { modal, title } = els();
  if (!modal || paused) {
    return;
  }

  clearTimeout(closeTimer);
  fillForm();
  modal.hidden = false;
  modal.inert = false;
  requestAnimationFrame(() => {
    modal.classList.add("open");
  });
  setPaused(true);
  title?.focus();
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
  saveEntry({
    date: todayLabel(),
    mood: selectedMood(),
    title: title.value.trim(),
    body: body.value,
  });
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
    const action = event.target.closest("[data-diary]")?.dataset.diary;
    if (action === "close" || action === "backdrop") {
      closeDiary();
    }
    if (action === "save") {
      persist();
    }
  });

  modal.addEventListener("click", (event) => {
    const mood = event.target.closest(".diary-mood");
    if (mood) {
      setMood(mood.dataset.mood);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (!paused) {
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      closeDiary();
    }
  });
}

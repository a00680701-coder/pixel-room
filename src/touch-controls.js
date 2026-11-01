export const touchInput = {
  up: false,
  down: false,
  left: false,
  right: false,
  actionPressed: false,
};

const dirs = ["up", "down", "left", "right"];
const dpadPointers = new Map();

function clearDirs() {
  for (const dir of dirs) {
    touchInput[dir] = false;
  }
}

function setDirs(next) {
  for (const dir of dirs) {
    touchInput[dir] = Boolean(next[dir]);
  }
}

export function isTouchPreferred() {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const noHover = window.matchMedia("(hover: none)").matches;
  const narrow = window.matchMedia("(max-width: 900px)").matches;
  return coarse || noHover || narrow;
}

export function consumeAction() {
  const pressed = touchInput.actionPressed;
  touchInput.actionPressed = false;
  return pressed;
}

export function setTouchInputLocked(locked) {
  clearDirs();
  touchInput.actionPressed = false;
  updateDpadVisual();
  document.getElementById("touch-ui")?.classList.toggle("locked", Boolean(locked));
}

export function setInteractHint(on) {
  const btn = document.getElementById("btn-a");
  if (!btn) {
    return;
  }
  btn.classList.toggle("hint", Boolean(on));
}

export function showToast(text) {
  const el = document.getElementById("toast");
  if (!el) {
    return;
  }
  el.hidden = false;
  el.textContent = text;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.hidden = true;
  }, 1800);
}

function updateDpadVisual() {
  const pad = document.getElementById("dpad");
  if (!pad) {
    return;
  }
  for (const dir of dirs) {
    const btn = pad.querySelector(`[data-dir="${dir}"]`);
    btn?.classList.toggle("held", touchInput[dir]);
  }
}

function dirFromPoint(pad, clientX, clientY) {
  const rect = pad.getBoundingClientRect();
  const x = clientX - (rect.left + rect.width / 2);
  const y = clientY - (rect.top + rect.height / 2);
  const dead = Math.min(rect.width, rect.height) * 0.12;
  const next = { up: false, down: false, left: false, right: false };

  if (x * x + y * y < dead * dead) {
    return next;
  }

  if (Math.abs(x) > Math.abs(y)) {
    next[x < 0 ? "left" : "right"] = true;
  } else {
    next[y < 0 ? "up" : "down"] = true;
  }

  return next;
}

function mergeDpad() {
  const merged = { up: false, down: false, left: false, right: false };
  for (const dir of dpadPointers.values()) {
    for (const key of dirs) {
      if (dir[key]) {
        merged[key] = true;
      }
    }
  }
  setDirs(merged);
  updateDpadVisual();
}

export function initTouchControls() {
  const ui = document.getElementById("touch-ui");
  const pad = document.getElementById("dpad");
  const btnA = document.getElementById("btn-a");

  if (!ui || !pad || !btnA) {
    return;
  }

  const show = () => {
    ui.hidden = false;
  };

  const syncVisibility = () => {
    ui.hidden = !isTouchPreferred();
  };

  syncVisibility();

  window.matchMedia("(max-width: 900px)").addEventListener("change", syncVisibility);
  window.matchMedia("(pointer: coarse)").addEventListener("change", syncVisibility);
  window.matchMedia("(hover: none)").addEventListener("change", syncVisibility);

  window.addEventListener(
    "touchstart",
    () => {
      show();
    },
    { passive: true },
  );

  pad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    pad.setPointerCapture(event.pointerId);
    dpadPointers.set(event.pointerId, dirFromPoint(pad, event.clientX, event.clientY));
    mergeDpad();
  });

  pad.addEventListener("pointermove", (event) => {
    if (!dpadPointers.has(event.pointerId)) {
      return;
    }
    dpadPointers.set(event.pointerId, dirFromPoint(pad, event.clientX, event.clientY));
    mergeDpad();
  });

  const endPad = (event) => {
    if (!dpadPointers.has(event.pointerId)) {
      return;
    }
    dpadPointers.delete(event.pointerId);
    if (dpadPointers.size === 0) {
      clearDirs();
      updateDpadVisual();
      return;
    }
    mergeDpad();
  };

  pad.addEventListener("pointerup", endPad);
  pad.addEventListener("pointercancel", endPad);

  btnA.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    btnA.classList.add("held");
    touchInput.actionPressed = true;
  });

  const endA = () => {
    btnA.classList.remove("held");
  };

  btnA.addEventListener("pointerup", endA);
  btnA.addEventListener("pointercancel", endA);
  btnA.addEventListener("pointerleave", endA);
}

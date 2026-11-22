import kaplay from "kaplay";
import { TILE } from "./sprites.js";
import {
  consumeAction,
  initTouchControls,
  isTouchPreferred,
  setInteractHint,
  setTouchInputLocked,
  showToast,
  touchInput,
} from "./touch-controls.js";
import { initDiary, isGamePaused, onDiaryPause, openDiary } from "./diary.js";

const ROOM_TILES = 16;
const GAME_SIZE = TILE * ROOM_TILES;
const SPEED = 80;
const GOOSE_W = 32;
const GOOSE_H = 32;
const HIT_W = 10;
const HIT_H = 8;
const HIT_Y = 4;
const HEAD_CX_LEFT = 2;
const HEAD_CX_RIGHT = 10;

const k = kaplay({
  width: GAME_SIZE,
  height: GAME_SIZE,
  letterbox: true,
  crisp: true,
  pixelDensity: 1,
  texFilter: "nearest",
  background: [18, 14, 22],
  font: "monospace",
  debug: false,
  root: document.querySelector("#game-root"),
});

const INTERACT_GAP = 28;

k.setBackground(18, 14, 22);
k.setGravity(0);
k.debug.inspect = false;
k.debug.showLog = false;

k.loadSprite("goose", "/assets/goose.png", { singular: true });
k.loadSprite("cabinet", "/assets/cabinet.png?v=4", { singular: true });
k.loadSprite("bookcase", "/assets/bookcase.png?v=7", { singular: true });
k.loadSprite("bush", "/assets/bush.png?v=3", { singular: true });
k.loadSprite("palm", "/assets/palm.png?v=3", { singular: true });
k.loadSprite("window", "/assets/window.png?v=5", { singular: true });
k.loadSprite("floor", "/assets/floor.png", { singular: true });
k.loadSprite("wall-n", "/assets/wall-n.png", { singular: true });
k.loadSprite("wall-n-l", "/assets/wall-n-l.png", { singular: true });
k.loadSprite("wall-n-r", "/assets/wall-n-r.png", { singular: true });
k.loadSprite("wall-base", "/assets/wall-base.png", { singular: true });
k.loadSprite("wall-base-l", "/assets/wall-base-l.png", { singular: true });
k.loadSprite("wall-base-r", "/assets/wall-base-r.png", { singular: true });
k.loadSprite("desk", "/assets/desk.png?v=3", { singular: true });
k.loadSprite("record-player", "/assets/record-player.png?v=3", { singular: true });

function snapCam() {
  const cam = k.camPos();
  k.camPos(Math.round(cam.x), Math.round(cam.y));
}

function gooseHitX(facingRight) {
  const cx = facingRight ? HEAD_CX_RIGHT : HEAD_CX_LEFT;
  return cx - HIT_W / 2;
}

function addBlock(x, y, w, h) {
  k.add([
    k.pos(x, y),
    k.area({ shape: new k.Rect(k.vec2(0, 0), w, h) }),
    k.body({ isStatic: true }),
    k.z(-1),
    "wall",
  ]);
}

function ipohParts() {
  const map = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date())) {
    map[part.type] = part.value;
  }
  return {
    year: Number(map.year ?? 0),
    month: Number(map.month ?? 1),
    day: Number(map.day ?? 1),
    hour: Number(map.hour ?? 0),
  };
}

function moonPhaseFrac() {
  const synodic = 29.530588853;
  const knownNew = Date.UTC(2000, 0, 6, 18, 14);
  let age = (Date.now() - knownNew) / 86400000;
  age %= synodic;
  if (age < 0) {
    age += synodic;
  }
  return age / synodic;
}

function discLit(dx, dy, phase) {
  if (dx * dx + dy * dy > 20) {
    return null;
  }
  const nx = dx / 4.2;
  const term = Math.cos(phase * Math.PI * 2);
  if (phase <= 0.5) {
    return nx >= term;
  }
  return nx <= -term;
}

function addSolid(name, x, y, hit, prompt, kind, scale = 1) {
  const bottom = y + (hit.y + hit.h) * scale;
  const comps = [
    k.sprite(name),
    k.pos(x, y),
    k.scale(scale),
    k.area({
      shape: new k.Rect(k.vec2(hit.x, hit.y), hit.w, hit.h),
    }),
    k.body({ isStatic: true }),
    k.z(bottom),
    "solid",
  ];

  if (prompt) {
    comps.push("interact");
  }

  const obj = k.add(comps);
  obj.hit = hit;
  if (prompt) {
    obj.prompt = prompt;
  }
  if (kind) {
    obj.kind = kind;
  }
  return obj;
}

function gapToHit(player, obj, hitX) {
  const px = player.pos.x + hitX;
  const py = player.pos.y + HIT_Y;
  const ox = obj.pos.x + obj.hit.x;
  const oy = obj.pos.y + obj.hit.y;
  const dx = Math.max(ox - (px + HIT_W), px - (ox + obj.hit.w), 0);
  const dy = Math.max(oy - (py + HIT_H), py - (oy + obj.hit.h), 0);
  return Math.hypot(dx, dy);
}

function nearestInteract(player, hitX) {
  const found = [];

  for (const obj of k.get("interact")) {
    const gap = gapToHit(player, obj, hitX);
    const limit = obj.kind === "diary" ? 40 : INTERACT_GAP;
    if (gap <= limit) {
      found.push({ obj, gap, diary: obj.kind === "diary" });
    }
  }

  found.sort((a, b) => Number(b.diary) - Number(a.diary) || a.gap - b.gap);
  return found[0]?.obj ?? null;
}

k.scene("room", () => {
  snapCam();

  for (let ty = 0; ty < ROOM_TILES; ty += 1) {
    for (let tx = 0; tx < ROOM_TILES; tx += 1) {
      if (ty === 0) {
        const wall =
          tx === 0 ? "wall-n-l" : tx === ROOM_TILES - 1 ? "wall-n-r" : "wall-n";
        k.add([k.sprite(wall), k.pos(tx * TILE, ty * TILE), k.z(1)]);
        continue;
      }

      if (ty === 1) {
        const wall =
          tx === 0
            ? "wall-base-l"
            : tx === ROOM_TILES - 1
              ? "wall-base-r"
              : "wall-base";
        k.add([k.sprite(wall), k.pos(tx * TILE, ty * TILE), k.z(1)]);
        continue;
      }
    }
  }

  for (let ty = 2; ty < ROOM_TILES; ty += 2) {
    for (let tx = 0; tx < ROOM_TILES; tx += 2) {
      k.add([
        k.sprite("floor", {
          width: TILE * 2 + 1,
          height: TILE * 2 + 1,
        }),
        k.pos(tx * TILE, ty * TILE),
        k.z(0),
        "floor",
      ]);
    }
  }

  addBlock(0, 0, GAME_SIZE, TILE * 2);
  addBlock(0, 0, TILE, GAME_SIZE);
  addBlock(GAME_SIZE - TILE, 0, TILE, GAME_SIZE);
  addBlock(0, GAME_SIZE - TILE, GAME_SIZE, TILE);

  const WIN_W = 56;
  const WIN_H = 22;
  const WIN_X = Math.round((GAME_SIZE - WIN_W) / 2);
  const WIN_Y = 8;
  const RADIUS = 4;
  const glass = {
    x: WIN_X + 2,
    y: WIN_Y + 2,
    w: WIN_W - 4,
    h: WIN_H - 4,
  };

  k.add([k.sprite("window"), k.pos(WIN_X, WIN_Y), k.z(3)]);

  const skyPane = k.add([
    k.rect(glass.w, glass.h),
    k.pos(glass.x, glass.y),
    k.color(120, 180, 220),
    k.z(4),
  ]);

  const starDots = [
    [5, 3],
    [11, 10],
    [18, 5],
    [24, 13],
    [31, 4],
    [38, 9],
    [44, 14],
    [8, 15],
    [47, 6],
    [27, 2],
  ].map(([sx, sy], i) =>
    k.add([
      k.rect(1, 1),
      k.pos(glass.x + sx, glass.y + sy),
      k.color(i % 3 === 0 ? 255 : 220, i % 3 === 0 ? 236 : 228, 255),
      k.z(4.05),
      k.opacity(0),
    ]),
  );

  const sun = k.add([k.pos(0, 0), k.z(4.2)]);
  const moon = k.add([k.pos(0, 0), k.z(4.2)]);
  const sunDots = [];
  const moonDots = [];
  for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
    for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
      if (dx * dx + dy * dy > 20) {
        continue;
      }
      sunDots.push(
        sun.add([
          k.rect(1, 1),
          k.pos(dx, dy),
          k.color(dx === 0 && dy === 0 ? 255 : 255, dx === 0 && dy === 0 ? 236 : 210, 74),
        ]),
      );
      moonDots.push({
        dx,
        dy,
        obj: moon.add([k.rect(1, 1), k.pos(dx, dy), k.color(240, 244, 255)]),
      });
    }
  }

  function skyTone(hour) {
    if (hour >= 6 && hour < 8) {
      return [255, 176, 120];
    }
    if (hour >= 8 && hour < 16) {
      return [126, 188, 230];
    }
    if (hour >= 16 && hour < 18) {
      return [236, 128, 86];
    }
    return [24, 30, 58];
  }

  function bodyInGlass(cx, cy) {
    return (
      cx - RADIUS >= glass.x + 1 &&
      cx + RADIUS <= glass.x + glass.w - 2 &&
      cy - RADIUS >= glass.y + 1 &&
      cy + RADIUS <= glass.y + glass.h - 2
    );
  }

  function updateSky() {
    const { hour } = ipohParts();
    const tone = skyTone(hour);
    skyPane.color = k.rgb(tone[0], tone[1], tone[2]);
    const day = hour >= 6 && hour < 18;
    const night = hour < 6 || hour >= 19;
    const t = day ? (hour - 6) / 12 : ((hour + 6) % 24) / 12;
    const cx = Math.round(glass.x + RADIUS + 1 + t * (glass.w - RADIUS * 2 - 2));
    const yLow = glass.y + glass.h - RADIUS - 2;
    const yHigh = glass.y + RADIUS + 1;
    const cy = Math.round(yLow - Math.sin(t * Math.PI) * (yLow - yHigh));
    const visible = bodyInGlass(cx, cy);
    sun.pos = k.vec2(cx, cy);
    moon.pos = k.vec2(cx, cy);
    sun.hidden = !(day && visible);
    moon.hidden = !(!day && visible);

    const phase = moonPhaseFrac();
    for (const cell of moonDots) {
      const lit = discLit(cell.dx, cell.dy, phase);
      cell.obj.hidden = lit !== true;
      if (lit === true) {
        cell.obj.color = k.rgb(240, 244, 255);
      }
    }

    for (const star of starDots) {
      star.opacity = night ? 1 : 0;
    }
  }

  updateSky();
  let lastHour = ipohParts().hour;
  k.onUpdate(() => {
    const hour = ipohParts().hour;
    if (hour !== lastHour) {
      lastHour = hour;
      updateSky();
    }
  });

  addSolid("cabinet", 18, 16, { x: 4, y: 48, w: 40, h: 14 }, "衣櫃裡疊著換季的衣服。");
  addSolid("bookcase", 184, 16, { x: 2, y: 28, w: 28, h: 10 }, "書櫃上排滿舊筆記與繪本。", null, 1.4);

  addSolid("palm", 22, 174, { x: 3, y: 24, w: 13, h: 8 });
  addSolid("bush", 204, 175, { x: 6, y: 24, w: 12, h: 8 });
  addSolid("bush", 68, 33, { x: 6, y: 24, w: 12, h: 8 });
  addSolid("palm", 148, 68, { x: 3, y: 24, w: 13, h: 8 });
  addSolid("bush", 112, 195, { x: 6, y: 24, w: 12, h: 8 });

  addSolid(
    "desk",
    20,
    98,
    { x: 1, y: 13, w: 26, h: 8 },
    "打開桌上的日記。",
    "diary",
    1.4,
  );

  addSolid("record-player", 174, 108, { x: 2, y: 19, w: 20, h: 8 }, "唱片機輕輕轉了一下，發出沙沙聲。", null, 1.4);

  const player = k.add([
    k.pos(GAME_SIZE / 2, 148),
    k.anchor("center"),
    k.area({
      shape: new k.Rect(k.vec2(gooseHitX(false), HIT_Y), HIT_W, HIT_H),
    }),
    k.body(),
    k.z(148 + HIT_Y + HIT_H),
    "player",
  ]);

  player.gravityScale = 0;

  const goose = player.add([
    k.sprite("goose"),
    k.anchor("center"),
    k.pos(0, -4),
  ]);

  let facing = "down";

  const tryInteract = () => {
    if (isGamePaused()) {
      return;
    }
    const hitX = gooseHitX(goose.flipX);
    const target = nearestInteract(player, hitX);
    if (!target) {
      return;
    }
    if (target.kind === "diary") {
      openDiary();
      return;
    }
    showToast(target.prompt);
  };

  k.onKeyPress("e", tryInteract);
  k.onKeyPress("space", tryInteract);

  const onWindowInteract = (event) => {
    if (event.repeat || isGamePaused()) {
      return;
    }
    if (event.target?.closest?.("#diary-modal")) {
      return;
    }
    if (event.code === "KeyE" || event.code === "Space") {
      event.preventDefault();
      tryInteract();
    }
  };
  window.addEventListener("keydown", onWindowInteract);
  k.onSceneLeave(() => {
    window.removeEventListener("keydown", onWindowInteract);
  });

  onDiaryPause((locked) => {
    setTouchInputLocked(locked);
    player.vel = k.vec2(0, 0);
  });

  k.onUpdate(() => {
    if (isGamePaused()) {
      player.vel = k.vec2(0, 0);
      goose.pos.y = -4;
      consumeAction();
      snapCam();
      return;
    }

    const dir = k.vec2(0, 0);

    if (k.isKeyDown("left") || k.isKeyDown("a") || touchInput.left) dir.x -= 1;
    if (k.isKeyDown("right") || k.isKeyDown("d") || touchInput.right) dir.x += 1;
    if (k.isKeyDown("up") || k.isKeyDown("w") || touchInput.up) dir.y -= 1;
    if (k.isKeyDown("down") || k.isKeyDown("s") || touchInput.down) dir.y += 1;

    const moving = dir.x !== 0 || dir.y !== 0;

    if (moving) {
      if (Math.abs(dir.x) > Math.abs(dir.y)) {
        facing = dir.x < 0 ? "left" : "right";
      } else {
        facing = dir.y < 0 ? "up" : "down";
      }

      player.move(dir.unit().scale(SPEED));
    } else {
      player.vel = k.vec2(0, 0);
    }

    if (facing === "left") goose.flipX = false;
    if (facing === "right") goose.flipX = true;

    player.area.shape = new k.Rect(
      k.vec2(gooseHitX(goose.flipX), HIT_Y),
      HIT_W,
      HIT_H,
    );

    const hitX = gooseHitX(goose.flipX);
    const minX = TILE - hitX;
    const maxX = GAME_SIZE - TILE - (hitX + HIT_W);
    const minY = TILE * 2 - HIT_Y;
    const maxY = GAME_SIZE - TILE - (HIT_Y + HIT_H);

    player.pos.x = Math.round(k.clamp(player.pos.x, minX, maxX));
    player.pos.y = Math.round(k.clamp(player.pos.y, minY, maxY));

    goose.pos.y = -4 + (moving ? Math.round(Math.sin(k.time() * 14)) : 0);
    player.z = player.pos.y + HIT_Y + HIT_H;

    const near = nearestInteract(player, hitX);
    setInteractHint(Boolean(near));

    if (consumeAction()) {
      tryInteract();
    }

    snapCam();
  });

  k.add([
    k.text(
      isTouchPreferred() ? "虛擬方向鍵移動  ·  A 互動" : "WASD / ARROWS  ·  E / SPACE 互動",
      { size: 8 },
    ),
    k.pos(8, GAME_SIZE - 12),
    k.color(240, 232, 210),
    k.z(1000),
    k.opacity(0.85),
    k.fixed(),
  ]);
});

initTouchControls();
initDiary();

k.onLoad(() => {
  k.go("room");
});

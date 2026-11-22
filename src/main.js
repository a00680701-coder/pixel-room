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
k.loadSprite("cabinet", "/assets/cabinet.png?v=3", { singular: true });
k.loadSprite("bookcase", "/assets/bookcase.png?v=7", { singular: true });
k.loadSprite("bush", "/assets/bush.png?v=3", { singular: true });
k.loadSprite("palm", "/assets/palm.png?v=3", { singular: true });
k.loadSprite("window", "/assets/window.png?v=4", { singular: true });
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

function ipohHour() {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date()).find((part) => part.type === "hour");
  return Number(hour?.value ?? 0);
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

  const WIN_SCALE = 1.5;
  const WIN_W = 22 * WIN_SCALE;
  const WIN_Y = 2;
  const WIN_XS = [94, 130];
  const BODY = 6;
  const GLASS = WIN_XS.map((x) => ({
    x: x + 2 * WIN_SCALE,
    y: WIN_Y + 2 * WIN_SCALE,
    w: 18 * WIN_SCALE,
    h: 12 * WIN_SCALE,
  }));

  for (const x of WIN_XS) {
    k.add([k.sprite("window"), k.pos(x, WIN_Y), k.scale(WIN_SCALE), k.z(3)]);
  }

  const skyPanes = GLASS.map((glass) =>
    k.add([
      k.rect(glass.w, glass.h),
      k.pos(glass.x, glass.y),
      k.color(120, 180, 220),
      k.z(4),
    ]),
  );

  const sun = k.add([
    k.rect(BODY, BODY),
    k.pos(0, 0),
    k.color(255, 214, 74),
    k.z(4.1),
    k.opacity(0),
  ]);
  const moon = k.add([
    k.rect(BODY, BODY),
    k.pos(0, 0),
    k.color(240, 244, 255),
    k.z(4.1),
    k.opacity(0),
  ]);

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
    return [28, 34, 62];
  }

  function bodyInGlass(x, y) {
    return GLASS.some(
      (glass) =>
        x >= glass.x &&
        x <= glass.x + glass.w - BODY &&
        y >= glass.y &&
        y <= glass.y + glass.h - BODY,
    );
  }

  function updateSky() {
    const hour = ipohHour();
    const tone = skyTone(hour);
    for (const pane of skyPanes) {
      pane.color = k.rgb(tone[0], tone[1], tone[2]);
    }
    const span0 = GLASS[0].x;
    const span1 = GLASS[1].x + GLASS[1].w - BODY;
    const day = hour >= 6 && hour < 18;
    const t = day ? (hour - 6) / 12 : ((hour + 6) % 24) / 12;
    const x = Math.round(span0 + t * (span1 - span0));
    const yLow = GLASS[0].y + GLASS[0].h - BODY - 1;
    const yHigh = GLASS[0].y + 1;
    const y = Math.round(yLow - Math.sin(t * Math.PI) * (yLow - yHigh));
    const visible = bodyInGlass(x, y);
    sun.pos = k.vec2(x, y);
    moon.pos = k.vec2(x, y);
    sun.opacity = day && visible ? 1 : 0;
    moon.opacity = !day && visible ? 1 : 0;
  }

  updateSky();
  let lastHour = ipohHour();
  k.onUpdate(() => {
    const hour = ipohHour();
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

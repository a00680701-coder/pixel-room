import kaplay from "kaplay";
import { TILE } from "./sprites.js";
import {
  consumeAction,
  initTouchControls,
  isTouchPreferred,
  setInteractHint,
  showToast,
  touchInput,
} from "./touch-controls.js";

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
  root: document.querySelector("#game-root"),
});

const INTERACT_GAP = 24;

k.setBackground(18, 14, 22);
k.setGravity(0);
k.debug.inspect = true;
k.debug.showLog = false;

k.loadSprite("goose", "/assets/goose.png", { singular: true });
k.loadSprite("cabinet", "/assets/cabinet.png", { singular: true });
k.loadSprite("bookcase", "/assets/bookcase.png?v=6", { singular: true });
k.loadSprite("bush", "/assets/bush.png?v=2", { singular: true });
k.loadSprite("palm", "/assets/palm.png?v=2", { singular: true });
k.loadSprite("window", "/assets/window.png", { singular: true });
k.loadSprite("floor", "/assets/floor.png", { singular: true });
k.loadSprite("wall-n", "/assets/wall-n.png", { singular: true });
k.loadSprite("wall-n-l", "/assets/wall-n-l.png", { singular: true });
k.loadSprite("wall-n-r", "/assets/wall-n-r.png", { singular: true });
k.loadSprite("wall-base", "/assets/wall-base.png", { singular: true });
k.loadSprite("wall-base-l", "/assets/wall-base-l.png", { singular: true });
k.loadSprite("wall-base-r", "/assets/wall-base-r.png", { singular: true });
k.loadSprite("desk", "/assets/desk.png?v=2", { singular: true });
k.loadSprite("record-player", "/assets/record-player.png?v=2", { singular: true });

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

function addSolid(name, x, y, hit, prompt) {
  const bottom = y + hit.y + hit.h;
  const comps = [
    k.sprite(name),
    k.pos(x, y),
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
  let best = null;
  let bestGap = INTERACT_GAP;

  for (const obj of k.get("interact")) {
    const gap = gapToHit(player, obj, hitX);
    if (gap <= bestGap) {
      best = obj;
      bestGap = gap;
    }
  }

  return best;
}

function drawAreaOutline(obj, color) {
  if (typeof obj.worldArea !== "function") {
    return;
  }

  const poly = obj.worldArea();
  k.drawPolygon({
    pts: poly.pts,
    fill: false,
    outline: { width: 1, color },
    opacity: 1,
  });
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

  k.add([k.sprite("window"), k.pos(112, 8), k.z(3)]);
  k.add([k.sprite("window"), k.pos(128, 8), k.z(3)]);

  addSolid("cabinet", 16, 10, { x: 8, y: 54, w: 32, h: 18 }, "衣櫃裡疊著換季的衣服。");
  addSolid("bookcase", 192, 24, { x: 2, y: 28, w: 28, h: 10 }, "書櫃上排滿舊筆記與繪本。");

  addSolid("palm", 22, 174, { x: 3, y: 24, w: 13, h: 8 }, "盆栽的葉子摸起來涼涼的。");
  addSolid("bush", 204, 175, { x: 6, y: 24, w: 12, h: 8 }, "這叢綠意把角落填得很滿。");
  addSolid("bush", 68, 33, { x: 6, y: 24, w: 12, h: 8 }, "這叢綠意把角落填得很滿。");
  addSolid("palm", 148, 68, { x: 3, y: 24, w: 13, h: 8 }, "盆栽的葉子摸起來涼涼的。");
  addSolid("bush", 112, 195, { x: 6, y: 24, w: 12, h: 8 }, "這叢綠意把角落填得很滿。");

  addSolid("desk", 22, 104, { x: 1, y: 13, w: 26, h: 8 }, "桌上攤著筆記本，旁邊擱了一支筆。");

  addSolid("record-player", 184, 118, { x: 2, y: 19, w: 20, h: 8 }, "唱片機輕輕轉了一下，發出沙沙聲。");

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
    const hitX = gooseHitX(goose.flipX);
    const target = nearestInteract(player, hitX);
    if (!target) {
      return;
    }
    showToast(target.prompt);
  };

  k.onKeyPress("e", tryInteract);
  k.onKeyPress("space", tryInteract);

  const onWindowInteract = (event) => {
    if (event.repeat) {
      return;
    }
    if (event.code === "KeyE" || event.code === "Space") {
      tryInteract();
    }
  };
  window.addEventListener("keydown", onWindowInteract);
  k.onSceneLeave(() => {
    window.removeEventListener("keydown", onWindowInteract);
  });

  k.onUpdate(() => {
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

  k.onDraw(() => {
    for (const obj of k.get("wall")) {
      drawAreaOutline(obj, k.rgb(80, 170, 255));
    }
    for (const obj of k.get("solid")) {
      drawAreaOutline(obj, k.rgb(40, 230, 90));
    }
    for (const obj of k.get("player")) {
      drawAreaOutline(obj, k.rgb(255, 60, 70));
    }
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

k.onLoad(() => {
  k.go("room");
});

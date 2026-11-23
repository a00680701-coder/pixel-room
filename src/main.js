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
import { supabase } from "./supabase.js";

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
const PLANTS_STORE_KEY = "pixel-room-plants";
const PLANTS_BOX_ID = "c0ffee00-1111-4111-8111-00000000b002";
const PLANTS_BOX_TITLE = "\u001fplant-box";
const DEFAULT_PLANTS = [
  { id: "plant-1", name: "palm", x: 22, y: 174, hit: { x: 3, y: 24, w: 13, h: 8 } },
  { id: "plant-2", name: "bush", x: 204, y: 175, hit: { x: 6, y: 24, w: 12, h: 8 } },
  { id: "plant-3", name: "bush", x: 68, y: 33, hit: { x: 6, y: 24, w: 12, h: 8 } },
  { id: "plant-4", name: "palm", x: 148, y: 68, hit: { x: 3, y: 24, w: 13, h: 8 } },
  { id: "plant-5", name: "bush", x: 112, y: 195, hit: { x: 6, y: 24, w: 12, h: 8 } },
];

k.setBackground(18, 14, 22);
k.setGravity(0);
k.debug.inspect = false;
k.debug.showLog = false;

k.loadSprite("goose", "/assets/goose.png", { singular: true });
k.loadSprite("cabinet", "/assets/cabinet.png?v=4", { singular: true });
k.loadSprite("bookcase", "/assets/bookcase.png?v=7", { singular: true });
k.loadSprite("bush", "/assets/bush.png?v=3", { singular: true });
k.loadSprite("palm", "/assets/palm.png?v=3", { singular: true });
k.loadSprite("window", "/assets/window.png?v=11", { singular: true });
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
  const wall = k.add([
    k.pos(x, y),
    k.area({ shape: new k.Rect(k.vec2(0, 0), w, h) }),
    k.body({ isStatic: true }),
    k.z(-1),
    "wall",
  ]);
  wall.hit = { x: 0, y: 0, w, h };
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

  if (prompt || kind === "plant") {
    comps.push("interact");
  }

  const obj = k.add(comps);
  obj.hit = hit;
  obj.spriteName = name;
  if (prompt) {
    obj.prompt = prompt;
  }
  if (kind) {
    obj.kind = kind;
  }
  return obj;
}

function unionHit(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

function plantCarryLocal(plant, facing) {
  const hit = plant.hit;
  const cx = hit.x + hit.w / 2;
  const potBottom = hit.y + hit.h;
  if (facing === "left") {
    return k.vec2(-hit.x - hit.w - 2, HIT_Y + HIT_H - potBottom);
  }
  if (facing === "right") {
    return k.vec2(HIT_W / 2 - hit.x + 4, HIT_Y + HIT_H - potBottom);
  }
  if (facing === "up") {
    return k.vec2(-cx, HIT_Y - potBottom - 2);
  }
  return k.vec2(-cx, HIT_Y + HIT_H - hit.y);
}

function carriedPlantHit(plant, facing) {
  const local = plantCarryLocal(plant, facing);
  return {
    x: local.x + plant.hit.x,
    y: local.y + plant.hit.y,
    w: plant.hit.w,
    h: plant.hit.h,
  };
}

function playerMoveHit(hitX, carrying, facing) {
  const gooseHit = { x: hitX, y: HIT_Y, w: HIT_W, h: HIT_H };
  if (!carrying) {
    return gooseHit;
  }
  return unionHit(gooseHit, carriedPlantHit(carrying, facing));
}

function aabbOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function solidWorldHit(obj) {
  if (obj.hit) {
    const sx = Number(obj.scale?.x ?? 1);
    const sy = Number(obj.scale?.y ?? 1);
    return {
      x: obj.pos.x + obj.hit.x * sx,
      y: obj.pos.y + obj.hit.y * sy,
      w: obj.hit.w * sx,
      h: obj.hit.h * sy,
    };
  }
  const shape = obj.area?.shape;
  const ox = shape?.pos?.x ?? 0;
  const oy = shape?.pos?.y ?? 0;
  const w = shape?.width ?? 0;
  const h = shape?.height ?? 0;
  return { x: obj.pos.x + ox, y: obj.pos.y + oy, w, h };
}

function carryBlocked(player, hitX, carrying, facing) {
  if (!carrying) {
    return false;
  }
  const rel = playerMoveHit(hitX, carrying, facing);
  const box = {
    x: player.pos.x + rel.x,
    y: player.pos.y + rel.y,
    w: rel.w,
    h: rel.h,
  };
  for (const tag of ["solid", "wall"]) {
    for (const obj of k.get(tag)) {
      if (obj === player || obj === carrying || obj.carried) {
        continue;
      }
      const other = solidWorldHit(obj);
      if (other.w > 0 && other.h > 0 && aabbOverlap(box, other)) {
        return true;
      }
    }
  }
  return false;
}

function snapshotPlants(plants) {
  return plants.map((plant) => ({
    id: plant.plantId,
    x: Math.round(plant.pos.x),
    y: Math.round(plant.pos.y),
  }));
}

function applyPlantSnapshot(plants, rows, skip) {
  if (!Array.isArray(rows)) {
    return;
  }
  for (const row of rows) {
    const plant = plants.find((item) => item.plantId === row.id);
    if (!plant || plant === skip) {
      continue;
    }
    const x = Math.round(Number(row.x));
    const y = Math.round(Number(row.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    plant.pos = k.vec2(
      k.clamp(x, TILE, GAME_SIZE - TILE - 20),
      k.clamp(y, TILE, GAME_SIZE - TILE - 20),
    );
    plant.z = plant.pos.y + plant.hit.y + plant.hit.h;
  }
}

function readLocalPlants() {
  try {
    return JSON.parse(localStorage.getItem(PLANTS_STORE_KEY) || "null");
  } catch {
    return null;
  }
}

function writeLocalPlants(plants) {
  localStorage.setItem(PLANTS_STORE_KEY, JSON.stringify(snapshotPlants(plants)));
}

async function persistPlants(plants) {
  const payload = snapshotPlants(plants);
  localStorage.setItem(PLANTS_STORE_KEY, JSON.stringify(payload));
  try {
    await supabase.from("diaries").upsert(
      {
        id: PLANTS_BOX_ID,
        date: "plant-box",
        title: PLANTS_BOX_TITLE,
        content: JSON.stringify(payload),
      },
      { onConflict: "id" },
    );
  } catch {
    /* local cache still holds the layout */
  }
}

async function loadCloudPlants(plants, skip) {
  applyPlantSnapshot(plants, readLocalPlants(), skip);
  try {
    const { data, error } = await supabase
      .from("diaries")
      .select("id, content")
      .eq("id", PLANTS_BOX_ID)
      .maybeSingle();
    if (error || !data?.content) {
      if (plants.length) {
        await persistPlants(plants);
      }
      return;
    }
    applyPlantSnapshot(plants, JSON.parse(data.content), skip);
    writeLocalPlants(plants);
  } catch {
    /* keep local / default positions */
  }
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

function nearestInteract(player, hitX, skip = null) {
  const found = [];

  for (const obj of k.get("interact")) {
    if (obj === skip || obj.carried) {
      continue;
    }
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
  const WIN_H = 15;
  const WIN_X = Math.round((GAME_SIZE - WIN_W) / 2);
  const WIN_Y = 9;
  const WIN_FRAME = 2;
  const RADIUS = 4;
  const glass = {
    x: WIN_X + WIN_FRAME,
    y: WIN_Y + WIN_FRAME,
    w: WIN_W - WIN_FRAME * 2,
    h: WIN_H - WIN_FRAME * 2,
  };

  k.add([k.sprite("window"), k.pos(WIN_X, WIN_Y), k.z(5)]);

  const skyPane = k.add([
    k.rect(glass.w, glass.h),
    k.pos(glass.x, glass.y),
    k.color(120, 180, 220),
    k.z(4),
  ]);

  const IPOH_LAT = 4.5975;
  const IPOH_LON = 101.0901;
  let weatherKind = "cloudy";
  let flashTimer = 10;

  function weatherFromCode(code) {
    const n = Number(code);
    if (n === 0) {
      return "clear";
    }
    if (n === 1 || n === 2) {
      return "cloudy";
    }
    if ([51, 53, 56, 61, 66, 80].includes(n)) {
      return "rain";
    }
    if ([55, 57, 63, 65, 67, 81, 82, 95, 96, 99].includes(n)) {
      return "storm";
    }
    return "overcast";
  }

  function mixRgb(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ];
  }

  function skyToneForWeather(hour, kind) {
    const base = skyTone(hour);
    if (kind === "clear") {
      return base;
    }
    if (kind === "cloudy") {
      return mixRgb(base, [176, 188, 200], 0.28);
    }
    if (kind === "overcast") {
      const day = hour >= 6 && hour < 18;
      return mixRgb(base, day ? [236, 240, 244] : [148, 158, 170], day ? 0.42 : 0.62);
    }
    if (kind === "rain") {
      const day = hour >= 6 && hour < 18;
      return mixRgb(base, day ? [214, 224, 232] : [110, 128, 148], day ? 0.34 : 0.68);
    }
    return mixRgb(base, [58, 68, 82], 0.78);
  }

  const cloudSpecs = [
    { x: 4, y: 1, speed: 0.42, parts: [[0, 2, 11, 3], [2, 0, 8, 3]] },
    { x: 22, y: 4, speed: 0.28, parts: [[0, 2, 14, 3], [3, 0, 9, 3], [8, 1, 8, 3]] },
    { x: 38, y: 2, speed: 0.36, parts: [[0, 2, 10, 3], [2, 0, 7, 3]] },
    { x: 10, y: 6, speed: 0.22, parts: [[0, 1, 16, 3], [4, 0, 10, 3]] },
  ];
  const cloudParts = cloudSpecs.map((spec) => ({
    spec,
    bits: spec.parts.map(([px, py, pw, ph]) =>
      k.add([
        k.rect(pw, ph),
        k.pos(glass.x, glass.y),
        k.color(244, 244, 248),
        k.z(4.28),
        k.opacity(0),
      ]),
    ),
  }));

  const rainDrops = Array.from({ length: 22 }, (_, i) => ({
    x: (i * 7) % glass.w,
    y: (i * 5) % glass.h,
    homeX: (i * 7) % glass.w,
    len: i % 3 === 0 ? 3 : 2,
    obj: k.add([
      k.rect(1, 3),
      k.pos(glass.x, glass.y),
      k.color(180, 210, 230),
      k.z(4.36),
      k.opacity(0),
    ]),
  }));

  const bolt = [
    [24, 1, 3, 2],
    [22, 3, 3, 2],
    [20, 5, 3, 2],
    [18, 7, 4, 2],
  ].map(([bx, by, bw, bh]) =>
    k.add([
      k.rect(bw, bh),
      k.pos(glass.x + bx, glass.y + by),
      k.color(255, 230, 90),
      k.z(4.42),
      k.opacity(0),
    ]),
  );

  const flash = k.add([
    k.rect(glass.w, glass.h),
    k.pos(glass.x, glass.y),
    k.color(255, 252, 230),
    k.z(4.44),
    k.opacity(0),
  ]);

  function paintClouds(kind, night) {
    const show = kind === "cloudy" || kind === "overcast" || kind === "rain" || kind === "storm";
    const tint = night
      ? kind === "storm"
        ? [70, 78, 92]
        : [120, 128, 148]
      : kind === "storm"
        ? [108, 116, 128]
        : kind === "overcast"
          ? [232, 236, 242]
          : kind === "rain"
            ? [210, 216, 224]
            : [248, 248, 252];
    const count = kind === "cloudy" ? 2 : show ? 4 : 0;
    cloudParts.forEach((cloud, index) => {
      for (const bit of cloud.bits) {
        bit.color = k.rgb(tint[0], tint[1], tint[2]);
        bit.opacity = index < count ? 1 : 0;
      }
    });
  }

  function stepWeather(dt) {
    const { hour } = ipohParts();
    const night = hour < 6 || hour >= 19;
    const storm = weatherKind === "storm";
    const cloudCount = weatherKind === "clear" ? 0 : weatherKind === "cloudy" ? 2 : 4;

    cloudParts.forEach((cloud, index) => {
      if (index >= cloudCount) {
        for (const bit of cloud.bits) {
          bit.opacity = 0;
        }
        return;
      }
      cloud.spec.x += cloud.spec.speed * dt;
      const cloudW = Math.max(...cloud.spec.parts.map((part) => part[0] + part[2]));
      if (cloud.spec.x > glass.w) {
        cloud.spec.x = -cloudW;
      }
      cloud.spec.parts.forEach((part, p) => {
        const bit = cloud.bits[p];
        const lx = Math.round(cloud.spec.x + part[0]);
        const ly = Math.round(cloud.spec.y + part[1]);
        const inside =
          lx >= 0 && ly >= 0 && lx + part[2] <= glass.w && ly + part[3] <= glass.h;
        bit.opacity = inside ? 1 : 0;
        bit.pos = k.vec2(glass.x + lx, glass.y + ly);
      });
    });

    const dropCount = storm ? 22 : weatherKind === "rain" ? 12 : 0;
    const fall = storm ? 36 : 22;
    rainDrops.forEach((drop, index) => {
      if (index >= dropCount) {
        drop.obj.opacity = 0;
        return;
      }
      drop.x = drop.homeX;
      drop.y += fall * dt;
      if (drop.y > glass.h) {
        drop.y = -drop.len;
      }
      const visible = drop.y >= 0 && drop.y + drop.len <= glass.h;
      drop.obj.opacity = visible ? (storm ? 0.95 : 0.8) : 0;
      drop.obj.height = drop.len;
      drop.obj.pos = k.vec2(Math.round(glass.x + drop.x), Math.round(glass.y + drop.y));
      drop.obj.color = k.rgb(night ? 140 : 190, night ? 180 : 220, night ? 210 : 240);
    });

    if (storm) {
      flashTimer -= dt;
      if (flashTimer <= 0) {
        flash.opacity = 0.72;
        for (const bit of bolt) {
          bit.opacity = 1;
        }
        flashTimer = 8 + Math.random() * 12;
      } else {
        flash.opacity = Math.max(0, flash.opacity - dt * 3.4);
        if (flash.opacity < 0.08) {
          for (const bit of bolt) {
            bit.opacity = 0;
          }
        }
      }
    } else {
      flash.opacity = 0;
      for (const bit of bolt) {
        bit.opacity = 0;
      }
    }

  }

  async function fetchIpohWeather() {
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${IPOH_LAT}&longitude=${IPOH_LON}&current=weather_code&timezone=Asia%2FKuala_Lumpur`,
      );
      const json = await res.json();
      const next = weatherFromCode(json?.current?.weather_code);
      if (next !== weatherKind) {
        weatherKind = next;
        updateSky();
      }
    } catch {
      /* keep last weather */
    }
  }

  const starDots = [
    [5, 2],
    [11, 6],
    [18, 3],
    [24, 8],
    [31, 2],
    [38, 5],
    [44, 9],
    [8, 7],
    [47, 4],
    [27, 1],
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
    const tone = skyToneForWeather(hour, weatherKind);
    skyPane.color = k.rgb(tone[0], tone[1], tone[2]);
    const day = hour >= 6 && hour < 18;
    const night = hour < 6 || hour >= 19;
    const t = day ? (hour - 6) / 12 : ((hour + 6) % 24) / 12;
    const cx = Math.round(glass.x + RADIUS + 1 + t * (glass.w - RADIUS * 2 - 2));
    const yLow = glass.y + glass.h - RADIUS - 2;
    const yHigh = glass.y + RADIUS + 1;
    const cy = Math.round(yLow - Math.sin(t * Math.PI) * (yLow - yHigh));
    const visible = bodyInGlass(cx, cy);
    const bodyOk = weatherKind === "clear" || weatherKind === "cloudy";
    sun.pos = k.vec2(cx, cy);
    moon.pos = k.vec2(cx, cy);
    sun.hidden = !(day && visible && bodyOk);
    moon.hidden = !(!day && visible && bodyOk);

    const phase = moonPhaseFrac();
    for (const cell of moonDots) {
      const lit = discLit(cell.dx, cell.dy, phase);
      cell.obj.hidden = lit !== true;
      if (lit === true) {
        cell.obj.color = k.rgb(240, 244, 255);
      }
    }

    const showStars = night && (weatherKind === "clear" || weatherKind === "cloudy");
    for (const star of starDots) {
      star.opacity = showStars ? 1 : 0;
    }
    paintClouds(weatherKind, night);
  }

  updateSky();
  void fetchIpohWeather();
  setInterval(() => {
    void fetchIpohWeather();
  }, 10 * 60 * 1000);

  let lastHour = ipohParts().hour;
  k.onUpdate(() => {
    const hour = ipohParts().hour;
    if (hour !== lastHour) {
      lastHour = hour;
      updateSky();
    }
    const dt = typeof k.dt === "function" ? k.dt() : 1 / 60;
    stepWeather(Math.min(dt || 1 / 60, 0.05));
  });

  addSolid("cabinet", 18, 16, { x: 4, y: 48, w: 40, h: 14 }, "衣櫃裡疊著換季的衣服。");
  addSolid("bookcase", 184, 16, { x: 2, y: 28, w: 28, h: 10 }, "書櫃上排滿舊筆記與繪本。", null, 1.4);

  const plants = DEFAULT_PLANTS.map((spec) => {
    const plant = addSolid(spec.name, spec.x, spec.y, spec.hit, null, "plant");
    plant.plantId = spec.id;
    plant.carried = false;
    return plant;
  });
  applyPlantSnapshot(plants, readLocalPlants(), null);
  void loadCloudPlants(plants, null);

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
  let carrying = null;
  let plantSaveTimer = 0;
  let lastInteractAt = 0;

  function setCarriedCollision(enabled) {
    if (!carrying) {
      return;
    }
    if (enabled) {
      carrying.carried = false;
      if (!carrying.area) {
        carrying.use(
          k.area({
            shape: new k.Rect(
              k.vec2(carrying.hit.x, carrying.hit.y),
              carrying.hit.w,
              carrying.hit.h,
            ),
          }),
        );
      } else {
        carrying.area.enabled = true;
      }
      if (!carrying.body) {
        carrying.use(k.body({ isStatic: true }));
      }
      return;
    }
    carrying.carried = true;
    if (carrying.body) {
      carrying.unuse("body");
    }
    if (carrying.area) {
      carrying.area.enabled = false;
      carrying.unuse("area");
    }
  }

  function followCarriedPlant() {
    if (!carrying) {
      return;
    }
    const local = plantCarryLocal(carrying, facing);
    carrying.pos = k.vec2(
      Math.round(player.pos.x + local.x),
      Math.round(player.pos.y + local.y),
    );
    carrying.z = player.z + 8;
  }

  function pickPlant(plant) {
    if (carrying || !plant || plant.kind !== "plant") {
      return;
    }
    carrying = plant;
    setCarriedCollision(false);
    if (player.body) {
      player.unuse("body");
    }
    player.vel = k.vec2(0, 0);
    followCarriedPlant();
    showToast("拿著盆栽。走到空地再點一下放下。");
  }

  function dropPlant() {
    if (!carrying) {
      return;
    }
    const plant = carrying;
    followCarriedPlant();
    carrying = null;
    plant.carried = false;
    if (!plant.area) {
      plant.use(
        k.area({
          shape: new k.Rect(k.vec2(plant.hit.x, plant.hit.y), plant.hit.w, plant.hit.h),
        }),
      );
    } else {
      plant.area.enabled = true;
    }
    if (!plant.body) {
      plant.use(k.body({ isStatic: true }));
    }
    if (!player.body) {
      player.use(k.body());
      player.gravityScale = 0;
    }
    player.vel = k.vec2(0, 0);
    plant.z = plant.pos.y + plant.hit.y + plant.hit.h;
    showToast("放下盆栽。");
    clearTimeout(plantSaveTimer);
    plantSaveTimer = setTimeout(() => {
      void persistPlants(plants);
    }, 200);
  }

  const tryInteract = () => {
    if (isGamePaused()) {
      return;
    }
    const now = performance.now();
    if (now - lastInteractAt < 220) {
      return;
    }
    lastInteractAt = now;
    const hitX = gooseHitX(goose.flipX);
    const target = nearestInteract(player, hitX, carrying);

    if (carrying) {
      if (target && target.kind !== "plant") {
        if (target.kind === "diary") {
          openDiary();
          return;
        }
        showToast(target.prompt);
        return;
      }
      dropPlant();
      return;
    }

    if (!target) {
      return;
    }
    if (target.kind === "plant") {
      pickPlant(target);
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
    const prevFacing = facing;

    if (moving) {
      if (Math.abs(dir.x) > Math.abs(dir.y)) {
        facing = dir.x < 0 ? "left" : "right";
      } else {
        facing = dir.y < 0 ? "up" : "down";
      }
    }

    if (facing === "left") goose.flipX = false;
    if (facing === "right") goose.flipX = true;

    let hitX = gooseHitX(goose.flipX);
    const gooseHit = { x: hitX, y: HIT_Y, w: HIT_W, h: HIT_H };
    player.area.shape = new k.Rect(k.vec2(gooseHit.x, gooseHit.y), gooseHit.w, gooseHit.h);
    player.vel = k.vec2(0, 0);

    if (carrying && carryBlocked(player, hitX, carrying, facing)) {
      facing = prevFacing;
      if (facing === "left") goose.flipX = false;
      if (facing === "right") goose.flipX = true;
      hitX = gooseHitX(goose.flipX);
      gooseHit.x = hitX;
      player.area.shape = new k.Rect(k.vec2(gooseHit.x, gooseHit.y), gooseHit.w, gooseHit.h);
    }

    const prevX = player.pos.x;
    const prevY = player.pos.y;
    if (moving) {
      if (carrying) {
        const dt = typeof k.dt === "function" ? k.dt() : k.dt;
        const step = dir.unit().scale(SPEED * dt);
        player.pos.x += step.x;
        player.pos.y += step.y;
      } else {
        player.move(dir.unit().scale(SPEED));
      }
    }
    player.vel = k.vec2(0, 0);

    const moveHit = playerMoveHit(hitX, carrying, facing);
    const minX = TILE - moveHit.x;
    const maxX = GAME_SIZE - TILE - (moveHit.x + moveHit.w);
    const minY = TILE * 2 - moveHit.y;
    const maxY = GAME_SIZE - TILE - (moveHit.y + moveHit.h);

    player.pos.x = Math.round(k.clamp(player.pos.x, minX, maxX));
    player.pos.y = Math.round(k.clamp(player.pos.y, minY, maxY));

    if (carrying) {
      const nx = player.pos.x;
      const ny = player.pos.y;
      player.pos.x = prevX;
      player.pos.y = ny;
      if (carryBlocked(player, hitX, carrying, facing)) {
        player.pos.y = prevY;
      }
      player.pos.x = nx;
      if (carryBlocked(player, hitX, carrying, facing)) {
        player.pos.x = prevX;
      }
      player.vel = k.vec2(0, 0);
    }

    goose.pos.y = -4 + (moving ? Math.round(Math.sin(k.time() * 14)) : 0);
    player.z = player.pos.y + HIT_Y + HIT_H;
    followCarriedPlant();

    const near = nearestInteract(player, hitX, carrying);
    setInteractHint(Boolean(near) || Boolean(carrying));

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

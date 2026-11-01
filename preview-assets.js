import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "__MACOSX"]);

function parseArgs(argv) {
  const args = argv.slice(2).filter((item) => item !== "--");
  const assetsDir = path.resolve(args[0] ?? "開源軟件");
  const outputFile = path.resolve(args[1] ?? "gallery.html");
  return { assetsDir, outputFile };
}

function walkPngs(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    console.warn(`跳過無法讀取的資料夾：${dir} (${error.message})`);
    return acc;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkPngs(fullPath, acc);
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".png") &&
      !entry.name.startsWith("._")
    ) {
      acc.push(fullPath);
    }
  }

  return acc;
}

function readPngSize(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(24);
    const bytesRead = fs.readSync(fd, header, 0, 24, 0);
    if (bytesRead < 24 || !header.subarray(0, 8).equals(PNG_MAGIC)) {
      return null;
    }
    return {
      width: header.readUInt32BE(16),
      height: header.readUInt32BE(20),
    };
  } finally {
    fs.closeSync(fd);
  }
}

function toPosix(relPath) {
  return relPath.split(path.sep).join("/");
}

function toSrc(relPath) {
  return relPath.split("/").map(encodeURIComponent).join("/");
}

function buildGalleryHtml(assets, scannedDir, generatedAt) {
  const payload = JSON.stringify(assets).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pixel Asset Gallery</title>
    <style>
      :root {
        --bg: #0d0b12;
        --panel: #17141f;
        --card: #211c2c;
        --line: #3a3148;
        --text: #f2ead8;
        --muted: #b8ad96;
        --accent: #7dffb3;
      }

      * { box-sizing: border-box; }

      html, body {
        margin: 0;
        min-height: 100%;
        background: var(--bg);
        color: var(--text);
        font-family: "Segoe UI", "Noto Sans TC", sans-serif;
      }

      body {
        padding: 24px;
      }

      h1 {
        margin: 0 0 8px;
        font-size: 22px;
        letter-spacing: 0.04em;
      }

      .meta, .hint {
        color: var(--muted);
        font-size: 14px;
        margin: 0 0 12px;
      }

      .toolbar {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        align-items: center;
        margin: 16px 0 20px;
      }

      .pager {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .pager button {
        padding: 8px 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        color: var(--text);
        cursor: pointer;
      }

      .pager button:disabled {
        opacity: 0.4;
        cursor: default;
      }

      input[type="search"] {
        width: min(420px, 100%);
        padding: 10px 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        color: var(--text);
        font-size: 14px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 14px;
      }

      .card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 10px;
        cursor: pointer;
        text-align: left;
        color: inherit;
        min-width: 0;
      }

      .card:hover,
      .card:focus-visible {
        border-color: var(--accent);
        outline: none;
      }

      .preview {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 96px;
        max-height: 180px;
        overflow: auto;
        background:
          linear-gradient(45deg, #2a2436 25%, transparent 25%),
          linear-gradient(-45deg, #2a2436 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #2a2436 75%),
          linear-gradient(-45deg, transparent 75%, #2a2436 75%);
        background-size: 16px 16px;
        background-position: 0 0, 0 8px, 8px -8px, -8px 0;
        background-color: #16121d;
        border-radius: 6px;
      }

      .preview img {
        image-rendering: pixelated;
        image-rendering: crisp-edges;
        flex: 0 0 auto;
      }

      .name, .path {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .name {
        font-weight: 700;
        font-size: 13px;
      }

      .size {
        color: var(--accent);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }

      .path {
        color: var(--muted);
        font-size: 11px;
      }

      .empty {
        color: var(--muted);
        padding: 32px 0;
      }

      .toast {
        position: fixed;
        right: 20px;
        bottom: 20px;
        padding: 10px 14px;
        background: #113322;
        color: var(--accent);
        border: 1px solid var(--accent);
        border-radius: 8px;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 160ms ease, transform 160ms ease;
        pointer-events: none;
      }

      .toast.show {
        opacity: 1;
        transform: translateY(0);
      }
    </style>
  </head>
  <body>
    <h1>Pixel Asset Gallery</h1>
    <p class="meta">掃描資料夾：${escapeHtml(scannedDir)}　｜　${assets.length} 張 PNG　｜　產生於 ${escapeHtml(generatedAt)}</p>
    <p class="hint">圖片以 3 倍像素放大、保持銳利。點擊卡片會複製相對路徑。</p>
    <div class="toolbar">
      <input id="search" type="search" placeholder="搜尋檔名或路徑…" />
      <span id="count">${assets.length} 張</span>
      <div class="pager">
        <button id="prev" type="button">上一頁</button>
        <span id="pageLabel">1 / 1</span>
        <button id="next" type="button">下一頁</button>
      </div>
    </div>
    <div id="grid" class="grid"></div>
    <p id="empty" class="empty" hidden>沒有符合的圖片。</p>
    <div id="toast" class="toast">已複製路徑</div>
    <script>
      const ASSETS = ${payload};
      const SCALE = 3;
      const PAGE_SIZE = 72;
      const grid = document.getElementById("grid");
      const empty = document.getElementById("empty");
      const count = document.getElementById("count");
      const toast = document.getElementById("toast");
      const search = document.getElementById("search");
      const prev = document.getElementById("prev");
      const next = document.getElementById("next");
      const pageLabel = document.getElementById("pageLabel");
      let toastTimer = 0;
      let filtered = ASSETS;
      let page = 1;

      function showToast(message) {
        toast.textContent = message;
        toast.classList.add("show");
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1400);
      }

      async function copyPath(value) {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          const area = document.createElement("textarea");
          area.value = value;
          document.body.appendChild(area);
          area.select();
          document.execCommand("copy");
          area.remove();
        }
        showToast("已複製：" + value);
      }

      function render() {
        const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        page = Math.min(Math.max(1, page), totalPages);
        const start = (page - 1) * PAGE_SIZE;
        const list = filtered.slice(start, start + PAGE_SIZE);

        grid.replaceChildren();
        count.textContent = filtered.length + " 張";
        pageLabel.textContent = page + " / " + totalPages;
        prev.disabled = page <= 1;
        next.disabled = page >= totalPages;
        empty.hidden = filtered.length > 0;

        const fragment = document.createDocumentFragment();
        for (const asset of list) {
          const card = document.createElement("button");
          card.type = "button";
          card.className = "card";
          card.title = "點擊複製 " + asset.path;

          const preview = document.createElement("div");
          preview.className = "preview";
          const img = document.createElement("img");
          img.alt = asset.name;
          img.loading = "lazy";
          img.src = asset.src;
          img.width = asset.width * SCALE;
          img.height = asset.height * SCALE;
          preview.appendChild(img);

          const name = document.createElement("div");
          name.className = "name";
          name.textContent = asset.name;

          const size = document.createElement("div");
          size.className = "size";
          size.textContent = asset.width + " × " + asset.height + " px";

          const pathLabel = document.createElement("div");
          pathLabel.className = "path";
          pathLabel.textContent = asset.path;

          card.append(preview, name, size, pathLabel);
          card.addEventListener("click", () => copyPath(asset.path));
          fragment.appendChild(card);
        }
        grid.appendChild(fragment);
      }

      function applyFilter() {
        const query = search.value.trim().toLowerCase();
        filtered = query
          ? ASSETS.filter((asset) => (
              asset.name.toLowerCase().includes(query) ||
              asset.path.toLowerCase().includes(query)
            ))
          : ASSETS;
        page = 1;
        render();
      }

      search.addEventListener("input", applyFilter);
      prev.addEventListener("click", () => { page -= 1; render(); window.scrollTo(0, 0); });
      next.addEventListener("click", () => { page += 1; render(); window.scrollTo(0, 0); });
      render();
    </script>
  </body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function main() {
  const { assetsDir, outputFile } = parseArgs(process.argv);

  if (!fs.existsSync(assetsDir) || !fs.statSync(assetsDir).isDirectory()) {
    console.error(`找不到資料夾：${assetsDir}`);
    process.exit(1);
  }

  const files = walkPngs(assetsDir);
  files.sort((a, b) => a.localeCompare(b, "zh-Hant"));

  const projectRoot = process.cwd();
  const assets = [];
  let skipped = 0;

  for (const filePath of files) {
    const size = readPngSize(filePath);
    if (!size) {
      skipped += 1;
      console.warn(`跳過非標準 PNG：${filePath}`);
      continue;
    }

    const rel = toPosix(path.relative(projectRoot, filePath));
    assets.push({
      name: path.basename(filePath),
      path: rel,
      src: toSrc(rel),
      width: size.width,
      height: size.height,
    });
  }

  const html = buildGalleryHtml(
    assets,
    toPosix(path.relative(projectRoot, assetsDir) || assetsDir),
    new Date().toISOString().slice(0, 19).replace("T", " "),
  );

  fs.writeFileSync(outputFile, html, "utf8");

  console.log(`掃描 ${files.length} 張 PNG，寫入 ${assets.length} 張到 ${outputFile}`);
  if (skipped) {
    console.log(`略過 ${skipped} 張無法讀取尺寸的檔案`);
  }
}

main();

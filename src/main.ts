import { LEVELS } from "./levels";
import { Game, formatTime } from "./game";
import { Editor } from "./editor";
import { storage } from "./storage";
import { STORY_NOTES } from "./story";
import { icon } from "./icons";
import type { LevelDef } from "./types";

const screens = ["menu", "levels", "game", "editor", "scores", "story"] as const;
type Screen = (typeof screens)[number];

let current: Screen = "menu";
let game: Game | null = null;
let editor: Editor | null = null;

// mobile mode: auto = touch device; overridable from the menu
function mobileSetting(): "auto" | "on" | "off" {
  try {
    const s = localStorage.getItem("graviball.mobile");
    if (s === "on" || s === "off") return s;
  } catch {
    /* ignore */
  }
  return "auto";
}

function mobileMode(): boolean {
  const s = mobileSetting();
  if (s === "on") return true;
  if (s === "off") return false;
  return (
    "ontouchstart" in window && matchMedia("(pointer: coarse)").matches
  );
}

function show(screen: Screen) {
  if (screen !== "game" && game) {
    game.destroy();
    game = null;
  }
  for (const s of screens) {
    document
      .querySelector(`#screen-${s}`)!
      .classList.toggle("hidden", s !== screen);
  }
  current = screen;
  document.body.classList.toggle("mobile", screen === "game" && mobileMode());
  if (screen === "levels") renderLevelSelect();
  if (screen === "scores") renderScores();
  if (screen === "story") renderStory();
  if (screen === "editor" && !editor) editor = new Editor();
}

// ---------- Level select ----------

const TOTAL_COINS = LEVELS.reduce((n, l) => n + (l.coins?.length ?? 0), 0);

let levelFocus = 0;

function levelCards(): HTMLElement[] {
  return Array.from(document.querySelectorAll(".level-card"));
}

function setLevelFocus(i: number) {
  const cards = levelCards();
  if (cards.length === 0) return;
  levelFocus = ((i % cards.length) + cards.length) % cards.length;
  cards.forEach((c, j) => c.classList.toggle("focused", j === levelFocus));
  cards[levelFocus].scrollIntoView({ block: "nearest" });
}

// level select keyboard: ↑/↓ navigate, Enter start
window.addEventListener("keydown", (e) => {
  if (current !== "levels") return;
  const cards = levelCards();
  if (cards.length === 0) return;
  if (e.code === "ArrowDown" || e.code === "ArrowUp") {
    e.preventDefault();
    setLevelFocus(levelFocus + (e.code === "ArrowDown" ? 1 : -1));
  } else if (e.code === "Enter" || e.code === "NumpadEnter") {
    e.preventDefault();
    cards[levelFocus].click();
  }
});

function renderLevelSelect() {
  const best = storage.getBest();
  const collected = storage.getCollectedNotes();
  const coinsFound =
    collected.filter((id) => id in STORY_NOTES).length;
  const grid = document.querySelector("#level-grid")!;
  grid.innerHTML = "";
  LEVELS.forEach((level, i) => {
    const b = best[level.id];
    const card = document.createElement("button");
    card.className = "level-card";
    const noteCount = level.notes?.length ?? 0;
    const notesFound = (level.notes ?? []).filter((n) =>
      collected.includes(n.id),
    ).length;
    card.innerHTML = `
      <div class="level-num">${i + 1}</div>
      <div class="level-info">
        <div class="level-name">${level.name}</div>
        <div class="level-desc">${level.description ?? ""}</div>
        <div class="level-meta">
          ${b ? `${icon("clock", 13)} ${formatTime(b.time)} · ${icon("coin", 13)} ${b.coins}/${b.totalCoins}` : "not finished"}
          ${noteCount ? ` · ${icon("note", 13)} ${notesFound}/${noteCount}` : ""}
        </div>
      </div>
      ${b && b.time <= (level.parTime ?? Infinity) ? `<span class="par-badge">${icon("check", 18)}</span>` : ""}
    `;
    card.addEventListener("click", () => startGame(i));
    grid.appendChild(card);
  });

  document
    .querySelector("#levels-coin-count")!
    .innerHTML = `${icon("note", 14)} ${coinsFound}/${Object.keys(STORY_NOTES).length} notes`;
  setLevelFocus(0);

  const custom = document.querySelector("#custom-levels")!;
  custom.innerHTML = "";
  const list = storage.getCustomLevels();
  if (list.length > 0) {
    const h = document.createElement("h3");
    h.textContent = "Your levels";
    custom.appendChild(h);
    for (const c of list) {
      const row = document.createElement("button");
      row.className = "level-card wide";
      row.innerHTML = `
        <div class="level-info">
          <div class="level-name">${icon("star", 16)} ${c.name}</div>
          <div class="level-desc">Custom level</div>
        </div>
      `;
      row.addEventListener("click", () => {
        const level = c.level as LevelDef;
        if (!level.id) level.id = `custom-${c.name}`;
        game = new Game(
          document.querySelector("#game-root")!,
          level,
          { onExit: () => show("levels"), onNext: null },
          { mobile: mobileMode() },
        );
        show("game");
        game.start();
      });
      custom.appendChild(row);
    }
  }
}

function startGame(index: number) {
  const level = LEVELS[index];
  const next = LEVELS[index + 1];
  game = new Game(
    document.querySelector("#game-root")!,
    level,
    {
      onExit: () => show("levels"),
      onNext: next ? () => startGame(index + 1) : null,
    },
    { mobile: mobileMode() },
  );
  show("game");
  game.start();
}

// ---------- Scores ----------

function renderScores() {
  const best = storage.getBest();
  const wrap = document.querySelector("#scores-table")!;
  wrap.innerHTML = "";
  const table = document.createElement("table");
  table.className = "scores-table";
  table.innerHTML = `
    <thead><tr><th>#</th><th>Level</th><th>Best time</th><th>Par</th><th>Coins</th><th>Deaths</th></tr></thead>
  `;
  const tbody = document.createElement("tbody");
  LEVELS.forEach((level, i) => {
    const b = best[level.id];
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${level.name}</td>
      <td>${b ? formatTime(b.time) : "—"}</td>
      <td>${level.parTime ? formatTime(level.parTime) : "—"}</td>
      <td>${b ? `${b.coins}/${b.totalCoins}` : "—"}</td>
      <td>${b ? b.deaths : "—"}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
}

// ---------- Story ----------

function renderStory() {
  const collected = new Set(storage.getCollectedNotes());
  const list = document.querySelector("#story-list")!;
  list.innerHTML = "";
  document
    .querySelector("#story-count")!
    .textContent = `${collected.size}/${Object.keys(STORY_NOTES).length} found`;
  for (const [id, note] of Object.entries(STORY_NOTES)) {
    const card = document.createElement("div");
    card.className = `story-card ${collected.has(id) ? "" : "locked"}`;
    card.innerHTML = collected.has(id)
      ? `<h3>${note.title}</h3><p>${note.text}</p>`
      : `<h3>???</h3><p class="muted">Note not yet found. Keep rolling.</p>`;
    list.appendChild(card);
  }
}

// ---------- Wiring ----------

function updateMobileModeBtn() {
  const btn = document.querySelector("#mobile-mode-btn");
  if (btn) btn.textContent = `Mobile mode: ${mobileSetting()}`;
}

document.querySelectorAll("[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const action = (btn as HTMLElement).getAttribute("data-action");
    if (action === "menu") show("menu");
    else if (action === "mobilemode") {
      const order: ("auto" | "on" | "off")[] = ["auto", "on", "off"];
      const next = order[(order.indexOf(mobileSetting()) + 1) % order.length];
      try {
        if (next === "auto") localStorage.removeItem("graviball.mobile");
        else localStorage.setItem("graviball.mobile", next);
      } catch {
        /* ignore */
      }
      updateMobileModeBtn();
    }
    else if (action === "levels") show("levels");
    else if (action === "scores") show("scores");
    else if (action === "story") show("story");
    else if (action === "editor") show("editor");
  });
});

updateMobileModeBtn();

const scoresReset = document.querySelector("#scores-reset");
scoresReset?.addEventListener("click", () => {
  if (confirm("Reset all highscores?")) {
    storage.resetBest();
    renderScores();
  }
});

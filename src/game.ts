import { CONFIG } from "./config";
import { storage } from "./storage";
import { STORY_NOTES } from "./story";
import { icon } from "./icons";
import type { LevelDef, Rect, MoverDef, ZoneDef } from "./types";

type SolidKind = "wall" | "sticky" | "bouncy";

interface Solid {
  rect: Rect;
  kind: SolidKind;
}

type GameStatus = "playing" | "dead" | "won" | "note" | "paused";

interface GameHooks {
  onExit: () => void;
  onNext: (() => void) | null;
}

export interface GameOptions {
  /** Mobile mode: the level stays fixed, gravity direction follows input. */
  mobile?: boolean;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function pointInRect(x: number, y: number, r: Rect) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Circle vs axis-aligned rect. Returns push-out normal + penetration, or null. */
function circleRect(
  px: number,
  py: number,
  radius: number,
  r: Rect,
): { nx: number; ny: number; pen: number } | null {
  const cx = clamp(px, r.x, r.x + r.w);
  const cy = clamp(py, r.y, r.y + r.h);
  const dx = px - cx;
  const dy = py - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 > radius * radius) return null;
  if (d2 > 0.000001) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, pen: radius - d };
  }
  // Center is inside the rect: push out along the shortest axis.
  const left = px - r.x;
  const right = r.x + r.w - px;
  const top = py - r.y;
  const bottom = r.y + r.h - py;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { nx: -1, ny: 0, pen: left + radius };
  if (m === right) return { nx: 1, ny: 0, pen: right + radius };
  if (m === top) return { nx: 0, ny: -1, pen: top + radius };
  return { nx: 0, ny: 1, pen: bottom + radius };
}

function moverOrigin(m: MoverDef, t: number): [number, number] {
  const s = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t / m.period + m.phase));
  return [
    m.from[0] + (m.to[0] - m.from[0]) * s,
    m.from[1] + (m.to[1] - m.from[1]) * s,
  ];
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export class Game {
  private level: LevelDef;
  private root: HTMLElement;
  private hooks: GameHooks;
  private cfg = CONFIG;
  private mobile: boolean;

  private svg!: SVGSVGElement;
  private world!: SVGGElement;
  private ballEl!: SVGCircleElement;
  private moverEls: SVGGElement[] = [];
  private coinEls: SVGGElement[] = [];
  private noteEls: Map<string, SVGGElement> = new Map();

  private timeEl!: HTMLElement;
  private coinEl!: HTMLElement;
  private deathEl!: HTMLElement;
  private gravityEl!: HTMLElement;
  private overlayEl!: HTMLElement;
  private flashEl!: HTMLElement;

  // state
  private bx = 0;
  private by = 0;
  private bvx = 0;
  private bvy = 0;
  private radius: number;
  private angle = 0;
  private targetAngle = 0;
  private time = 0;
  private moverTime = 0;
  private deaths = 0;
  private status: GameStatus = "playing";
  private deadTimer = 0;
  private coinsCollected = new Set<number>();
  private totalCoins: number;

  private solids: Solid[] = [];
  private raf = 0;
  private lastTs = 0;
  private dragging = false;
  private lastPointerX = 0;
  private keyLeft = false;
  private keyRight = false;

  private onKey: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;

  // gyro (mobile)
  private gyroOn = false;
  private gyroEvents = 0;
  private gyroValid = 0;
  private gyroFallbackTimer = 0;
  private gyroListen: ((e: DeviceOrientationEvent) => void) | null = null;
  private gyroBtn: HTMLButtonElement | null = null;
  private toastTimer = 0;

  // fullscreen (mobile)
  private fsBtn: HTMLButtonElement | null = null;
  private onFsChange = () => this.setFsLabel();
  private overlayButtons: HTMLButtonElement[] = [];
  private overlayFocus = 0;

  constructor(
    container: HTMLElement,
    level: LevelDef,
    hooks: GameHooks,
    options: GameOptions = {},
  ) {
    this.level = level;
    this.root = container;
    this.hooks = hooks;
    this.mobile = options.mobile ?? false;
    this.radius = level.ballRadius ?? this.cfg.ballRadius;
    this.totalCoins = level.coins?.length ?? 0;
    this.bx = level.start[0];
    this.by = level.start[1];
    this.buildSolids();
    this.buildDom();
    this.buildSvg();
    this.resetBall();

    this.onKey = (e) => {
      if (e.repeat) return;
      // overlay keyboard navigation (win screen: Retry / Next / Levels)
      if (this.status === "won" && this.overlayButtons.length > 0) {
        if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
          e.preventDefault();
          const d = e.code === "ArrowRight" ? 1 : -1;
          this.overlayFocus =
            (this.overlayFocus + d + this.overlayButtons.length) %
            this.overlayButtons.length;
          this.updateOverlayFocus();
          return;
        }
        if (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space") {
          e.preventDefault();
          this.overlayButtons[this.overlayFocus]?.click();
          return;
        }
      }
      switch (e.code) {
        case "ArrowLeft":
        case "KeyA":
          this.keyLeft = true;
          break;
        case "ArrowRight":
        case "KeyD":
          this.keyRight = true;
          break;
        case "KeyR":
          this.restart();
          break;
        case "KeyP":
        case "Escape":
          this.togglePause();
          break;
      }
    };
    this.onKeyUp = (e) => {
      switch (e.code) {
        case "ArrowLeft":
        case "KeyA":
          this.keyLeft = false;
          break;
        case "ArrowRight":
        case "KeyD":
          this.keyRight = false;
          break;
      }
    };
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    if (this.mobile) this.setupMobile();
  }

  // ---------- Mobile mode ----------

  private setupMobile() {
    // big on-screen hold buttons (always available — also the fallback
    // when device orientation readings are unavailable)
    const controls = document.createElement("div");
    controls.className = "mobile-controls";
    controls.innerHTML = `
      <button class="m-rotate-btn" id="m-left" aria-label="rotate gravity left">${icon("back", 40)}</button>
      <button class="m-rotate-btn" id="m-right" aria-label="rotate gravity right">${icon("back", 40).replace('class="icon"', 'class="icon flip"')}</button>
    `;
    this.root.appendChild(controls);
    const bindHold = (id: string, set: (v: boolean) => void) => {
      const btn = controls.querySelector(id) as HTMLButtonElement;
      const on = (e: Event) => {
        e.preventDefault();
        set(true);
      };
      const off = (e: Event) => {
        e.preventDefault();
        set(false);
      };
      btn.addEventListener("pointerdown", on);
      btn.addEventListener("pointerup", off);
      btn.addEventListener("pointercancel", off);
      btn.addEventListener("pointerleave", off);
      btn.addEventListener("contextmenu", (e) => e.preventDefault());
    };
    bindHold("#m-left", (v) => (this.keyLeft = v));
    bindHold("#m-right", (v) => (this.keyRight = v));

    // gyro toggle button in the HUD
    const gyroBtn = this.root.querySelector(
      "[data-game='gyro']",
    ) as HTMLButtonElement | null;
    this.gyroBtn = gyroBtn;
    if (gyroBtn) {
      gyroBtn.style.display = "";
      gyroBtn.addEventListener("click", () => {
        if (this.gyroOn) this.disableGyro();
        else this.enableGyro();
      });
      this.setGyroLabel();
    }

    // fullscreen toggle
    const fsBtn = this.root.querySelector(
      "[data-game='fullscreen']",
    ) as HTMLButtonElement | null;
    this.fsBtn = fsBtn;
    this.onFsChange = () => this.setFsLabel();
    if (fsBtn) {
      fsBtn.style.display = "";
      fsBtn.addEventListener("click", () => void this.toggleFullscreen());
      document.addEventListener("fullscreenchange", this.onFsChange);
      document.addEventListener(
        "webkitfullscreenchange" as keyof DocumentEventMap,
        this.onFsChange,
      );
      this.setFsLabel();
    }
  }

  private setFsLabel() {
    const doc = document as any;
    const fs = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    if (this.fsBtn) {
      this.fsBtn.innerHTML = `${icon(fs ? "shrink" : "expand", 16)} ${
        fs ? "Exit screen" : "Fullscreen"
      }`;
    }
  }

  private async toggleFullscreen() {
    const doc = document as any;
    const rootEl = document.documentElement as any;
    try {
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        const exit = doc.exitFullscreen?.bind(doc) ?? doc.webkitExitFullscreen?.bind(doc);
        await exit?.();
      } else {
        const req =
          rootEl.requestFullscreen?.call(rootEl) ??
          rootEl.webkitRequestFullscreen?.call(rootEl);
        await req;
      }
      this.setFsLabel();
    } catch {
      // Fullscreen not available (e.g. iOS Safari, sandboxed frame) —
      // the game stays in normal mode
    }
  }

  private setGyroLabel() {
    if (this.gyroBtn) {
      this.gyroBtn.innerHTML = `${icon("rotate", 16)} Gyro: ${
        this.gyroOn ? "on" : "off"
      }`;
    }
  }

  /** Small on-screen message above the mobile controls. */
  private toast(msg: string, ms = 3500) {
    let t = this.root.querySelector(".game-toast") as HTMLDivElement | null;
    if (!t) {
      t = document.createElement("div");
      t.className = "game-toast";
      this.root.appendChild(t);
    }
    t.textContent = msg;
    // retrigger the show animation
    t.classList.remove("show");
    void t.offsetWidth;
    t.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t!.classList.remove("show"), ms);
  }

  private enableGyro() {
    const DOE: typeof DeviceOrientationEvent | undefined = (window as any)
      .DeviceOrientationEvent;
    if (typeof DOE === "undefined") {
      this.toast("Gyro is not supported in this browser");
      return;
    }
    const start = () => {
      this.gyroOn = true;
      this.gyroEvents = 0;
      this.gyroValid = 0;
      this.setGyroLabel();
      this.gyroListen = (e: DeviceOrientationEvent) => {
        this.gyroEvents++;
        if (e.beta == null || e.gamma == null) return;
        this.gyroValid++;
        const a = (((screen.orientation?.angle ?? 90) % 360) + 360) % 360;
        const r = Math.PI / 180;
        let gx = 0;
        let gy = 0;
        if (a === 90) {
          gx = -Math.sin(e.beta * r);
          gy = Math.sin(e.gamma * r);
        } else if (a === 270) {
          gx = Math.sin(e.beta * r);
          gy = -Math.sin(e.gamma * r);
        } else if (a === 0) {
          gx = Math.sin(e.gamma * r);
          gy = Math.sin(e.beta * r);
        } else {
          gx = -Math.sin(e.gamma * r);
          gy = -Math.sin(e.beta * r);
        }
        if (Math.abs(gx) > 0.01 || Math.abs(gy) > 0.01) {
          // gravity angle: clockwise from screen-down
          this.targetAngle = Math.atan2(gx, gy);
        }
      };
      window.addEventListener("deviceorientation", this.gyroListen);
      // fallbacks — with a visible message, never silent:
      // 1) no events at all → sensor not working, disable gyro
      // 2) events but no values → permission missing / sensor blocked
      window.clearTimeout(this.gyroFallbackTimer);
      this.gyroFallbackTimer = window.setTimeout(() => {
        if (!this.gyroOn) return;
        if (this.gyroEvents < 5) {
          this.disableGyro();
          this.toast("No gyro data — using on-screen buttons");
        } else if (this.gyroValid < 5) {
          this.disableGyro();
          this.toast("Gyro blocked — allow motion & orientation permission");
        }
      }, 3000);
    };
    const req: any = (DOE as any)?.requestPermission;
    if (req) {
      // iOS 13+ / Android Chrome 107+: needs a user gesture (this click)
      Promise.resolve(req.call(DOE))
        .then((p: string) => {
          if (p === "granted") start();
          else this.toast("Gyro permission denied");
        })
        .catch(() => this.toast("Could not enable gyro"));
    } else {
      start();
    }
  }

  private disableGyro() {
    this.gyroOn = false;
    window.clearTimeout(this.gyroFallbackTimer);
    if (this.gyroListen) {
      window.removeEventListener("deviceorientation", this.gyroListen);
      this.gyroListen = null;
    }
    this.setGyroLabel();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.disableGyro();
    if (this.onFsChange) {
      document.removeEventListener("fullscreenchange", this.onFsChange);
      document.removeEventListener(
        "webkitfullscreenchange" as keyof DocumentEventMap,
        this.onFsChange,
      );
    }
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
    this.root.innerHTML = "";
  }

  start() {
    this.lastTs = performance.now();
    const loop = (ts: number) => {
      const dt = clamp((ts - this.lastTs) / 1000, 0, 0.033);
      this.lastTs = ts;
      this.update(dt);
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private buildSolids() {
    this.solids = [];
    for (const w of this.level.walls) this.solids.push({ rect: w, kind: "wall" });
    for (const s of this.level.sticky ?? [])
      this.solids.push({ rect: s, kind: "sticky" });
    for (const b of this.level.bouncy ?? [])
      this.solids.push({ rect: b, kind: "bouncy" });
  }

  // ---------- DOM / HUD ----------

  private buildDom() {
    this.root.innerHTML = `
      <div class="game-hud">
        <button class="btn" data-game="exit">${icon("back", 16)} Levels</button>
        <span class="game-title">${this.level.name}</span>
        <span class="chip hud-chip">${icon("clock", 14)} <b id="g-time">0:0.0</b>${
          this.level.parTime ? ` / par ${formatTime(this.level.parTime)}` : ""
        }</span>
        <span class="chip hud-chip">${icon("coin", 14)} <b id="g-coins">0/${this.totalCoins}</b></span>
        <span class="chip hud-chip">${icon("skull", 14)} <b id="g-deaths">0</b></span>
        <span class="hud-gravity" id="g-gravity" title="gravity direction">${icon("arrow", 22)}</span>
        <button class="btn" data-game="restart">${icon("rotate", 16)} Restart</button>
        <button class="btn" data-game="pause">${icon("pause", 16)} Pause</button>
        <button class="btn gyro-btn" data-game="gyro" style="display:none"></button>
        <button class="btn fs-btn" data-game="fullscreen" style="display:none"></button>
      </div>
      <div class="game-stage" id="g-stage"></div>
      <div class="game-flash" id="g-flash"></div>
      <div class="overlay hidden" id="g-overlay"><div class="overlay-box"></div></div>
    `;
    this.timeEl = this.root.querySelector("#g-time")!;
    this.coinEl = this.root.querySelector("#g-coins")!;
    this.deathEl = this.root.querySelector("#g-deaths")!;
    this.gravityEl = this.root.querySelector("#g-gravity")!;
    this.flashEl = this.root.querySelector("#g-flash")!;
    this.overlayEl = this.root.querySelector("#g-overlay")!;

    this.root.querySelector('[data-game="exit"]')!.addEventListener("click", () => {
      this.hooks.onExit();
    });
    this.root.querySelector('[data-game="restart"]')!.addEventListener("click", () => {
      this.restart();
    });
    this.root.querySelector('[data-game="pause"]')!.addEventListener("click", () => {
      this.togglePause();
    });
  }

  // ---------- SVG scene ----------

  private buildSvg() {
    const [w, h] = this.level.size;
    const stage = this.root.querySelector("#g-stage")!;
    let viewBox: string;
    if (this.mobile) {
      // mobile: the maze never rotates, so the plain level rectangle fits
      viewBox = `0 0 ${w} ${h}`;
    } else {
      // square stage: at 45° a w×h rectangle's bounding box is
      // (w + h) / √2 on a side — the worst case for any rotation angle.
      // Fit the level into that square once, then it never leaves the frame.
      const s = (w + h) / Math.SQRT2;
      viewBox = `${w / 2 - s / 2} ${h / 2 - s / 2} ${s} ${s}`;
    }
    const svg = el("svg", { viewBox });
    stage.appendChild(svg);
    this.svg = svg;

    const defs = el("defs");
    defs.innerHTML = `
      <radialGradient id="ball-grad" cx="35%" cy="30%" r="80%">
        <stop offset="0%" stop-color="#ffd76a"/>
        <stop offset="55%" stop-color="#f5a623"/>
        <stop offset="100%" stop-color="#b06a00"/>
      </radialGradient>
      <radialGradient id="goal-grad" cx="50%" cy="50%" r="70%">
        <stop offset="0%" stop-color="#7dffb0" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="#1d9e55" stop-opacity="0.25"/>
      </radialGradient>
      <pattern id="sticky-pat" width="12" height="12" patternUnits="userSpaceOnUse">
        <rect width="12" height="12" fill="#c98a1b"/>
        <circle cx="6" cy="6" r="3" fill="#a36a0a"/>
      </pattern>
      <pattern id="brake-pat" width="14" height="14" patternUnits="userSpaceOnUse">
        <rect width="14" height="14" fill="rgba(110,80,45,0.35)"/>
        <path d="M0 14 L14 0" stroke="rgba(60,40,20,0.5)" stroke-width="3"/>
      </pattern>
      <pattern id="accel-pat" width="16" height="16" patternUnits="userSpaceOnUse">
        <rect width="16" height="16" fill="rgba(60,140,255,0.12)"/>
        <path d="M2 8 h8 m-4 -4 l4 4 l-4 4" stroke="rgba(90,170,255,0.8)" stroke-width="2" fill="none"/>
      </pattern>
    `;
    svg.appendChild(defs);

    this.world = el("g");
    svg.appendChild(this.world);

    const g = this.level.goal;
    this.world.appendChild(
      el("rect", {
        x: g.x, y: g.y, width: g.w, height: g.h,
        fill: "url(#goal-grad)",
        stroke: "#41e58a",
        "stroke-width": 3,
        rx: 8,
        class: "goal-zone",
      }),
    );
    const goalLabel = el("text", {
      x: g.x + g.w / 2, y: g.y + g.h / 2 + 6,
      "text-anchor": "middle", "font-size": 16, fill: "#b8ffda",
    });
    goalLabel.textContent = "EXIT";
    this.world.appendChild(goalLabel);

    // zones (under everything)
    for (const z of this.level.zones ?? []) {
      this.world.appendChild(
        el("rect", {
          x: z.rect.x, y: z.rect.y, width: z.rect.w, height: z.rect.h,
          fill: z.type === "accel" ? "url(#accel-pat)" : "url(#brake-pat)",
          stroke: z.type === "accel" ? "rgba(90,170,255,0.6)" : "rgba(140,100,50,0.7)",
          "stroke-width": 2,
          rx: 4,
        }),
      );
      if (z.type === "accel") this.world.appendChild(this.zoneArrow(z));
    }

    for (const s of this.solids) {
      const fill =
        s.kind === "wall" ? "#4a5568" :
        s.kind === "sticky" ? "url(#sticky-pat)" : "#ff8c42";
      const r = el("rect", {
        x: s.rect.x, y: s.rect.y, width: s.rect.w, height: s.rect.h,
        fill,
        stroke: s.kind === "wall" ? "#2d3748" : "none",
        "stroke-width": 2,
        rx: 3,
      });
      this.world.appendChild(r);
    }

    // spikes
    for (const sp of this.level.spikes ?? []) {
      this.world.appendChild(this.spikeRect(sp));
    }

    // movers
    for (const m of this.level.movers ?? []) {
      const gEl = el("g");
      const path = el("line", {
        x1: m.from[0] + m.w / 2, y1: m.from[1] + m.h / 2,
        x2: m.to[0] + m.w / 2, y2: m.to[1] + m.h / 2,
        stroke: "rgba(255,255,255,0.25)",
        "stroke-width": 2,
        "stroke-dasharray": "6 6",
      });
      const rect = el("rect", {
        width: m.w, height: m.h, fill: "#e04f6a", stroke: "#8f2438",
        "stroke-width": 2, rx: 4,
      });
      const warn = el("text", {
        x: m.w / 2, y: m.h / 2 + 5,
        "text-anchor": "middle", "font-size": 14, "font-weight": "bold",
        fill: "rgba(255,255,255,0.85)",
      });
      warn.textContent = "!";
      gEl.appendChild(path);
      gEl.appendChild(rect);
      gEl.appendChild(warn);
      this.world.appendChild(gEl);
      this.moverEls.push(gEl);
    }

    // start marker
    const [sx, sy] = this.level.start;
    this.world.appendChild(
      el("circle", {
        cx: sx, cy: sy, r: this.radius + 4,
        fill: "none", stroke: "rgba(255,255,255,0.3)",
        "stroke-width": 2, "stroke-dasharray": "4 4",
      }),
    );

    // coins
    for (const c of this.level.coins ?? []) {
      const gEl = el("g");
      gEl.appendChild(el("circle", { cx: c.x, cy: c.y, r: 9, fill: "#ffd700", stroke: "#b8860b", "stroke-width": 2 }));
      gEl.appendChild(el("circle", { cx: c.x, cy: c.y, r: 4, fill: "#fff3b0" }));
      this.world.appendChild(gEl);
      this.coinEls.push(gEl);
    }

    // notes
    for (const n of this.level.notes ?? []) {
      const gEl = el("g");
      gEl.appendChild(el("rect", { x: n.x - 10, y: n.y - 12, width: 20, height: 24, fill: "#f4e9c8", stroke: "#a08c5a", "stroke-width": 2, rx: 3 }));
      // envelope flap
      gEl.appendChild(
        el("path", {
          d: `M ${n.x - 7} ${n.y - 8} L ${n.x} ${n.y - 1} L ${n.x + 7} ${n.y - 8}`,
          fill: "none", stroke: "#7a6236", "stroke-width": 2,
          "stroke-linecap": "round", "stroke-linejoin": "round",
        }),
      );
      gEl.appendChild(
        el("path", {
          d: `M ${n.x - 7} ${n.y + 8} h 14 M ${n.x - 7} ${n.y + 4} h 10`,
          fill: "none", stroke: "#a08c5a", "stroke-width": 2, "stroke-linecap": "round",
        }),
      );
      this.world.appendChild(gEl);
      this.noteEls.set(n.id, gEl);
    }

    // ball (on top)
    this.ballEl = el("circle", { r: this.radius, fill: "url(#ball-grad)", stroke: "#7a4a00", "stroke-width": 1.5 });
    this.world.appendChild(this.ballEl);

    // input: wheel + drag rotate
    svg.style.touchAction = "none";
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.targetAngle += e.deltaY * this.cfg.wheelSensitivity;
    }, { passive: false });
    svg.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastPointerX = e.clientX;
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.targetAngle += (e.clientX - this.lastPointerX) * this.cfg.dragSensitivity;
      this.lastPointerX = e.clientX;
    });
    const stop = () => (this.dragging = false);
    svg.addEventListener("pointerup", stop);
    svg.addEventListener("pointercancel", stop);
  }

  private zoneArrow(z: ZoneDef): SVGElement {
    const { x, y, w, h } = z.rect;
    const horizontal = Math.abs(z.dir[0]) >= Math.abs(z.dir[1]);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const len = Math.min(horizontal ? w : h, 60) * 0.4;
    const sign = horizontal ? Math.sign(z.dir[0] || 1) : Math.sign(z.dir[1] || 1);
    const g = el("g", { "stroke": "rgba(140,195,255,0.9)", "stroke-width": 4, fill: "none" });
    for (const off of [-1, 0, 1]) {
      if (horizontal) {
        const oy = cy + off * 10;
        g.appendChild(el("path", { d: `M ${cx - len * sign} ${oy} L ${cx + len * sign} ${oy} m ${-8 * sign} ${-6} l ${8 * sign} 6 l ${-8 * sign} 6` }));
      } else {
        const ox = cx + off * 12;
        g.appendChild(el("path", { d: `M ${ox} ${cy - len * sign} L ${ox} ${cy + len * sign} m ${-6} ${-8 * sign} l 6 ${8 * sign} l 6 ${-8 * sign}` }));
      }
    }
    return g;
  }

  private spikeRect(r: Rect): SVGElement {
    const g = el("g");
    const horizontal = r.w >= r.h;
    // base bar
    if (horizontal) {
      g.appendChild(el("rect", { x: r.x, y: r.y + r.h - 6, width: r.w, height: 6, fill: "#7a2030" }));
      const n = Math.max(1, Math.floor(r.w / 16));
      const step = r.w / n;
      for (let i = 0; i < n; i++) {
        const x0 = r.x + i * step;
        g.appendChild(el("path", {
          d: `M ${x0} ${r.y + r.h - 6} L ${x0 + step / 2} ${r.y} L ${x0 + step} ${r.y + r.h - 6} Z`,
          fill: "#ff5d6e",
        }));
      }
    } else {
      g.appendChild(el("rect", { x: r.x + r.w - 6, y: r.y, width: 6, height: r.h, fill: "#7a2030" }));
      const n = Math.max(1, Math.floor(r.h / 16));
      const step = r.h / n;
      for (let i = 0; i < n; i++) {
        const y0 = r.y + i * step;
        g.appendChild(el("path", {
          d: `M ${r.x + r.w - 6} ${y0} L ${r.x} ${y0 + step / 2} L ${r.x + r.w - 6} ${y0 + step} Z`,
          fill: "#ff5d6e",
        }));
      }
    }
    return g;
  }

  // ---------- Game flow ----------

  private resetBall() {
    this.bx = this.level.start[0];
    this.by = this.level.start[1];
    this.bvx = 0;
    this.bvy = 0;
  }

  restart() {
    this.time = 0;
    this.moverTime = 0;
    this.deaths = 0;
    this.coinsCollected.clear();
    this.angle = 0;
    this.targetAngle = 0;
    this.resetBall();
    for (const c of this.coinEls) c.style.display = "";
    this.hideOverlay();
    if (this.status !== "playing") this.status = "playing";
  }

  togglePause() {
    if (this.status === "won" || this.status === "note") return;
    if (this.status === "paused") {
      this.status = "playing";
      this.hideOverlay();
    } else if (this.status === "playing" || this.status === "dead") {
      const was = this.status;
      this.status = "paused";
      this.showOverlay(
        `<h2>Paused</h2>
         <button class="btn big" id="ov-resume">Resume</button>
         <button class="btn big" id="ov-restart">Restart</button>
         <button class="btn big" id="ov-exit">Exit</button>`,
      );
      const box = this.overlayEl.querySelector(".overlay-box")!;
      box.querySelector("#ov-resume")!.addEventListener("click", () => {
        this.status = was === "dead" ? "dead" : "playing";
        this.hideOverlay();
      });
      box.querySelector("#ov-restart")!.addEventListener("click", () => this.restart());
      box.querySelector("#ov-exit")!.addEventListener("click", () => this.hooks.onExit());
    }
  }

  private showOverlay(html: string) {
    const box = this.overlayEl.querySelector(".overlay-box")!;
    box.innerHTML = html;
    this.overlayEl.classList.remove("hidden");
  }

  private hideOverlay() {
    this.overlayEl.classList.add("hidden");
  }

  private die() {
    if (this.status !== "playing") return;
    this.status = "dead";
    this.deadTimer = 0.5;
    this.deaths++;
    this.flashEl.classList.remove("hidden");
    this.ballEl.style.visibility = "hidden";
  }

  private win() {
    if (this.status !== "playing") return;
    this.status = "won";
    storage.recordBest(this.level.id, {
      time: this.time,
      coins: this.coinsCollected.size,
      totalCoins: this.totalCoins,
      deaths: this.deaths,
    });
    const all = storage.getBest();
    const isBest =
      !all[this.level.id] ||
      all[this.level.id].time > this.time + 0.001;
    this.showOverlay(`
      <h2>${icon("trophy", 30)} Level Complete!</h2>
      <p class="ov-stats">
        Time: <b>${formatTime(this.time)}</b>${this.level.parTime ? ` (par ${formatTime(this.level.parTime)})` : ""}<br/>
        Coins: <b>${this.coinsCollected.size}/${this.totalCoins}</b><br/>
        Deaths: <b>${this.deaths}</b>
      </p>
      ${isBest ? '<p class="ov-best">★ New best time!</p>' : ""}
      <div class="ov-buttons">
        <button class="btn big" id="ov-retry">Retry</button>
        ${this.hooks.onNext ? '<button class="btn big primary" id="ov-next">Next</button>' : ""}
        <button class="btn big" id="ov-exit">Levels</button>
      </div>
      <p class="ov-hint">← → to choose · Enter to confirm</p>
    `);
    const box = this.overlayEl.querySelector(".overlay-box")!;
    box.querySelector("#ov-retry")!.addEventListener("click", () => this.restart());
    const next = box.querySelector("#ov-next")!;
    if (next) next.addEventListener("click", () => this.hooks.onNext?.());
    box.querySelector("#ov-exit")!.addEventListener("click", () => this.hooks.onExit());
    this.overlayButtons = Array.from(
      box.querySelectorAll<HTMLButtonElement>(".ov-buttons button"),
    );
    this.overlayFocus = 0;
    this.updateOverlayFocus();
  }

  private updateOverlayFocus() {
    this.overlayButtons.forEach((b, i) =>
      b.classList.toggle("focused", i === this.overlayFocus),
    );
  }

  private openNote(id: string, text?: string) {
    if (this.status !== "playing") return;
    this.status = "note";
    storage.collectNote(id);
    const known = STORY_NOTES[id];
    this.showOverlay(`
      <h2>${icon("note", 30)} Note found</h2>
      ${known ? `<p class="ov-note-title">${known.title}</p>` : ""}
      <p class="ov-note-text">${text ?? known?.text ?? "A blank page. The ball left no words here."}</p>
      <button class="btn big primary" id="ov-close">Continue</button>
    `);
    this.overlayEl
      .querySelector("#ov-close")!
      .addEventListener("click", () => {
        this.hideOverlay();
        this.status = "playing";
      });
  }

  // ---------- Simulation ----------

  private update(dt: number) {
    // key rotation
    if (this.status === "playing") {
      if (this.keyLeft) this.targetAngle -= this.cfg.keyRotationSpeed * dt;
      if (this.keyRight) this.targetAngle += this.cfg.keyRotationSpeed * dt;
    }
    // smooth approach to target angle
    this.angle += (this.targetAngle - this.angle) * Math.min(1, dt * 14);

    if (this.status === "dead") {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0) {
        this.flashEl.classList.add("hidden");
        this.ballEl.style.visibility = "";
        this.resetBall();
        this.status = "playing";
      }
      return;
    }
    if (this.status !== "playing") return;

    this.time += dt;
    this.moverTime += dt;

    const sub = this.cfg.substep;
    let remaining = dt;
    while (remaining > 0.0001 && this.status === "playing") {
      const h = Math.min(sub, remaining);
      remaining -= h;
      this.step(h);
    }
  }

  private step(h: number) {
    const th = this.angle;
    const g = this.cfg.gravity;
    // gravity in world coordinates (screen gravity (0, g) rotated by -angle)
    const gx = g * Math.sin(th);
    const gy = g * Math.cos(th);

    // zones
    for (const z of this.level.zones ?? []) {
      if (!pointInRect(this.bx, this.by, z.rect)) continue;
      if (z.type === "accel") {
        this.bvx += z.dir[0] * z.power * h;
        this.bvy += z.dir[1] * z.power * h;
      } else {
        const f = Math.exp(-z.power * h);
        this.bvx *= f;
        this.bvy *= f;
      }
    }

    this.bvx += gx * h;
    this.bvy += gy * h;
    const sp = Math.hypot(this.bvx, this.bvy);
    if (sp > this.cfg.maxSpeed) {
      this.bvx = (this.bvx / sp) * this.cfg.maxSpeed;
      this.bvy = (this.bvy / sp) * this.cfg.maxSpeed;
    }

    this.bx += this.bvx * h;
    this.by += this.bvy * h;

    // collisions — a few iterations for corners
    for (let i = 0; i < 3; i++) {
      for (const s of this.solids) {
        const hit = circleRect(this.bx, this.by, this.radius, s.rect);
        if (!hit) continue;
        this.bx += hit.nx * hit.pen;
        this.by += hit.ny * hit.pen;
        const vn = this.bvx * hit.nx + this.bvy * hit.ny;
        if (vn < 0) {
          const e = s.kind === "bouncy" ? this.cfg.bouncyRestitution : this.cfg.restitution;
          this.bvx -= (1 + e) * vn * hit.nx;
          this.bvy -= (1 + e) * vn * hit.ny;
          if (s.kind === "bouncy") {
            const vn2 = this.bvx * hit.nx + this.bvy * hit.ny;
            if (vn2 < this.cfg.bouncyMinSpeed) {
              this.bvx += (this.cfg.bouncyMinSpeed - vn2) * hit.nx;
              this.bvy += (this.cfg.bouncyMinSpeed - vn2) * hit.ny;
            }
          }
          // light tangential friction
          const vn3 = this.bvx * hit.nx + this.bvy * hit.ny;
          const tx = this.bvx - vn3 * hit.nx;
          const ty = this.bvy - vn3 * hit.ny;
          const fr = s.kind === "wall" ? 0.985 : 0.999;
          this.bvx = vn3 * hit.nx + tx * fr;
          this.bvy = vn3 * hit.ny + ty * fr;
        }
        if (s.kind === "sticky") {
          this.bvx = 0;
          this.bvy = 0;
        }
      }
    }

    // spikes (forgiving: use 80% radius)
    for (const spk of this.level.spikes ?? []) {
      if (circleRect(this.bx, this.by, this.radius * 0.8, spk)) {
        this.die();
        return;
      }
    }

    // movers (deadly)
    const movers = this.level.movers ?? [];
    for (let i = 0; i < movers.length; i++) {
      const m = movers[i];
      const [mx, my] = moverOrigin(m, this.moverTime);
      if (circleRect(this.bx, this.by, this.radius * 0.9, { x: mx, y: my, w: m.w, h: m.h })) {
        this.die();
        return;
      }
    }

    // out of bounds
    const [w, hh] = this.level.size;
    if (this.bx < -40 || this.bx > w + 40 || this.by < -40 || this.by > hh + 40) {
      this.die();
      return;
    }

    // coins
    const coins = this.level.coins ?? [];
    coins.forEach((c, i) => {
      if (this.coinsCollected.has(i)) return;
      if (Math.hypot(c.x - this.bx, c.y - this.by) < this.radius + 10) {
        this.coinsCollected.add(i);
        this.coinEls[i]?.setAttribute("style", "display:none");
      }
    });

    // notes
    for (const n of this.level.notes ?? []) {
      const gEl = this.noteEls.get(n.id);
      if (!gEl || gEl.style.display === "none") continue;
      if (Math.hypot(n.x - this.bx, n.y - this.by) < this.radius + 16) {
        gEl.setAttribute("style", "display:none");
        this.openNote(n.id, n.text);
        return;
      }
    }

    // goal
    const gl = this.level.goal;
    if (pointInRect(this.bx, this.by, gl)) this.win();
  }

  // ---------- Render ----------

  private render() {
    const [w, h] = this.level.size;
    const deg = (this.angle * 180) / Math.PI;
    if (this.mobile) {
      // mobile: the maze stays fixed, gravity direction does the work
      this.world.removeAttribute("transform");
    } else {
      // fixed square viewBox: constant scale, the level rotates in place
      // around its center and always stays inside the frame
      this.world.setAttribute(
        "transform",
        `rotate(${deg} ${w / 2} ${h / 2})`,
      );
    }
    this.ballEl.setAttribute("cx", String(this.bx));
    this.ballEl.setAttribute("cy", String(this.by));

    const movers = this.level.movers ?? [];
    movers.forEach((m, i) => {
      const [mx, my] = moverOrigin(m, this.moverTime);
      this.moverEls[i].setAttribute("transform", `translate(${mx} ${my})`);
    });

    this.timeEl.textContent = formatTime(this.time);
    this.coinEl.textContent = `${this.coinsCollected.size}/${this.totalCoins}`;
    this.deathEl.textContent = String(this.deaths);
    this.gravityEl.style.transform = `rotate(${deg}deg)`;
  }
}

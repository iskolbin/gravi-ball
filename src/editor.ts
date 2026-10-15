import { storage } from "./storage";
import { icon, type IconName } from "./icons";
import type { LevelDef, Rect, MoverDef, ZoneDef, CoinDef, NoteDef } from "./types";

type Tool =
  | "select"
  | "wall"
  | "sticky"
  | "bouncy"
  | "spike"
  | "accel"
  | "brake"
  | "mover"
  | "coin"
  | "note"
  | "goal"
  | "start"
  | "erase";

const SVG_NS = "http://www.w3.org/2000/svg";
const SIZE: [number, number] = [960, 540];

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function snap(v: number) {
  return Math.round(v / 10) * 10;
}

interface RectObj {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Unified reference to any editable object in the draft. */
interface Selection {
  kind:
    | "wall" | "sticky" | "bouncy" | "spike" | "zone" | "mover"
    | "coin" | "note" | "goal" | "start";
  array?: unknown[]; // owning array
  index?: number;
  zone?: ZoneDef;
  mover?: MoverDef;
  coin?: CoinDef;
  note?: NoteDef;
}

export class Editor {
  private svg: SVGSVGElement;
  private scene: SVGGElement;
  private props: HTMLElement;
  private nameInput: HTMLInputElement;
  private customList: HTMLElement;
  private toolbar: HTMLElement;
  private importFile: HTMLInputElement;

  private tool: Tool = "select";
  private draft!: LevelDef;
  private selection: Selection | null = null;
  private drawing: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private tempRect: SVGRectElement | null = null;
  private dragMove: { obj: Selection; dx: number; dy: number } | null = null;
  private noteCounter = 1;

  constructor() {
    this.svg = document.querySelector("#editor-svg")!;
    this.scene = el("g");
    this.svg.appendChild(this.scene);
    this.svg.appendChild(this.scene);
    this.props = document.querySelector("#editor-props")!;
    this.nameInput = document.querySelector("#editor-name")!;
    this.customList = document.querySelector("#editor-custom-list")!;
    this.toolbar = document.querySelector("#editor-toolbar")!;
    this.importFile = document.querySelector("#editor-import-file")!;

    this.newLevel();
    this.bindToolbar();
    this.bindCanvas();
    this.bindSaveBar();
    this.renderCustomList();
  }

  // ---------- Draft ----------

  newLevel() {
    this.draft = {
      id: `custom-${Date.now()}`,
      name: this.nameInput.value || "Untitled level",
      size: SIZE,
      start: [100, 100],
      goal: { x: 800, y: 430, w: 120, h: 80 },
      walls: [
        { x: 0, y: 0, w: 960, h: 30 },
        { x: 0, y: 510, w: 960, h: 30 },
        { x: 0, y: 0, w: 30, h: 540 },
        { x: 930, y: 0, w: 30, h: 540 },
      ],
      sticky: [],
      bouncy: [],
      spikes: [],
      coins: [],
      notes: [],
      zones: [],
      movers: [],
    };
    this.selection = null;
    this.redraw();
    this.renderProps();
  }

  loadDraft(level: LevelDef) {
    this.draft = JSON.parse(JSON.stringify(level)) as LevelDef;
    this.noteCounter = 1;
    for (const n of this.draft.notes ?? []) {
      const m = n.id.match(/(\d+)$/);
      if (m) this.noteCounter = Math.max(this.noteCounter, parseInt(m[1], 10) + 1);
    }
    this.selection = null;
    this.redraw();
    this.renderProps();
  }

  // ---------- Toolbar / save bar ----------

  private bindToolbar() {
    const toolIcons: Record<Tool, IconName> = {
      select: "select",
      wall: "wall",
      sticky: "sticky",
      bouncy: "bouncy",
      spike: "spike",
      accel: "accel",
      brake: "brake",
      mover: "mover",
      coin: "coin",
      note: "note",
      goal: "target",
      start: "play",
      erase: "erase",
    };
    this.toolbar.querySelectorAll("button[data-tool]").forEach((btn) => {
      const t = btn.getAttribute("data-tool") as Tool;
      btn.innerHTML = icon(toolIcons[t], 22);
      btn.addEventListener("click", () => {
        this.tool = btn.getAttribute("data-tool") as Tool;
        this.toolbar.querySelectorAll("button[data-tool]").forEach((b) =>
          b.classList.toggle("active", b === btn),
        );
        if (this.tool !== "select") {
          this.selection = null;
          this.renderProps();
          this.redraw();
        }
      });
    });
  }

  private bindSaveBar() {
    document.querySelector("#editor-save")!.addEventListener("click", () => {
      const name = this.nameInput.value.trim() || "Untitled level";
      this.draft.name = name;
      storage.saveCustomLevel({ name, level: this.draft });
      this.renderCustomList();
      this.flashSaved();
    });
    document.querySelector("#editor-export")!.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(this.draft, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(this.draft.name || "level").replace(/\s+/g, "-")}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    document.querySelector("#editor-import")!.addEventListener("click", () =>
      this.importFile.click(),
    );
    this.importFile.addEventListener("change", async () => {
      const file = this.importFile.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        this.loadDraft(data as LevelDef);
      } catch {
        alert("Could not import: invalid level JSON");
      }
      this.importFile.value = "";
    });
  }

  private flashSaved() {
    const btn = document.querySelector("#editor-save")!;
    const old = btn.textContent;
    btn.textContent = "Saved ✓";
    setTimeout(() => (btn.textContent = old), 1200);
  }

  renderCustomList() {
    this.customList.innerHTML = "";
    const list = storage.getCustomLevels();
    if (list.length === 0) {
      this.customList.innerHTML = '<p class="muted">No saved levels yet.</p>';
      return;
    }
    for (const c of list) {
      const row = document.createElement("div");
      row.className = "custom-row";
      const name = document.createElement("button");
      name.className = "btn small";
      name.textContent = c.name;
      name.addEventListener("click", () =>
        this.loadDraft(JSON.parse(JSON.stringify(c.level)) as LevelDef),
      );
      const del = document.createElement("button");
      del.className = "btn small danger";
      del.textContent = "✕";
      del.addEventListener("click", () => {
        storage.deleteCustomLevel(c.name);
        this.renderCustomList();
      });
      row.appendChild(name);
      row.appendChild(del);
      this.customList.appendChild(row);
    }
  }

  // ---------- Canvas ----------

  private toLocal(e: PointerEvent): [number, number] {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(this.svg.getScreenCTM()!.inverse());
    return [p.x, p.y];
  }

  private bindCanvas() {
    const svg = this.svg;
    svg.addEventListener("pointerdown", (e) => this.onDown(e));
    svg.addEventListener("pointermove", (e) => this.onMove(e));
    const up = (e: PointerEvent) => this.onUp(e);
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [w, h] = this.draft.size;
      const s = 1 - Math.sign(e.deltaY) * 0.05;
      const vw = w * s;
      const vh = h * s;
      if (vw < 300 || vw > 4000) return;
      this.draft.size = [Math.round(vw), Math.round(vh)];
      this.redraw();
    }, { passive: false });
  }

  private onDown(e: PointerEvent) {
    const [x, y] = this.toLocal(e);
    if (this.tool === "select") {
      const sel = this.hitTest(x, y);
      this.selection = sel;
      this.redraw();
      this.renderProps();
      if (sel) {
        const { dx, dy } = this.selectionOffsets(sel, x, y);
        this.dragMove = { obj: sel, dx, dy };
        svg_setCapture(e);
      }
      return;
    }
    if (this.tool === "erase") {
      const sel = this.hitTest(x, y);
      if (sel) this.deleteSelection(sel);
      return;
    }
    if (this.tool === "coin") {
      this.draft.coins ??= [];
      this.draft.coins.push({ x: snap(x), y: snap(y) });
      this.afterAdd();
      return;
    }
    if (this.tool === "note") {
      this.draft.notes ??= [];
      const id = `custom-${this.noteCounter++}`;
      this.draft.notes.push({ x: snap(x), y: snap(y), id });
      this.afterAdd();
      return;
    }
    if (this.tool === "start") {
      this.draft.start = [snap(x), snap(y)];
      this.afterAdd();
      return;
    }
    // rect-based tools
    this.drawing = { x0: snap(x), y0: snap(y), x1: snap(x), y1: snap(y) };
    this.tempRect = el("rect", {
      fill: "rgba(255,255,255,0.15)",
      stroke: "#7cc4ff",
      "stroke-dasharray": "6 4",
      "stroke-width": 2,
    });
    this.scene.appendChild(this.tempRect);
    svg_setCapture(e);
  }

  private onMove(e: PointerEvent) {
    const [x, y] = this.toLocal(e);
    if (this.drawing) {
      this.drawing.x1 = snap(x);
      this.drawing.y1 = snap(y);
      const { x0, y0, x1, y1 } = this.drawing;
      this.tempRect!.setAttribute("x", String(Math.min(x0, x1)));
      this.tempRect!.setAttribute("y", String(Math.min(y0, y1)));
      this.tempRect!.setAttribute("width", String(Math.abs(x1 - x0)));
      this.tempRect!.setAttribute("height", String(Math.abs(y1 - y0)));
      return;
    }
    if (this.dragMove) {
      this.moveObject(this.dragMove.obj, x - this.dragMove.dx, y - this.dragMove.dy);
      this.redraw();
    }
  }

  private onUp(e: PointerEvent) {
    void e;
    if (this.dragMove) {
      this.dragMove = null;
      return;
    }
    if (this.drawing) {
      this.tempRect?.remove();
      this.tempRect = null;
      const { x0, y0, x1, y1 } = this.drawing;
      this.drawing = null;
      const rect: Rect = {
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        w: Math.abs(x1 - x0),
        h: Math.abs(y1 - y0),
      };
      if (rect.w < 10 || rect.h < 10) return;
      this.addRectTool(this.tool, rect);
    }
  }

  private addRectTool(tool: Tool, rect: Rect) {
    switch (tool) {
      case "wall":
        this.draft.walls.push(rect);
        break;
      case "sticky":
        this.draft.sticky ??= [];
        this.draft.sticky.push(rect);
        break;
      case "bouncy":
        this.draft.bouncy ??= [];
        this.draft.bouncy.push(rect);
        break;
      case "spike":
        this.draft.spikes ??= [];
        this.draft.spikes.push(rect);
        break;
      case "goal":
        this.draft.goal = rect;
        break;
      case "accel":
        this.draft.zones ??= [];
        this.draft.zones.push({
          rect,
          type: "accel",
          dir: [1, 0],
          power: 2500,
        });
        break;
      case "brake":
        this.draft.zones ??= [];
        this.draft.zones.push({ rect, type: "brake", dir: [0, 0], power: 4 });
        break;
      case "mover":
        this.draft.movers ??= [];
        this.draft.movers.push({
          w: rect.w,
          h: rect.h,
          from: [rect.x, rect.y],
          to: [rect.x + 100, rect.y],
          period: 3,
          phase: 0,
        });
        break;
      default:
        return;
    }
    this.afterAdd();
  }

  private afterAdd() {
    this.redraw();
  }

  // ---------- Selection helpers ----------

  private hitTest(x: number, y: number): Selection | null {
    const d = this.draft;
    const inR = (r: Rect) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    const checkList = (
      kind: Selection["kind"],
      list: Rect[] | undefined,
    ): Selection | null => {
      for (let i = (list?.length ?? 0) - 1; i >= 0; i--) {
        if (inR(list![i])) return { kind, array: list, index: i };
      }
      return null;
    };
    for (let i = (d.movers?.length ?? 0) - 1; i >= 0; i--) {
      const m = d.movers![i];
      if (inR({ x: m.from[0], y: m.from[1], w: m.w, h: m.h }))
        return { kind: "mover", array: d.movers, index: i, mover: m };
    }
    if (inR(d.goal)) return { kind: "goal" };
    for (let i = (d.notes?.length ?? 0) - 1; i >= 0; i--) {
      const n = d.notes![i];
      if (Math.abs(n.x - x) < 14 && Math.abs(n.y - y) < 14)
        return { kind: "note", array: d.notes, index: i, note: n };
    }
    for (let i = (d.coins?.length ?? 0) - 1; i >= 0; i--) {
      const c = d.coins![i];
      if (Math.hypot(c.x - x, c.y - y) < 14)
        return { kind: "coin", array: d.coins, index: i, coin: c };
    }
    if (Math.hypot(d.start[0] - x, d.start[1] - y) < 20) return { kind: "start" };
    for (let i = (d.zones?.length ?? 0) - 1; i >= 0; i--) {
      const z = d.zones![i];
      if (inR(z.rect))
        return { kind: "zone", array: d.zones, index: i, zone: z };
    }
    return (
      checkList("wall", d.walls) ??
      checkList("sticky", d.sticky) ??
      checkList("bouncy", d.bouncy) ??
      checkList("spike", d.spikes)
    );
  }

  private selectionOffsets(sel: Selection, x: number, y: number): { dx: number; dy: number } {
    switch (sel.kind) {
      case "wall":
      case "sticky":
      case "bouncy":
      case "spike":
        const r = sel.array![sel.index!] as Rect;
        return { dx: x - r.x, dy: y - r.y };
      case "mover":
        return { dx: x - sel.mover!.from[0], dy: y - sel.mover!.from[1] };
      case "zone":
        return { dx: x - sel.zone!.rect.x, dy: y - sel.zone!.rect.y };
      case "coin":
        return { dx: x - sel.coin!.x, dy: y - sel.coin!.y };
      case "note":
        return { dx: x - sel.note!.x, dy: y - sel.note!.y };
      case "start":
        return { dx: x - this.draft.start[0], dy: y - this.draft.start[1] };
      case "goal":
        return { dx: x - this.draft.goal.x, dy: y - this.draft.goal.y };
    }
  }

  private moveObject(sel: Selection, nx: number, ny: number) {
    const s = (v: number) => snap(v);
    switch (sel.kind) {
      case "wall":
      case "sticky":
      case "bouncy":
      case "spike": {
        const r = sel.array![sel.index!] as Rect;
        r.x = s(nx);
        r.y = s(ny);
        break;
      }
      case "goal":
        this.draft.goal.x = s(nx);
        this.draft.goal.y = s(ny);
        break;
      case "mover": {
        const m = sel.mover!;
        const ox = m.from[0];
        const oy = m.from[1];
        const dx = s(nx) - ox;
        const dy = s(ny) - oy;
        m.from = [s(nx), s(ny)];
        m.to = [m.to[0] + dx, m.to[1] + dy];
        break;
      }
      case "zone":
        sel.zone!.rect.x = s(nx);
        sel.zone!.rect.y = s(ny);
        break;
      case "coin":
        sel.coin!.x = s(nx);
        sel.coin!.y = s(ny);
        break;
      case "note":
        sel.note!.x = s(nx);
        sel.note!.y = s(ny);
        break;
      case "start":
        this.draft.start = [s(nx), s(ny)];
        break;
    }
  }

  private deleteSelection(sel: Selection) {
    switch (sel.kind) {
      case "goal":
      case "start":
        return; // not deletable
      case "mover":
        sel.array!.splice(sel.index!, 1);
        break;
      case "zone":
        sel.array!.splice(sel.index!, 1);
        break;
      case "coin":
        sel.array!.splice(sel.index!, 1);
        break;
      case "note":
        sel.array!.splice(sel.index!, 1);
        break;
      default:
        (sel.array as unknown as Rect[]).splice(sel.index!, 1);
        break;
    }
    this.selection = null;
    this.redraw();
    this.renderProps();
  }

  // ---------- Rendering ----------

  private redraw() {
    const d = this.draft;
    const [w, h] = d.size;
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    this.scene.innerHTML = "";

    // grid
    const grid = el("g", { opacity: 0.25 });
    for (let x = 0; x <= w; x += 20)
      grid.appendChild(el("line", { x1: x, y1: 0, x2: x, y2: h, stroke: "#3a4358", "stroke-width": x % 100 === 0 ? 1.5 : 0.5 }));
    for (let y = 0; y <= h; y += 20)
      grid.appendChild(el("line", { x1: 0, y1: y, x2: w, y2: y, stroke: "#3a4358", "stroke-width": y % 100 === 0 ? 1.5 : 0.5 }));
    this.scene.appendChild(grid);

    // zones
    for (const z of d.zones ?? []) {
      this.scene.appendChild(
        el("rect", {
          x: z.rect.x, y: z.rect.y, width: z.rect.w, height: z.rect.h,
          fill: z.type === "accel" ? "rgba(60,140,255,0.2)" : "rgba(110,80,45,0.4)",
          stroke: z.type === "accel" ? "#5aa0ff" : "#8a6a3a",
          "stroke-width": 2,
        }),
      );
      if (z.type === "accel") {
        const [dx, dy] = z.dir;
        const cx = z.rect.x + z.rect.w / 2;
        const cy = z.rect.y + z.rect.h / 2;
        this.scene.appendChild(
          el("line", {
            x1: cx - dx * 25, y1: cy - dy * 25, x2: cx + dx * 25, y2: cy + dy * 25,
            stroke: "#9cc8ff", "stroke-width": 5,
          }),
        );
      }
    }

    const rectStyle = (kind: string) =>
      kind === "wall"
        ? { fill: "#4a5568", stroke: "#2d3748" }
        : kind === "sticky"
          ? { fill: "#c98a1b", stroke: "#8a5c08" }
          : kind === "bouncy"
            ? { fill: "#ff8c42", stroke: "#c05a10" }
            : { fill: "#ff5d6e", stroke: "#8f2438" };
    const addRects = (list: Rect[] | undefined, kind: string) => {
      for (const r of list ?? []) {
        const st = rectStyle(kind);
        this.scene.appendChild(
          el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: st.fill, stroke: st.stroke, "stroke-width": 2, rx: 3 }),
        );
      }
    };
    addRects(d.walls, "wall");
    addRects(d.sticky, "sticky");
    addRects(d.bouncy, "bouncy");
    for (const r of d.spikes ?? []) {
      this.scene.appendChild(
        el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "rgba(255,93,110,0.5)", stroke: "#ff5d6e", "stroke-width": 2 }),
      );
    }

    // movers
    for (const m of d.movers ?? []) {
      this.scene.appendChild(
        el("line", {
          x1: m.from[0] + m.w / 2, y1: m.from[1] + m.h / 2,
          x2: m.to[0] + m.w / 2, y2: m.to[1] + m.h / 2,
          stroke: "rgba(255,255,255,0.35)", "stroke-width": 2, "stroke-dasharray": "6 6",
        }),
      );
      this.scene.appendChild(
        el("rect", { x: m.from[0], y: m.from[1], width: m.w, height: m.h, fill: "#e04f6a", stroke: "#8f2438", "stroke-width": 2, rx: 4 }),
      );
    }

    // goal
    const g = d.goal;
    this.scene.appendChild(
      el("rect", { x: g.x, y: g.y, width: g.w, height: g.h, fill: "rgba(65,229,138,0.3)", stroke: "#41e58a", "stroke-width": 3, rx: 8 }),
    );

    // coins
    for (const c of d.coins ?? [])
      this.scene.appendChild(el("circle", { cx: c.x, cy: c.y, r: 9, fill: "#ffd700", stroke: "#b8860b", "stroke-width": 2 }));

    // notes
    for (const n of d.notes ?? []) {
      this.scene.appendChild(el("rect", { x: n.x - 10, y: n.y - 12, width: 20, height: 24, fill: "#f4e9c8", stroke: "#a08c5a", "stroke-width": 2, rx: 3 }));
    }

    // start
    const [sx, sy] = d.start;
    this.scene.appendChild(
      el("circle", { cx: sx, cy: sy, r: 14, fill: "rgba(255,215,106,0.6)", stroke: "#f5a623", "stroke-width": 3 }),
    );

    // selection outline
    if (this.selection) {
      const r = this.selectionRect(this.selection);
      if (r) {
        this.scene.appendChild(
          el("rect", {
            x: r.x - 3, y: r.y - 3, width: r.w + 6, height: r.h + 6,
            fill: "none", stroke: "#7cc4ff", "stroke-width": 2, "stroke-dasharray": "6 4", rx: 4,
          }),
        );
      }
    }
  }

  private selectionRect(sel: Selection): Rect | null {
    switch (sel.kind) {
      case "wall":
      case "sticky":
      case "bouncy":
      case "spike":
        return sel.array![sel.index!] as Rect;
      case "mover": {
        const m = sel.mover!;
        return { x: m.from[0], y: m.from[1], w: m.w, h: m.h };
      }
      case "zone":
        return sel.zone!.rect;
      case "goal":
        return this.draft.goal;
      case "coin":
        return { x: sel.coin!.x - 9, y: sel.coin!.y - 9, w: 18, h: 18 };
      case "note":
        return { x: sel.note!.x - 10, y: sel.note!.y - 12, w: 20, h: 24 };
      case "start":
        return { x: this.draft.start[0] - 14, y: this.draft.start[1] - 14, w: 28, h: 28 };
    }
  }

  // ---------- Properties panel ----------

  private renderProps() {
    const sel = this.selection;
    if (!sel) {
      this.props.innerHTML =
        '<p class="muted">Select an object to edit its properties.</p>';
      return;
    }
    let html = "";
    const row = (label: string, id: string, value: string | number, type = "number", step?: number) =>
      `<label>${label}
        <input id="p-${id}" type="${type}" value="${value}" ${step ? `step="${step}"` : ""}/>
      </label>`;

    switch (sel.kind) {
      case "wall":
      case "sticky":
      case "bouncy":
      case "spike": {
        const r = sel.array![sel.index!] as Rect;
        html =
          `<p class="muted">${sel.kind} rect — drag to move</p>` +
          row("x", "x", r.x) + row("y", "y", r.y) + row("w", "w", r.w) + row("h", "h", r.h);
        break;
      }
      case "goal": {
        const r = this.draft.goal;
        html =
          '<p class="muted">goal zone — drag to move</p>' +
          row("x", "x", r.x) + row("y", "y", r.y) + row("w", "w", r.w) + row("h", "h", r.h);
        break;
      }
      case "mover": {
        const m = sel.mover!;
        html =
          `<p class="muted">moving trap (deadly)</p>` +
          row("w", "w", m.w) + row("h", "h", m.h) +
          row("from x", "fx", m.from[0]) + row("from y", "fy", m.from[1]) +
          row("to x", "tx", m.to[0]) + row("to y", "ty", m.to[1]) +
          row("period (s)", "period", m.period, "number", 0.1) +
          row("phase", "phase", m.phase, "number", 0.05);
        break;
      }
      case "zone": {
        const z = sel.zone!;
        html =
          `<p class="muted">${z.type} zone</p>` +
          row("x", "x", z.rect.x) + row("y", "y", z.rect.y) +
          row("w", "w", z.rect.w) + row("h", "h", z.rect.h);
        if (z.type === "accel") {
          html +=
            row("dir x", "dx", z.dir[0]) + row("dir y", "dy", z.dir[1]) +
            row("power", "power", z.power);
        } else {
          html += row("power (drag)", "power", z.power, "number", 0.1);
        }
        break;
      }
      case "coin":
        html =
          '<p class="muted">coin — drag to move</p>' +
          row("x", "x", sel.coin!.x) + row("y", "y", sel.coin!.y);
        break;
      case "note":
        html =
          '<p class="muted">story note — drag to move</p>' +
          row("x", "x", sel.note!.x) + row("y", "y", sel.note!.y) +
          `<label>story id<input id="p-nid" type="text" value="${sel.note!.id}"/></label>` +
          `<label>text (optional, overrides story)<textarea id="p-ntext" rows="3">${sel.note!.text ?? ""}</textarea></label>`;
        break;
      case "start":
        html =
          '<p class="muted">ball start — drag to move</p>' +
          row("x", "x", this.draft.start[0]) + row("y", "y", this.draft.start[1]);
        break;
    }
    html += `<div class="props-actions"><button class="btn small danger" id="p-delete">Delete</button></div>`;
    this.props.innerHTML = html;

    const bind = (id: string, fn: (v: number) => void) => {
      const input = this.props.querySelector(`#p-${id}`) as HTMLInputElement | null;
      if (!input) return;
      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        if (Number.isFinite(v)) {
          fn(v);
          this.redraw();
        }
      });
    };
    const bindText = (id: string, fn: (v: string) => void) => {
      const input = this.props.querySelector(`#p-${id}`) as HTMLInputElement | null;
      if (!input) return;
      input.addEventListener("input", () => {
        fn(input.value);
        this.redraw();
      });
    };

    switch (sel.kind) {
      case "wall":
      case "sticky":
      case "bouncy":
      case "spike": {
        const r = sel.array![sel.index!] as Rect;
        bind("x", (v) => (r.x = v));
        bind("y", (v) => (r.y = v));
        bind("w", (v) => (r.w = Math.max(10, v)));
        bind("h", (v) => (r.h = Math.max(10, v)));
        break;
      }
      case "goal": {
        const r = this.draft.goal;
        bind("x", (v) => (r.x = v));
        bind("y", (v) => (r.y = v));
        bind("w", (v) => (r.w = Math.max(10, v)));
        bind("h", (v) => (r.h = Math.max(10, v)));
        break;
      }
      case "mover": {
        const m = sel.mover!;
        bind("w", (v) => (m.w = Math.max(10, v)));
        bind("h", (v) => (m.h = Math.max(10, v)));
        bind("fx", (v) => (m.from[0] = v));
        bind("fy", (v) => (m.from[1] = v));
        bind("tx", (v) => (m.to[0] = v));
        bind("ty", (v) => (m.to[1] = v));
        bind("period", (v) => (m.period = Math.max(0.5, v)));
        bind("phase", (v) => (m.phase = ((v % 1) + 1) % 1));
        break;
      }
      case "zone": {
        const z = sel.zone!;
        bind("x", (v) => (z.rect.x = v));
        bind("y", (v) => (z.rect.y = v));
        bind("w", (v) => (z.rect.w = Math.max(10, v)));
        bind("h", (v) => (z.rect.h = Math.max(10, v)));
        if (z.type === "accel") {
          bind("dx", (v) => (z.dir[0] = Math.max(-1, Math.min(1, v))));
          bind("dy", (v) => (z.dir[1] = Math.max(-1, Math.min(1, v))));
          bind("power", (v) => (z.power = v));
        } else {
          bind("power", (v) => (z.power = Math.max(0, v)));
        }
        break;
      }
      case "coin":
        bind("x", (v) => (sel.coin!.x = v));
        bind("y", (v) => (sel.coin!.y = v));
        break;
      case "note":
        bind("x", (v) => (sel.note!.x = v));
        bind("y", (v) => (sel.note!.y = v));
        bindText("nid", (v) => (sel.note!.id = v.trim() || sel.note!.id));
        bindText("ntext", (v) => (sel.note!.text = v));
        break;
      case "start":
        bind("x", (v) => (this.draft.start[0] = v));
        bind("y", (v) => (this.draft.start[1] = v));
        break;
    }
    this.props.querySelector("#p-delete")!.addEventListener("click", () => {
      if (this.selection) this.deleteSelection(this.selection);
    });
  }
}

function svg_setCapture(e: PointerEvent) {
  const svg = document.querySelector("#editor-svg")!;
  try {
    svg.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
}

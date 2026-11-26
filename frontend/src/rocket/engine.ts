import {
  BODY_R, DEFAULTS, FIGHTER_ROCKET_FUEL, FIGHTER_WING, MAX_PARTICLES, MAX_ROCKETS_HARD, MAX_WRECKS,
  NOSE_LEN, NOZZLE_LEN, TARGET_HP, THEMES, WALL_HP,
  clamp, normAngle, rand, segCircle, segRect,
  type Boom, type Dust, type Fighter, type Hardpoint,
  type Mode, type ObjKind, type Particle, type Rocket,
  type SceneObject, type Settings, type Theme, type ThemeKey,
} from './config';
import { RocketAudio } from './audio';

const isIgniting = (r: Rocket) => !r.powered && r.ignitionTimer !== undefined;
const sideOrder = (h: Hardpoint) => (h.side === 'left' ? 0 : h.side === 'right' ? 1 : 2);

export interface HudState {
  targets: number;
  flying: number;
  wrecks: number;
  hits: number;
  collisions: number;
  fps: number;
  speed: number;
  fuel: number;
  fuelPct: number;
  fighterLoaded: number;
  fighterTotal: number;
}

export interface ToastRequest {
  text: string;
  actionLabel?: string;
  action?: () => void;
}




export class RocketEngine {
  private canvas: HTMLCanvasElement;
  private container: HTMLElement;
  private ctx: CanvasRenderingContext2D;
  private onHud: (h: HudState) => void;
  private onToast: (t: ToastRequest) => void;

  private audio = new RocketAudio();
  private settings: Settings = { ...DEFAULTS };

  private raf = 0;
  private last = 0;
  private dpr = 1;
  private ro: ResizeObserver | null = null;
  private dead = false;

  private time = 0;
  private width = 0;
  private height = 0;

  private objects: SceneObject[] = [];
  private rockets: Rocket[] = [];
  private particles: Particle[] = [];
  private booms: Boom[] = [];
  private dust: Dust[] = [];
  private cleared: SceneObject[] | null = null;

  private fighter: Fighter | null = null;
  private nextHardpointId = 1;
  private fighterTrailAcc = 0;
  private lastDryFireToast = -Infinity;
  private salvoQueue: {
    h: Hardpoint;
    tx: number;
    ty: number;
    targetId: number | null;
    t: number;
  }[] = [];

  private bg: HTMLCanvasElement | null = null;
  private bgTheme: ThemeKey | null = null;

  private shake = 0;
  private spawnTimer = 0.3;
  private nextId = 1;
  private hitsChase = 0;
  private hitsBuild = 0;
  private collisions = 0;
  private fps = 60;
  private hudTimer = 0;
  private cursor = { x: 0, y: 0, inside: false, known: false };

  constructor(
    canvas: HTMLCanvasElement,
    container: HTMLElement,
    onHud: (h: HudState) => void,
    onToast: (t: ToastRequest) => void,
  ) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.onHud = onHud;
    this.onToast = onToast;

    this.resize();
    this.seedScene();

    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(container);
    }
    window.addEventListener('resize', this.onWindowResize);

    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  /* ---------- публичное API ---------- */

  setSettings(next: Settings) {
    const prev = this.settings;
    this.settings = next;
    this.audio.setMuted(next.muted);
    if (next.theme !== prev.theme) this.buildBackground();

    if (next.mode !== prev.mode) {
      this.applyMode(next.mode);
    } else if (next.mode === 'build' && next.fighterEnabled !== prev.fighterEnabled) {
      // Истребитель включается/выключается на лету, не трогая уже построенную сцену.
      if (next.fighterEnabled) this.buildFighter();
      else {
        this.fighter = null;
        this.salvoQueue = [];
        this.fighterTrailAcc = 0;
      }
    }

    // Страховка на случай неполного/повторного обновления настроек.
    if (next.mode === 'build' && next.fighterEnabled) {
      if (!this.fighter) this.buildFighter();
    } else if (this.fighter) {
      this.fighter = null;
      this.salvoQueue = [];
      this.fighterTrailAcc = 0;
    }

    // В классической стройке бак бесконечный, но ракеты истребителя всегда
    // ограничены по времени, чтобы не могли бесконечно кружить над целью.
    const infiniteFuel = !next.fuelOn || (next.mode === 'build' && !next.fighterEnabled);
    if (infiniteFuel) {
      for (const r of this.rockets) {
        if (r.powered && r.hardpointId == null && Number.isFinite(r.maxFuel)) {
          r.fuel = Infinity;
          r.maxFuel = Infinity;
        }
      }
    }
  }

  unlockAudio() { this.audio.unlock(); }

  pointerMove(x: number, y: number) {
    this.cursor.x = x;
    this.cursor.y = y;
    this.cursor.inside = true;
    this.cursor.known = true;
  }

  pointerLeave() { this.cursor.inside = false; }

  pointerDown(x: number, y: number, button: number) {
    this.pointerMove(x, y);

    const s = this.settings;

    if (s.mode === 'chase') {
      if (button !== 2) this.launch();
      return;
    }

    // ПКМ всегда удаляет объект в режиме постройки, даже с активным истребителем.
    if (button === 2) {
      this.removeAt(x, y);
      return;
    }

    // Клик по существующему объекту захватывает его как цель для истребителя.
    // Клик по пустому месту продолжает работать инструментом постройки, а ластик
    // по объекту удаляет его, не мешая строительным инструментам.
    if (s.fighterEnabled && this.fighter && s.tool !== 'erase') {
      const obj = this.objectAt(x, y);
      if (obj) {
        this.lockTarget(obj.id);
        this.audio.blip(760);
        this.onToast({ text: obj.kind === 'wall' ? 'Стена захвачена' : 'Цель захвачена' });
        return;
      }
    }

    this.placeAt(x, y);
  }

  launch() {
    if (this.settings.mode === 'build' && this.settings.fighterEnabled) {
      // В режиме постройки с истребителем обычный авто-пуск отключён —
      // ракеты выпускает только самолёт.
      this.fireSalvo();
      return;
    }
    if (this.rockets.length >= MAX_ROCKETS_HARD) return;
    if (this.settings.mode === 'build' && this.objects.length === 0) {
      this.onToast({ text: 'Сначала поставьте цель — кликните по сцене' });
      return;
    }
    this.spawnRocket();
    this.spawnTimer = this.delay();
  }

  scatter() {
    const w = this.width;
    const h = this.height;
    for (let i = 0; i < 5; i++) {
      this.addObject('target', rand(w * 0.08, w * 0.7), rand(h * 0.14, h * 0.8));
    }
    this.addObject('wall', rand(w * 0.22, w * 0.6), rand(h * 0.25, h * 0.7), Math.random() > 0.5);
    this.audio.blip(700);
    this.onToast({ text: 'Случайная расстановка готова' });
  }

  clearObjects() {
    if (this.settings.mode !== 'build') return;
    if (this.objects.length === 0) {
      this.onToast({ text: 'Сцена уже пуста' });
      return;
    }
    this.cleared = this.objects.slice();
    this.objects = [];
    this.onToast({
      text: `Удалено объектов: ${this.cleared.length}`,
      actionLabel: 'Вернуть',
      action: () => this.undoClear(),
    });
  }

  clearWrecks() {
    const wrecks = this.rockets.filter((r) => !r.powered && !isIgniting(r));
    if (wrecks.length === 0) {
      this.onToast({ text: 'Обломков на сцене нет' });
      return;
    }
    for (const w of wrecks) this.puff(w.x, w.y, 6);
    this.rockets = this.rockets.filter((r) => r.powered || isIgniting(r));
    this.audio.blip(260);
    this.onToast({ text: `Убрано обломков: ${wrecks.length}` });
  }

  undoClear() {
    if (!this.cleared || this.cleared.length === 0) return;
    const existing = new Set(this.objects.map((o) => o.id));
    for (const o of this.cleared) if (!existing.has(o.id)) this.objects.push(o);
    this.cleared = null;
    this.audio.blip(520);
    this.onToast({ text: 'Объекты возвращены на сцену' });
  }

  exportPng() {
    try {
      const a = document.createElement('a');
      a.href = this.canvas.toDataURL('image/png');
      a.download = `rocket-${this.settings.mode}.png`;
      a.click();
      this.onToast({ text: 'Кадр сохранён в PNG' });
    } catch {
      this.onToast({ text: 'Браузер не дал сохранить кадр' });
    }
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onWindowResize);
    this.ro?.disconnect();
    this.ro = null;
    this.audio.destroy();
    this.particles = [];
    this.rockets = [];
    this.booms = [];
    this.salvoQueue = [];
    this.fighter = null;
    this.hudTimer = 0;
    this.fighterTrailAcc = 0;
    this.lastDryFireToast = -Infinity;
  }

  /* ---------- API истребителя ---------- */

  fireSalvo() {
    const f = this.fighter;
    if (!f) return;
    const s = this.settings;

    let tx: number, ty: number;
    if (f.lockedId !== null) {
      const o = this.objects.find((it) => it.id === f.lockedId);
      if (o) { tx = o.x; ty = o.y; }
      else { f.lockedId = null; tx = this.cursor.x; ty = this.cursor.y; }
    } else {
      tx = this.cursor.x;
      ty = this.cursor.y;
    }

    const ready = f.hardpoints
      .filter((h) => h.loaded)
      .sort((a, b) => sideOrder(a) - sideOrder(b));

    if (ready.length === 0) {
      this.toastDryFire('Все пилоны пусты — ждём перезарядки');
      return;
    }

    // Залп не должен обходить общий лимит ракет: учитываем уже летящие
    // и ещё не выпущенные ракеты из очереди.
    const room = Math.max(0, MAX_ROCKETS_HARD - this.rockets.length - this.salvoQueue.length);
    if (room === 0) {
      this.toastDryFire('Небо переполнено — ждём, пока ракеты уйдут');
      return;
    }

    const count = Math.min(
      Number.isFinite(s.salvoSize) ? Math.max(1, Math.floor(s.salvoSize)) : 2,
      ready.length,
      room,
    );
    if (count === 0) return;

    const targetId = f.lockedId;
    const salvoDelay = Number.isFinite(s.salvoDelay) ? Math.max(0, s.salvoDelay) : 0.12;
    const reloadTime = Number.isFinite(s.reloadTime) ? Math.max(0, s.reloadTime) : 0.5;
    const lefts = ready.filter((h) => h.side === 'left');
    const rights = ready.filter((h) => h.side === 'right');
    const centers = ready.filter((h) => h.side === 'center');
    const chosen: Hardpoint[] = [];
    for (let i = 0; i < count; i++) {
      if (i % 2 === 0 && lefts.length) chosen.push(lefts.shift()!);
      else if (rights.length) chosen.push(rights.shift()!);
      else if (lefts.length) chosen.push(lefts.shift()!);
      else if (centers.length) chosen.push(centers.shift()!);
    }

    // Заносим в очередь СРАЗУ, помечая пилоны занятыми — иначе зажатый Space
    // за один кадр наберёт дубли. Обработка очереди идёт в update() по dt.
    chosen.forEach((h, i) => {
      h.loaded = false;
      h.reloading = reloadTime;
      this.salvoQueue.push({ h, tx, ty, targetId, t: i * salvoDelay });
    });

    // жёсткий предохранитель очереди
    if (this.salvoQueue.length > 24) this.salvoQueue.splice(0, this.salvoQueue.length - 24);

    this.audio.blip(520);
  }

  private toastDryFire(text: string) {
    if (this.time - this.lastDryFireToast < 1.2) return;
    this.lastDryFireToast = this.time;
    this.onToast({ text });
  }

  lockTarget(id: number | null) {
    if (this.fighter) this.fighter.lockedId = id;
  }

  reloadAllHardpoints() {
    if (!this.fighter) return;
    for (const h of this.fighter.hardpoints) {
      h.loaded = true;
      h.reloading = 0;
    }
    this.audio.blip(660);
    this.onToast({ text: 'Все пилоны перезаряжены' });
  }

  getFighterStatus() {
    const f = this.fighter;
    if (!f) return null;
    return {
      loaded: f.hardpoints.filter((h) => h.loaded).length,
      total: f.hardpoints.length,
      lockedId: f.lockedId,
    };
  }

  /* ---------- служебное ---------- */

  private onWindowResize = () => this.resize();

  private delay() {
    return this.settings.mode === 'chase' ? this.settings.respawnDelay : this.settings.launchDelay;
  }

  private applyMode(mode: Mode) {
    this.rockets = [];
    this.spawnTimer = 0.25;
    this.salvoQueue = [];
    this.fighterTrailAcc = 0;
    this.particles = [];
    this.booms = [];
    this.shake = 0;
    this.lastDryFireToast = -Infinity;
    if (mode === 'chase' && !this.cursor.known) {
      this.cursor.x = this.width * 0.55;
      this.cursor.y = this.height * 0.45;
    }
    if (mode === 'build' && this.settings.fighterEnabled) this.buildFighter();
    else this.fighter = null;
  }

  private resize() {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, rect.width || window.innerWidth);
    this.height = Math.max(1, rect.height || window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (!this.cursor.known) {
      this.cursor.x = this.width * 0.55;
      this.cursor.y = this.height * 0.45;
    }
    this.cursor.x = clamp(this.cursor.x, 0, this.width);
    this.cursor.y = clamp(this.cursor.y, 0, this.height);

    for (const o of this.objects) {
      o.x = clamp(o.x, o.w / 2 + 2, Math.max(o.w / 2 + 2, this.width - o.w / 2 - 2));
      o.y = clamp(o.y, o.h / 2 + 2, Math.max(o.h / 2 + 2, this.height - o.h / 2 - 2));
    }
    this.buildBackground();
  }

  private seedScene() {
    this.addObject('target', this.width * 0.6, this.height * 0.3);
    this.addObject('target', this.width * 0.32, this.height * 0.62);
    this.addObject('target', this.width * 0.68, this.height * 0.68);
    this.addObject('wall', this.width * 0.47, this.height * 0.45, false);
  }

  private addObject(kind: ObjKind, x: number, y: number, vertical = false) {
    const w = kind === 'target' ? 46 : vertical ? 28 : 118;
    const h = kind === 'target' ? 46 : vertical ? 118 : 28;
    this.objects.push({
      id: this.nextId++,
      kind,
      x: clamp(x, w / 2 + 4, Math.max(w / 2 + 4, this.width - w / 2 - 4)),
      y: clamp(y, h / 2 + 4, Math.max(h / 2 + 4, this.height - h / 2 - 4)),
      w, h,
      hp: kind === 'target' ? TARGET_HP : WALL_HP,
      maxHp: kind === 'target' ? TARGET_HP : WALL_HP,
      flash: 0,
      born: this.time,
    });
  }

  private objectAt(x: number, y: number) {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      if (Math.abs(x - o.x) <= o.w / 2 + 4 && Math.abs(y - o.y) <= o.h / 2 + 4) return o;
    }
    return null;
  }

  private placeAt(x: number, y: number) {
    const s = this.settings;
    if (s.tool === 'erase') { this.removeAt(x, y); return; }
    this.addObject(s.tool, x, y, s.wallVertical);
    this.audio.blip(s.tool === 'wall' ? 320 : 620);
  }

  private removeAt(x: number, y: number) {
    const o = this.objectAt(x, y);
    if (!o) return;
    this.objects = this.objects.filter((it) => it.id !== o.id);
    const t = THEMES[this.settings.theme];
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        x: o.x, y: o.y,
        vx: Math.cos(a) * rand(40, 170), vy: Math.sin(a) * rand(40, 170) - 40,
        life: 0, maxLife: rand(0.3, 0.75), size: rand(3, 8),
        type: 'debris', color: t.wood[i % 2], seed: Math.random() * 10,
      });
    }
    this.audio.blip(220);
  }

  private pickTarget(x: number, y: number) {
    if (this.objects.length === 0) return null;
    let best: SceneObject | null = null;
    let bestScore = Infinity;
    for (const o of this.objects) {
      let incoming = 0;
      for (const r of this.rockets) if (r.targetId === o.id && r.powered) incoming++;
      const score = incoming * 600 + Math.hypot(o.x - x, o.y - y);
      if (score < bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  private puff(x: number, y: number, count: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * rand(15, 70), vy: Math.sin(a) * rand(15, 70),
        life: 0, maxLife: rand(0.4, 1), size: rand(6, 16),
        type: 'smoke', seed: Math.random() * 10,
      });
    }
  }

  private spawnRocket() {
    const s = this.settings;
    const wrecks = this.rockets.filter((r) => !r.powered && !isIgniting(r));
    if (wrecks.length >= MAX_WRECKS) {
      let oldest = wrecks[0];
      for (const w of wrecks) if (w.drift > oldest.drift) oldest = w;
      this.puff(oldest.x, oldest.y, 5);
      this.rockets = this.rockets.filter((r) => r.id !== oldest.id);
    }

    const w = this.width;
    const h = this.height;
    const m = 60;
    let x = m; let y = m;
    for (let i = 0; i < 8; i++) {
      const side = Math.floor(Math.random() * 4);
      if (side === 0) { x = rand(m, w - m); y = m; }
      else if (side === 1) { x = w - m; y = rand(m, h - m); }
      else if (side === 2) { x = rand(m, w - m); y = h - m; }
      else { x = m; y = rand(m, h - m); }
      const ok = s.mode === 'chase'
        ? Math.hypot(x - this.cursor.x, y - this.cursor.y) > 200
        : !this.objectAt(x, y);
      if (ok) break;
    }

    const target = s.mode === 'build' ? this.pickTarget(x, y) : null;
    const aimX = s.mode === 'chase' ? this.cursor.x : target ? target.x : w / 2;
    const aimY = s.mode === 'chase' ? this.cursor.y : target ? target.y : h / 2;
    const tank = s.mode === 'chase' && s.fuelOn ? s.fuel : Infinity;

    this.rockets.push({
      id: this.nextId++,
      x, y, px: x, py: y,
      angle: Math.atan2(aimY - y, aimX - x),
      speed: 0, vx: 0, vy: 0,
      targetId: target ? target.id : null,
      trailAcc: 0, life: 0,
      orphan: s.mode === 'build' && !target,
      fuel: tank, maxFuel: tank,
      powered: true, drift: 0, spin: 0,
    });

    this.puff(x, y, 10);
    this.audio.whoosh();
  }

  private cutEngine(r: Rocket) {
    r.powered = false;
    r.ignitionTimer = undefined;
    r.fuel = 0;
    r.vx = Math.cos(r.angle) * r.speed;
    r.vy = Math.sin(r.angle) * r.speed;
    r.spin = rand(-0.7, 0.7);
    r.drift = 0;
    r.trailAcc = 0;
    const nozzle = NOZZLE_LEN * this.settings.scale;
    this.puff(r.x - Math.cos(r.angle) * nozzle, r.y - Math.sin(r.angle) * nozzle, 8);
    this.audio.sputter();
  }

  private explode(x: number, y: number, power: number, wood: number, metal = false) {
    const s = this.settings;
    const t = THEMES[s.theme];
    if (this.booms.length > 64) this.booms.shift();
    this.booms.push({ x, y, t: 0, power });
    this.shake = Math.max(this.shake, 24 * power);
    this.audio.boom(power);

    for (let i = 0; i < Math.round(80 * power); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(100, 540);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 70,
        life: 0, maxLife: rand(0.35, 0.95), size: rand(2, 5),
        type: 'spark', color: t.spark[Math.floor(Math.random() * t.spark.length)],
        seed: Math.random() * 10,
      });
    }
    for (let i = 0; i < Math.round(wood * power); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(70, 330);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 130,
        life: 0, maxLife: rand(0.6, 1.3), size: rand(4, 10),
        type: 'debris', color: t.wood[Math.random() > 0.5 ? 0 : 1],
        seed: Math.random() * 10,
      });
    }
    if (metal) {
      for (let i = 0; i < Math.round(28 * power); i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = rand(90, 380);
        this.particles.push({
          x, y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 140,
          life: 0, maxLife: rand(0.7, 1.4), size: rand(3, 9),
          type: 'debris', color: Math.random() > 0.5 ? '#cfd8dc' : '#78909c',
          seed: Math.random() * 10,
        });
      }
    }
    for (let i = 0; i < Math.round(30 * power); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(25, 130);
      this.particles.push({
        x: x + rand(-12, 12), y: y + rand(-12, 12),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: 0, maxLife: rand(0.8, 1.8), size: rand(14, 36),
        type: 'smoke', seed: Math.random() * 10,
      });
    }
  }

  private damage(o: SceneObject, x: number, y: number) {
    const s = this.settings;
    o.hp -= 1;
    o.flash = 1;
    this.hitsBuild += 1;
    if (o.hp <= 0) {
      this.explode(x, y, s.power, o.kind === 'wall' ? 46 : 30);
      this.objects = this.objects.filter((it) => it.id !== o.id);
    } else {
      this.explode(x, y, s.power * 0.6, 12);
    }
  }

  private emitTrail(r: Rocket, dt: number, s: Settings) {
    const low = Number.isFinite(r.fuel) && r.fuel < 1.2;
    r.trailAcc += dt * (low ? 0.45 : 1);
    const interval = 1 / clamp(s.trail, 20, 400);
    const nozzleOffset = NOZZLE_LEN * s.scale;
    const cos = Math.cos(r.angle);
    const sin = Math.sin(r.angle);

    let guard = 0;
    const totalToSpawn = Math.min(40, Math.floor(r.trailAcc / interval));

    while (r.trailAcc >= interval && guard < 40) {
      guard++;
      r.trailAcc -= interval;
      if (low && Math.random() < 0.4) continue;

      const t = totalToSpawn > 1 ? guard / totalToSpawn : 1;
      const rx = r.px + (r.x - r.px) * t;
      const ry = r.py + (r.y - r.py) * t;
      const tailX = rx - cos * nozzleOffset;
      const tailY = ry - sin * nozzleOffset;
      const back = rand(80, 140) * (low ? 0.6 : 1);

      this.particles.push({
        x: tailX, y: tailY,
        vx: -cos * back, vy: -sin * back,
        life: 0, maxLife: rand(0.12, 0.22),
        size: rand(2.5, 4.5) * s.scale * (low ? 0.7 : 1),
        type: 'flame', seed: Math.random() * 10,
      });

      if (Math.random() < 0.3) {
        this.particles.push({
          x: tailX + rand(-0.5, 0.5), y: tailY + rand(-0.5, 0.5),
          vx: -cos * rand(15, 45), vy: -sin * rand(15, 45),
          life: 0, maxLife: rand(0.5, 0.9),
          size: rand(4, 9) * s.scale, type: 'smoke', seed: Math.random() * 10,
        });
      }
    }
    if (guard >= 40 || r.trailAcc > interval) r.trailAcc = 0;
  }

  /* ---------- Истребитель: инициализация ---------- */

  private buildFighter() {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const hardpoints: Hardpoint[] = [
      { id: this.nextHardpointId++, side: 'left',   offsetX: -18, offsetY: -14, loaded: true, reloading: 0 },
      { id: this.nextHardpointId++, side: 'right',  offsetX:  18, offsetY: -14, loaded: true, reloading: 0 },
      { id: this.nextHardpointId++, side: 'left',   offsetX: -30, offsetY:  -4, loaded: true, reloading: 0 },
      { id: this.nextHardpointId++, side: 'right',  offsetX:  30, offsetY:  -4, loaded: true, reloading: 0 },
      { id: this.nextHardpointId++, side: 'center', offsetX:   0, offsetY:   8, loaded: true, reloading: 0 },
      { id: this.nextHardpointId++, side: 'center', offsetX:   0, offsetY:  14, loaded: true, reloading: 0 },
    ];
    this.fighter = {
      x: cx, y: cy,
      angle: 0, bank: 0,
      speed: this.settings.fighterSpeed,
      target: null, lockedId: null,
      patrolAngle: 0, hardpoints,
    };
  }

  private spawnRocketFromHardpoint(
    h: Hardpoint,
    targetX: number,
    targetY: number,
    targetId: number | null,
  ) {
    const f = this.fighter;
    if (!f) return;
    if (this.rockets.length >= MAX_ROCKETS_HARD) return;
    const s = this.settings;

    // Точка прицеливания фиксируется в момент пуска. Если захваченная цель
    // погибнет, ракета продолжит полёт в последнюю известную точку.
    const aimX = Number.isFinite(targetX) ? targetX : f.x;
    const aimY = Number.isFinite(targetY) ? targetY : f.y;

    const cos = Math.cos(f.angle);
    const sin = Math.sin(f.angle);
    const wx = f.x + cos * h.offsetX - sin * h.offsetY;
    const wy = f.y + sin * h.offsetX + cos * h.offsetY;

    const sideSign = h.side === 'left' ? -1
      : h.side === 'right' ? 1
      : h.offsetY > 10 ? 1 : -1;
    const ejectAngle = f.angle + sideSign * 0.35;
    const impulse = Number.isFinite(s.ejectImpulse) ? s.ejectImpulse : 80;
    const ejectVx = Math.cos(ejectAngle) * impulse + Math.cos(f.angle) * 60;
    const ejectVy = Math.sin(ejectAngle) * impulse + Math.sin(f.angle) * 60;

    this.rockets.push({
      id: this.nextId++,
      x: wx, y: wy, px: wx, py: wy,
      angle: f.angle,
      speed: Number.isFinite(s.fighterSpeed) ? s.fighterSpeed : 180,
      vx: ejectVx, vy: ejectVy,
      targetId,
      aimX, aimY,
      trailAcc: 0, life: 0,
      orphan: false,
      fuel: FIGHTER_ROCKET_FUEL, maxFuel: FIGHTER_ROCKET_FUEL,
      powered: false,
      drift: 0, spin: 0,
      ignitionTimer: Number.isFinite(s.ignitionDelay) ? Math.max(0, s.ignitionDelay) : 0.35,
      ejectVx, ejectVy,
      hardpointId: h.id,
    });

    this.puff(wx, wy, 4);
    this.audio.blip(880);
  }

  /* ---------- симуляция ---------- */

  private update(dt: number) {
    const s = this.settings;
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 90);

    for (const o of this.objects) o.flash = Math.max(0, o.flash - dt * 3);

    const fighterActive = s.mode === 'build' && s.fighterEnabled && !!this.fighter;
    if (fighterActive) this.updateFighter(dt);

    if (fighterActive && this.fighter) {
      const f = this.fighter;
      this.fighterTrailAcc += dt;
      const fInterval = 1 / Math.min(120, clamp(s.trail, 20, 400));
      let fg = 0;
      while (this.fighterTrailAcc >= fInterval && fg < 20) {
        fg++;
        this.fighterTrailAcc -= fInterval;
        const cos = Math.cos(f.angle);
        const sin = Math.sin(f.angle);
        const bx = f.x - cos * 36 * s.fighterScale;
        const by = f.y - sin * 36 * s.fighterScale;
        const t = THEMES[s.theme];
        this.particles.push({
          x: bx + rand(-1, 1), y: by + rand(-1, 1),
          vx: -cos * rand(40, 90), vy: -sin * rand(40, 90),
          life: 0, maxLife: rand(0.1, 0.2),
          size: rand(2, 4) * s.fighterScale,
          type: 'flame', color: t.flame[1], seed: Math.random() * 10,
        });
      }
      if (fg >= 20) this.fighterTrailAcc = 0;
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) { this.particles.splice(i, 1); continue; }
      if (p.type === 'flame' || p.type === 'smoke') {
        p.vx += Math.sin(this.time * 11 + p.seed) * s.turbulence * dt * 2.4;
        p.vy += Math.cos(this.time * 9 + p.seed) * s.turbulence * dt * 2.4;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === 'spark' || p.type === 'debris') {
        p.vy += 450 * dt;
        p.vx *= 0.96; p.vy *= 0.96;
      } else if (p.type === 'smoke') {
        p.size += 28 * dt;
        p.vx *= 0.94; p.vy *= 0.94;
      }
    }

    let active = 0;
    for (const r of this.rockets) if (r.powered) active++;

    // Автоспавн обычных ракет работает только в классической стройке.
    // С включённым истребителем ракеты выпускает исключительно он.
    const canSpawn = s.mode === 'chase' ||
      (s.mode === 'build' && !s.fighterEnabled && this.objects.length > 0);

    for (let i = this.salvoQueue.length - 1; i >= 0; i--) {
      const q = this.salvoQueue[i];
      q.t -= dt;
      if (q.t <= 0) {
        this.spawnRocketFromHardpoint(q.h, q.tx, q.ty, q.targetId);
        this.salvoQueue.splice(i, 1);
      }
    }

    if (s.auto && canSpawn && active < s.maxRockets && this.rockets.length < MAX_ROCKETS_HARD) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) { this.spawnRocket(); this.spawnTimer = this.delay(); }
    } else if (this.spawnTimer < 0) { this.spawnTimer = 0; }

    const noseLen = NOSE_LEN * s.scale;

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life += dt;
      r.px = r.x;
      r.py = r.y;

      if (
        !Number.isFinite(r.x) || !Number.isFinite(r.y) ||
        !Number.isFinite(r.angle) || !Number.isFinite(r.speed) ||
        !Number.isFinite(r.vx) || !Number.isFinite(r.vy)
      ) {
        this.rockets.splice(i, 1);
        continue;
      }

      // ДВУХФАЗНЫЙ ПУСК: пока идёт ignitionTimer, ракета не управляется ГСН
      // и не может стать "обломком" (даже если таймер равен 0).
      if (!r.powered && r.ignitionTimer !== undefined) {
        if (!Number.isFinite(r.ignitionTimer)) r.ignitionTimer = 0;
        if (r.ignitionTimer > 0) {
          const drop = Number.isFinite(s.ejectDrop) ? s.ejectDrop : 140;
          r.ignitionTimer -= dt;
          r.vx += Math.cos(r.angle) * 20 * dt;
          r.vy += drop * dt;
          r.x += r.vx * dt;
          r.y += r.vy * dt;
          r.angle = normAngle(r.angle + r.spin * dt);
          r.speed = Math.hypot(r.vx, r.vy);
        }
        if (r.ignitionTimer <= 0) {
          r.powered = true;
          const fighterFuel = r.hardpointId != null ? FIGHTER_ROCKET_FUEL : Infinity;
          r.fuel = fighterFuel;
          r.maxFuel = fighterFuel;
          r.vx = 0; r.vy = 0;
          r.spin = 0;
          this.booms.push({ x: r.x, y: r.y, t: 0, power: 0.35 });
          this.puff(r.x, r.y, 6);
          this.audio.sputter();
        }
        continue;
      }

      if (r.powered && Number.isFinite(r.fuel)) {
        r.fuel -= dt;
        if (r.fuel <= 0) this.cutEngine(r);
      }

      if (r.powered) {
        let aimX: number;
        let aimY: number;
        const fighterRocket = r.hardpointId != null;
        let trackedTarget: SceneObject | undefined;

        if (s.mode === 'chase') {
          aimX = this.cursor.x; aimY = this.cursor.y;
        } else if (fighterRocket) {
          trackedTarget = r.targetId !== null
            ? this.objects.find((it) => it.id === r.targetId)
            : undefined;
          if (trackedTarget) {
            aimX = trackedTarget.x; aimY = trackedTarget.y;
          } else if (r.aimX !== undefined && r.aimY !== undefined) {
            aimX = r.aimX; aimY = r.aimY;
          } else if (this.fighter && this.fighter.lockedId !== null) {
            const o = this.objects.find((it) => it.id === this.fighter!.lockedId);
            if (o) { aimX = o.x; aimY = o.y; }
            else { aimX = this.cursor.x; aimY = this.cursor.y; }
          } else {
            aimX = this.cursor.x; aimY = this.cursor.y;
          }
          r.orphan = !trackedTarget;
        } else {
          let obj = this.objects.find((o) => o.id === r.targetId) ?? null;
          if (!obj) {
            obj = this.pickTarget(r.x, r.y);
            r.targetId = obj ? obj.id : null;
          }
          r.orphan = !obj;
          if (obj) {
            aimX = clamp(r.x, obj.x - obj.w / 2, obj.x + obj.w / 2);
            aimY = clamp(r.y, obj.y - obj.h / 2, obj.y + obj.h / 2);
          } else {
            aimX = r.x + Math.cos(r.angle) * 120;
            aimY = r.y + Math.sin(r.angle) * 120;
          }
        }

        const prevNoseX = r.x + Math.cos(r.angle) * noseLen;
        const prevNoseY = r.y + Math.sin(r.angle) * noseLen;
        const dx = aimX - r.x;
        const dy = aimY - r.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 0.5) {
          const diff = normAngle(Math.atan2(dy, dx) - r.angle);
          const boost = dist < 160 ? 1 + (1 - dist / 160) * 2.4 : 1;
          const maxTurn = (s.agility * Math.PI / 180) * dt * boost;
          r.angle = normAngle(r.angle + clamp(diff, -maxTurn, maxTurn));
          const align = Math.max(0, Math.cos(diff));
          const wanted = s.speed * (0.32 + 0.68 * align);
          r.speed += (wanted - r.speed) * Math.min(1, dt * 3.2);
        } else {
          r.speed += (s.speed * 0.4 - r.speed) * Math.min(1, dt * 3);
        }

        r.vx = Math.cos(r.angle) * r.speed;
        r.vy = Math.sin(r.angle) * r.speed;
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        this.emitTrail(r, dt, s);

        const noseX = r.x + Math.cos(r.angle) * noseLen;
        const noseY = r.y + Math.sin(r.angle) * noseLen;

        // У ракеты истребителя может не остаться живого объекта-цели (цель
        // разрушена или пуск был по пустой точке). В этом случае долетаем до
        // зафиксированной точки прицеливания и взрываемся, а не кружим вокруг
        // неё бесконечно.
        if (fighterRocket && !trackedTarget) {
          const hitX = r.aimX !== undefined ? r.aimX : aimX;
          const hitY = r.aimY !== undefined ? r.aimY : aimY;
          const hitR = 16 * s.scale + 10;
          const reached =
            Math.hypot(noseX - hitX, noseY - hitY) <= hitR ||
            Math.hypot(r.x - hitX, r.y - hitY) <= hitR;
          if (reached) {
            this.explode(r.x, r.y, s.power, 0);
            this.rockets.splice(i, 1);
            continue;
          }
        }

        if (s.mode === 'chase') {
          const catchR = 18 * s.scale + 10;
          const caught =
            Math.hypot(noseX - this.cursor.x, noseY - this.cursor.y) <= catchR || dist <= 10;
          if (caught) {
            this.explode(this.cursor.x, this.cursor.y, s.power, 0);
            this.hitsChase += 1;
            this.rockets.splice(i, 1);
            this.spawnTimer = Math.max(this.spawnTimer, this.delay());
            continue;
          }
        } else {
          let hit: SceneObject | null = null;
          for (const o of this.objects) {
            const rect = { x: o.x - o.w / 2 - 2, y: o.y - o.h / 2 - 2, w: o.w + 4, h: o.h + 4 };
            if (segRect(prevNoseX, prevNoseY, noseX, noseY, rect)) { hit = o; break; }
          }
          if (hit) { this.damage(hit, noseX, noseY); this.rockets.splice(i, 1); continue; }
        }

        if (r.life > 16) {
          this.explode(r.x, r.y, s.power * 0.6, 0);
          this.rockets.splice(i, 1);
          continue;
        }
      } else {
        const k = Math.exp(-s.drag * 1.8 * dt);
        r.vx *= k; r.vy *= k;
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        r.angle = normAngle(r.angle + r.spin * dt);
        r.speed = Math.hypot(r.vx, r.vy);
        r.drift += dt;

        r.trailAcc += dt;
        if (r.drift < 1.6 && r.trailAcc > 0.2) {
          r.trailAcc = 0;
          this.puff(r.x - Math.cos(r.angle) * NOZZLE_LEN * s.scale, r.y - Math.sin(r.angle) * NOZZLE_LEN * s.scale, 1);
        }
        if (r.drift >= s.wreckLife) {
          this.puff(r.x, r.y, 5);
          this.rockets.splice(i, 1);
          continue;
        }
      }

      const out = r.x < -200 || r.x > this.width + 200 || r.y < -200 || r.y > this.height + 200;
      if (out) this.rockets.splice(i, 1);
    }

    this.resolveRocketCollisions();

    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    }
    for (let i = this.booms.length - 1; i >= 0; i--) {
      this.booms[i].t += dt;
      if (this.booms[i].t > 0.6) this.booms.splice(i, 1);
    }
    for (const d of this.dust) {
      d.y -= d.s * dt * 0.4;
      d.x += Math.sin(this.time * 0.6 + d.ph) * dt * 8;
      if (d.y < -4) { d.y = this.height + 4; d.x = Math.random() * this.width; }
    }

    this.audio.setEngine(
      active > 0 ? 0.02 + 0.035 * Math.min(1, active / 3) : 0,
      240 + s.speed * 0.9,
    );

    this.hudTimer += dt;
    if (this.hudTimer >= 0.15) {
      this.hudTimer = 0;
      let speed = 0;
      let flying = 0;
      let poweredCount = 0;
      let wrecks = 0;
      let fuel = -1;
      let fuelPct = 1;
      let nearest = Infinity;
      for (const r of this.rockets) {
        if (r.powered) {
          flying++;
          poweredCount++;
          speed += r.speed;
          const d = Math.hypot(r.x - this.cursor.x, r.y - this.cursor.y);
          if (d < nearest) {
            nearest = d;
            fuel = Number.isFinite(r.fuel) ? Math.max(0, r.fuel) : -1;
            fuelPct = Number.isFinite(r.maxFuel) && r.maxFuel > 0
              ? clamp(r.fuel / r.maxFuel, 0, 1)
              : 1;
          }
        } else if (isIgniting(r)) {
          flying++;
        } else { wrecks++; }
      }
      this.onHud({
        targets: this.objects.length,
        flying,
        wrecks,
        hits: s.mode === 'chase' ? this.hitsChase : this.hitsBuild,
        collisions: this.collisions,
        fps: Math.round(this.fps),
        speed: poweredCount ? Math.round(speed / poweredCount) : 0,
        fuel, fuelPct,
        fighterLoaded: this.fighter
          ? this.fighter.hardpoints.filter((h) => h.loaded).length : 0,
        fighterTotal: this.fighter ? this.fighter.hardpoints.length : 0,
      });
    }
  }

  /* ---------- Истребитель: обновление ---------- */

  private updateFighter(dt: number) {
    const f = this.fighter;
    if (!f) return;
    const s = this.settings;

    if (
      !Number.isFinite(f.x) || !Number.isFinite(f.y) ||
      !Number.isFinite(f.angle) || !Number.isFinite(f.bank)
    ) {
      f.x = this.width / 2;
      f.y = this.height / 2;
      f.angle = 0;
      f.bank = 0;
    }

    for (const h of f.hardpoints) {
      if (!h.loaded) {
        h.reloading -= dt;
        if (h.reloading <= 0) { h.loaded = true; h.reloading = 0; }
      }
    }

    let tx: number, ty: number;
    if (f.lockedId !== null) {
      const o = this.objects.find((it) => it.id === f.lockedId);
      if (o) { tx = o.x; ty = o.y; }
      else { f.lockedId = null; tx = this.cursor.x; ty = this.cursor.y; }
    } else {
      tx = this.cursor.x;
      ty = this.cursor.y;
    }

    if (s.autoPatrol && f.lockedId === null && !this.cursor.inside) {
      f.patrolAngle += dt * 0.35;
      const r = Math.min(this.width, this.height) * 0.28;
      tx = this.width / 2 + Math.cos(f.patrolAngle) * r;
      ty = this.height / 2 + Math.sin(f.patrolAngle) * r;
    }

    const dx = tx - f.x;
    const dy = ty - f.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      const desired = Math.atan2(dy, dx);
      const diff = normAngle(desired - f.angle);
      const turnRate = Number.isFinite(s.fighterTurn) ? s.fighterTurn : 90;
      const maxTurn = Math.max(1e-6, (turnRate * Math.PI / 180) * dt);
      const turn = clamp(diff, -maxTurn, maxTurn);
      f.angle = normAngle(f.angle + turn);
      f.bank = clamp(turn / maxTurn, -1, 1);
    } else {
      f.bank *= Math.exp(-3 * dt);
    }

    const flySpeed = Number.isFinite(s.fighterSpeed) ? s.fighterSpeed : 180;
    f.x += Math.cos(f.angle) * flySpeed * dt;
    f.y += Math.sin(f.angle) * flySpeed * dt;

    const margin = 60;
    if (f.x < margin || f.x > this.width - margin ||
        f.y < margin || f.y > this.height - margin) {
      f.patrolAngle = Math.atan2(this.height / 2 - f.y, this.width / 2 - f.x);
    }
    f.x = clamp(f.x, 10, this.width - 10);
    f.y = clamp(f.y, 10, this.height - 10);
  }

  /* ---------- Столкновения ракет ---------- */

  private resolveRocketCollisions() {
    const s = this.settings;
    if (!s.collisions || this.rockets.length < 2) return;

    const radius = BODY_R * 2 * s.scale;
    // Ракеты на этапе сброса/зажигания ещё не управляются и не должны
    // взрываться друг о друга сразу после выхода из пилонов.
    const list = this.rockets.filter((r) => !isIgniting(r));
    const gone = new Set<number>();

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (gone.has(a.id)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (gone.has(b.id)) continue;
        const hit = segCircle(
          a.px - b.px, a.py - b.py,
          a.x - b.x, a.y - b.y,
          radius,
        );
        if (hit) {
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          this.explode(mx, my, s.power * 1.25, 0, true);
          this.collisions += 1;
          gone.add(a.id);
          gone.add(b.id);
          break;
        }
      }
    }

    if (gone.size > 0) this.rockets = this.rockets.filter((r) => !gone.has(r.id));
  }

  /* ---------- фон ---------- */

  private buildBackground() {
    const w = this.width;
    const h = this.height;
    if (w < 2 || h < 2) return;
    const t = THEMES[this.settings.theme];
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * this.dpr));
    c.height = Math.max(1, Math.round(h * this.dpr));
    const g = c.getContext('2d');
    if (!g) return;
    g.scale(this.dpr, this.dpr);

    const base = g.createLinearGradient(0, 0, w * 0.35, h);
    base.addColorStop(0, t.bgTop);
    base.addColorStop(1, t.bgBottom);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);

    const neb = (x: number, y: number, r: number, color: string) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `${color}33`);
      gr.addColorStop(0.6, `${color}12`);
      gr.addColorStop(1, `${color}00`);
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    };
    neb(w * 0.22, h * 0.26, Math.max(w, h) * 0.55, t.nebula[0]);
    neb(w * 0.84, h * 0.76, Math.max(w, h) * 0.48, t.nebula[1]);
    neb(w * 0.55, h * 0.1, Math.max(w, h) * 0.3, t.accent);

    for (let i = 0; i < 170; i++) {
      g.globalAlpha = rand(0.15, 0.85);
      g.fillStyle = t.star;
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, rand(0.4, 1.7), 0, Math.PI * 2);
      g.fill();
    }

    g.globalAlpha = 0.06;
    g.fillStyle = t.accent;
    for (let x = 24; x < w; x += 48) {
      for (let y = 24; y < h; y += 48) g.fillRect(x, y, 1.5, 1.5);
    }
    g.globalAlpha = 1;

    const vig = g.createRadialGradient(
      w / 2, h / 2, Math.min(w, h) * 0.32,
      w / 2, h / 2, Math.max(w, h) * 0.78,
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = vig;
    g.fillRect(0, 0, w, h);

    this.bg = c;
    this.bgTheme = this.settings.theme;
    this.dust = Array.from({ length: 28 }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: rand(0.6, 2.2), s: rand(4, 14), ph: rand(0, Math.PI * 2),
    }));
  }

  /* ---------- отрисовка ---------- */

  private drawGuides(t: Theme) {
    const ctx = this.ctx;
    const s = this.settings;
    ctx.save();
    ctx.strokeStyle = t.accent;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 9]);
    ctx.lineDashOffset = -this.time * 40;
    for (const r of this.rockets) {
      if (!r.powered) continue;
      let tx = this.cursor.x;
      let ty = this.cursor.y;
      if (s.mode === 'build') {
        const o = this.objects.find((it) => it.id === r.targetId);
        if (o) {
          tx = o.x; ty = o.y;
        } else if (r.aimX !== undefined && r.aimY !== undefined) {
          tx = r.aimX; ty = r.aimY;
        } else {
          continue;
        }
      }
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawObject(o: SceneObject, t: Theme) {
    const ctx = this.ctx;
    const age = this.time - o.born;
    const pop = age < 0.3 ? 0.7 + 0.3 * (1 - Math.pow(1 - age / 0.3, 3)) : 1;
    const hw = o.w / 2;
    const hh = o.h / 2;

    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(pop, pop);

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(0, hh + 7, hw * 0.95, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    if (o.kind === 'target') {
      ctx.fillStyle = t.wood[0];
      ctx.fillRect(-hw, -hh, o.w, o.h);
      ctx.strokeStyle = t.wood[1];
      ctx.lineWidth = 2;
      ctx.strokeRect(-hw, -hh, o.w, o.h);
      ctx.beginPath();
      ctx.moveTo(-hw, -hh); ctx.lineTo(hw, hh);
      ctx.moveTo(hw, -hh); ctx.lineTo(-hw, hh);
      ctx.stroke();

      ctx.fillStyle = t.hot;
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = t.hot;
      ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#6b7280';
      ctx.fillRect(-hw, -hh, o.w, o.h);
      ctx.strokeStyle = '#3f4652';
      ctx.lineWidth = 1.5;
      const brickH = 14;
      let row = 0;
      for (let y = -hh; y < hh; y += brickH, row++) {
        ctx.beginPath();
        ctx.moveTo(-hw, y); ctx.lineTo(hw, y);
        ctx.stroke();
        const offset = row % 2 === 0 ? 0 : 14;
        for (let x = -hw + offset; x < hw; x += 28) {
          ctx.beginPath();
          ctx.moveTo(x, y); ctx.lineTo(x, Math.min(y + brickH, hh));
          ctx.stroke();
        }
      }
      ctx.strokeStyle = '#2b313c';
      ctx.lineWidth = 2;
      ctx.strokeRect(-hw, -hh, o.w, o.h);

      const dmg = o.maxHp - o.hp;
      if (dmg > 0) {
        ctx.strokeStyle = 'rgba(18,18,24,0.85)';
        ctx.lineWidth = 2;
        for (let c = 0; c < dmg; c++) {
          const sx = -hw + ((o.id * 37 + c * 53) % Math.max(1, o.w - 12)) + 5;
          const sy = -hh + ((o.id * 21 + c * 31) % Math.max(1, o.h - 20)) + 3;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + 7, sy + 6);
          ctx.lineTo(sx + 2, sy + 12);
          ctx.lineTo(sx + 10, sy + 18);
          ctx.stroke();
        }
      }
    }

    if (o.flash > 0) {
      ctx.globalAlpha = o.flash * 0.7;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-hw, -hh, o.w, o.h);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (o.kind === 'wall' && o.hp < o.maxHp) {
      const bw = Math.max(o.w, 44);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(o.x - bw / 2, o.y - o.h / 2 - 12, bw, 5);
      ctx.fillStyle = o.hp === 1 ? t.hot : t.warn;
      ctx.fillRect(o.x - bw / 2, o.y - o.h / 2 - 12, bw * (o.hp / o.maxHp), 5);
    }
  }

  private drawGhost(t: Theme) {
    const s = this.settings;
    const p = this.cursor;
    if (!p.inside) return;
    const ctx = this.ctx;

    if (s.tool === 'erase') {
      const o = this.objectAt(p.x, p.y);
      if (!o) return;
      ctx.save();
      ctx.strokeStyle = t.hot;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -this.time * 24;
      ctx.strokeRect(o.x - o.w / 2 - 5, o.y - o.h / 2 - 5, o.w + 10, o.h + 10);
      ctx.restore();
      return;
    }

    // С активным истребителем наведение на объект означает захват, а не
    // постройку поверх него — подсвечиваем объект вместо призрака блока.
    if (s.fighterEnabled) {
      const o = this.objectAt(p.x, p.y);
      if (o) {
        ctx.save();
        ctx.strokeStyle = t.accent2;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.lineDashOffset = -this.time * 28;
        ctx.globalAlpha = 0.9;
        ctx.strokeRect(o.x - o.w / 2 - 7, o.y - o.h / 2 - 7, o.w + 14, o.h + 14);
        ctx.restore();
        return;
      }
    }

    const w = s.tool === 'target' ? 46 : s.wallVertical ? 28 : 118;
    const h = s.tool === 'target' ? 46 : s.wallVertical ? 118 : 28;
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = t.accent;
    ctx.fillRect(p.x - w / 2, p.y - h / 2, w, h);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = t.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 5]);
    ctx.lineDashOffset = -this.time * 20;
    ctx.strokeRect(p.x - w / 2, p.y - h / 2, w, h);
    ctx.restore();
  }

  private drawReticle(t: Theme) {
    const ctx = this.ctx;
    let nearest = Infinity;
    for (const r of this.rockets) {
      if (!r.powered) continue;
      nearest = Math.min(nearest, Math.hypot(r.x - this.cursor.x, r.y - this.cursor.y));
    }
    const near = clamp(1 - nearest / 240, 0, 1);
    const pulse = 0.85 + 0.15 * Math.sin(this.time * (4 + near * 10));

    ctx.save();
    ctx.translate(this.cursor.x, this.cursor.y);
    ctx.strokeStyle = near > 0.6 ? t.hot : t.accent;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.9;
    ctx.setLineDash([7, 6]);
    ctx.lineDashOffset = -this.time * 26;
    ctx.beginPath();
    ctx.arc(0, 0, 22 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.9;
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i + this.time * 0.8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 27, Math.sin(a) * 27);
      ctx.lineTo(Math.cos(a) * 33, Math.sin(a) * 33);
      ctx.stroke();
    }

    ctx.fillStyle = near > 0.6 ? t.hot : t.accent;
    ctx.beginPath();
    ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawParticles(t: Theme) {
    const ctx = this.ctx;
    const s = this.settings;

    for (const p of this.particles) {
      if (p.type !== 'smoke') continue;
      const pr = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = `rgba(${t.smoke[0]}, ${t.smoke[1]}, ${t.smoke[2]}, ${(1 - pr) * 0.42})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.1, p.size), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glowBoost = 1 + s.glow / 140;
    for (const p of this.particles) {
      if (p.type === 'smoke') continue;
      const pr = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = 1 - pr;
      if (p.type === 'flame') {
        ctx.fillStyle = pr < 0.3 ? t.flame[0] : pr < 0.65 ? t.flame[1] : t.flame[2];
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.1, p.size * (1 - pr * 0.7) * glowBoost), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'spark') {
        ctx.fillStyle = p.color || t.flame[0];
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.1, p.size * (1 - pr * 0.4)), 0, Math.PI * 2);
        ctx.fill();
      } else {
        const r = Math.max(0.1, p.size * (1 - pr * 0.3));
        ctx.fillStyle = p.color || t.debris;
        ctx.fillRect(p.x - r / 2, p.y - r / 2, r, r);
      }
    }
    ctx.restore();
  }

  private drawRocket(r: Rocket, s: Settings, t: Theme) {
    const ctx = this.ctx;
    if (
      !Number.isFinite(r.x) || !Number.isFinite(r.y) ||
      !Number.isFinite(r.angle) || !Number.isFinite(r.speed) ||
      !Number.isFinite(r.vx) || !Number.isFinite(r.vy)
    ) return;
    const igniting = isIgniting(r);
    const alive = r.powered || igniting;
    const fade = alive ? 1 : clamp((s.wreckLife - r.drift) / 1.2, 0, 1);

    if (!alive && r.speed > 4) {
      ctx.save();
      ctx.globalAlpha = 0.28 * fade;
      ctx.strokeStyle = t.accent2;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 7]);
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(
        r.x + (r.vx / r.speed) * (30 + r.speed * 0.35),
        r.y + (r.vy / r.speed) * (30 + r.speed * 0.35),
      );
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = fade * (alive ? 1 : 0.85);
    ctx.translate(r.x, r.y);
    ctx.rotate(r.angle);
    ctx.scale(s.scale, s.scale);

    const hi = alive ? '#9aa06b' : '#a7a79c';
    const mid = alive ? '#6f7448' : '#7c7c72';
    const lo = alive ? '#41452a' : '#4a4a44';
    const edge = alive ? '#2b2e1c' : '#33332e';

    if (r.powered) {
      const haloR = 24 + s.glow * 0.22;
      const halo = ctx.createRadialGradient(-26, 0, 0, -26, 0, haloR);
      halo.addColorStop(0, 'rgba(255,210,120,0.55)');
      halo.addColorStop(0.5, 'rgba(255,140,60,0.28)');
      halo.addColorStop(1, 'rgba(255,87,34,0)');
      ctx.globalAlpha = fade * (0.3 + s.glow / 200);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(-26, 0, haloR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = fade * (alive ? 1 : 0.85);
    }

    ctx.fillStyle = edge;
    ctx.beginPath();
    ctx.moveTo(-24, -5); ctx.lineTo(-29, -7); ctx.lineTo(-29, 7); ctx.lineTo(-24, 5);
    ctx.closePath(); ctx.fill();

    const finFill = ctx.createLinearGradient(0, -16, 0, 16);
    finFill.addColorStop(0, hi); finFill.addColorStop(0.5, mid); finFill.addColorStop(1, lo);

    ctx.fillStyle = finFill;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-11, -7.5); ctx.lineTo(-26, -7.5); ctx.lineTo(-26, -16); ctx.lineTo(-17, -7.5);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-11, 7.5); ctx.lineTo(-26, 7.5); ctx.lineTo(-26, 16); ctx.lineTo(-17, 7.5);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    ctx.fillStyle = lo;
    ctx.beginPath();
    ctx.moveTo(-12, 0); ctx.lineTo(-27, -2.2); ctx.lineTo(-27, 2.2);
    ctx.closePath(); ctx.fill();

    const R = 8.5;
    const body = ctx.createLinearGradient(0, -R, 0, R);
    body.addColorStop(0, hi); body.addColorStop(0.32, mid); body.addColorStop(1, lo);

    ctx.beginPath();
    ctx.moveTo(32, 0);
    ctx.bezierCurveTo(24, -1.6, 16, -5, 9, -R);
    ctx.lineTo(-24, -R);
    ctx.lineTo(-24, R);
    ctx.lineTo(9, R);
    ctx.bezierCurveTo(16, 5, 24, 1.6, 32, 0);
    ctx.closePath();
    ctx.fillStyle = body; ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 1.1; ctx.stroke();

    ctx.globalAlpha = fade * 0.5;
    ctx.strokeStyle = hi; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(12, -5.2); ctx.lineTo(-22, -5.2);
    ctx.stroke();
    ctx.globalAlpha = fade * (alive ? 1 : 0.85);

    ctx.strokeStyle = edge; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(9, -R); ctx.lineTo(9, R); ctx.stroke();

    ctx.lineWidth = 1;
    ctx.globalAlpha = fade * 0.7;
    ctx.beginPath(); ctx.moveTo(-12, -R); ctx.lineTo(-12, R); ctx.stroke();
    ctx.globalAlpha = fade * (alive ? 1 : 0.85);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(29, -1, 1.4, 0, Math.PI * 2); ctx.fill();

    ctx.restore();

    if (s.mode === 'chase' && s.showFuel && alive && Number.isFinite(r.maxFuel) && r.maxFuel > 0) {
      const pct = clamp(r.fuel / r.maxFuel, 0, 1);
      const bw = 30 * s.scale;
      const bx = r.x - bw / 2;
      const by = r.y - 30 * s.scale;
      const blink = pct < 0.25 ? 0.55 + 0.45 * Math.sin(this.time * 14) : 1;
      ctx.save();
      ctx.globalAlpha = 0.9 * blink;
      ctx.fillStyle = 'rgba(4,7,16,0.75)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
      ctx.fillStyle = pct < 0.25 ? t.hot : pct < 0.55 ? t.warn : t.ok;
      ctx.fillRect(bx, by, bw * pct, 4);
      ctx.restore();
    }
  }

  /* ---------- Истребитель: отрисовка ---------- */

  private drawFighter(f: Fighter, s: Settings) {
    const ctx = this.ctx;
    if (
      !Number.isFinite(f.x) || !Number.isFinite(f.y) ||
      !Number.isFinite(f.angle) || !Number.isFinite(f.bank)
    ) return;
    const scale = Number.isFinite(s.fighterScale) && s.fighterScale > 0 ? s.fighterScale : 1;
    const bank = clamp(f.bank, -1, 1);

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    ctx.scale(scale, scale);
    ctx.transform(1, 0, 0, 1 - Math.abs(bank) * 0.15, 0, 0);

    const hi = '#b8c0a0';
    const mid = '#7a8260';
    const lo = '#4a5038';
    const edge = '#2a2e20';
    const glass = '#38bdf8';

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(4, 6, 42, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    const wingGrad = ctx.createLinearGradient(0, -FIGHTER_WING, 0, FIGHTER_WING);
    wingGrad.addColorStop(0, hi); wingGrad.addColorStop(0.5, mid); wingGrad.addColorStop(1, lo);

    ctx.fillStyle = wingGrad;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, -6); ctx.lineTo(-14, -FIGHTER_WING);
    ctx.lineTo(-26, -FIGHTER_WING); ctx.lineTo(-18, -6);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(8, 6); ctx.lineTo(-14, FIGHTER_WING);
    ctx.lineTo(-26, FIGHTER_WING); ctx.lineTo(-18, 6);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    ctx.fillStyle = mid;
    ctx.beginPath();
    ctx.moveTo(-22, -4); ctx.lineTo(-34, -18);
    ctx.lineTo(-40, -18); ctx.lineTo(-30, -4);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-22, 4); ctx.lineTo(-34, 18);
    ctx.lineTo(-40, 18); ctx.lineTo(-30, 4);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = lo;
    ctx.beginPath();
    ctx.moveTo(-28, 0); ctx.lineTo(-38, -8);
    ctx.lineTo(-42, -8); ctx.lineTo(-36, 0);
    ctx.lineTo(-42, 8); ctx.lineTo(-38, 8);
    ctx.closePath(); ctx.fill();

    const bodyGrad = ctx.createLinearGradient(0, -9, 0, 9);
    bodyGrad.addColorStop(0, hi); bodyGrad.addColorStop(0.5, mid); bodyGrad.addColorStop(1, lo);
    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = edge;
    ctx.beginPath();
    ctx.moveTo(36, 0);
    ctx.bezierCurveTo(28, -3, 18, -7, 6, -9);
    ctx.lineTo(-30, -9); ctx.lineTo(-36, -6);
    ctx.lineTo(-36, 6); ctx.lineTo(-30, 9);
    ctx.lineTo(6, 9);
    ctx.bezierCurveTo(18, 7, 28, 3, 36, 0);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    ctx.fillStyle = glass;
    ctx.strokeStyle = edge;
    ctx.beginPath();
    ctx.ellipse(12, 0, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(14, -1.5, 3, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const afterburner = 6 + Math.sin(this.time * 30) * 2;
    const flameGrad = ctx.createLinearGradient(-36, 0, -36 - afterburner, 0);
    flameGrad.addColorStop(0, 'rgba(255,240,180,0.95)');
    flameGrad.addColorStop(0.4, 'rgba(255,160,60,0.7)');
    flameGrad.addColorStop(1, 'rgba(255,80,30,0)');
    ctx.fillStyle = flameGrad;
    ctx.beginPath();
    ctx.moveTo(-34, -3); ctx.lineTo(-34 - afterburner, 0); ctx.lineTo(-34, 3);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-34, 3); ctx.lineTo(-34 - afterburner, 0); ctx.lineTo(-34, 9);
    ctx.closePath(); ctx.fill();

    for (const h of f.hardpoints) {
      if (!h.loaded) continue;
      const rx = h.offsetX;
      const ry = h.offsetY;
      ctx.fillStyle = edge;
      ctx.fillRect(rx - 1, ry - 1.5, 2, 3);
      const rLen = 14;
      const rR = 1.8;
      ctx.fillStyle = '#c8c8c0';
      ctx.strokeStyle = edge;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(rx + rLen, ry);
      ctx.lineTo(rx + 2, ry - rR);
      ctx.lineTo(rx - rLen + 2, ry - rR);
      ctx.lineTo(rx - rLen + 2, ry + rR);
      ctx.lineTo(rx + 2, ry + rR);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e53935';
      ctx.beginPath();
      ctx.moveTo(rx + rLen, ry);
      ctx.lineTo(rx + rLen - 3, ry - rR);
      ctx.lineTo(rx + rLen - 3, ry + rR);
      ctx.closePath(); ctx.fill();
    }

    ctx.restore();
  }

  private drawLock(f: Fighter, t: Theme) {
    if (f.lockedId === null) return;
    const o = this.objects.find((it) => it.id === f.lockedId);
    if (!o) return;
    const ctx = this.ctx;
    const pulse = 0.7 + 0.3 * Math.sin(this.time * 8);
    ctx.save();
    ctx.strokeStyle = t.hot;
    ctx.lineWidth = 2;
    ctx.globalAlpha = pulse;
    const pad = 10;
    const s = 14;
    const corners = [
      [o.x - o.w / 2 - pad, o.y - o.h / 2 - pad],
      [o.x + o.w / 2 + pad, o.y - o.h / 2 - pad],
      [o.x + o.w / 2 + pad, o.y + o.h / 2 + pad],
      [o.x - o.w / 2 - pad, o.y + o.h / 2 + pad],
    ];
    for (let i = 0; i < 4; i++) {
      const [x, y] = corners[i];
      const dx = i === 0 || i === 3 ? 1 : -1;
      const dy = i < 2 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(x, y + dy * s);
      ctx.lineTo(x, y);
      ctx.lineTo(x + dx * s, y);
      ctx.stroke();
    }
    ctx.setLineDash([4, 6]);
    ctx.lineDashOffset = -this.time * 40;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(o.x, o.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawBooms(t: Theme) {
    const ctx = this.ctx;
    const s = this.settings;
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'lighter';
      for (const b of this.booms) {
        // Отрицательный t давал alpha/hex за пределами диапазона (например #ff154),
        // addColorStop() кидал SyntaxError и render() останавливал RAF.
        if (!Number.isFinite(b.t) || b.t < 0) continue;
        if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.power)) continue;
        const ps = 0.75 + b.power * 0.35;
        if (b.t < 0.15) {
          const fp = clamp(b.t / 0.15, 0, 1);
          const r = Math.max(1, (40 + 160 * fp) * ps);
          const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
          const glow = Number.isFinite(s.glow) ? s.glow : 60;
          g.addColorStop(0, `rgba(255,255,255,${clamp((1 - fp * 0.5) * (0.5 + glow / 200), 0, 1)})`);
          g.addColorStop(0.45, `${t.flame[1]}${Math.round(clamp(1 - fp, 0, 1) * 255).toString(16).padStart(2, '0')}`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fill();
        }
        if (b.t < 0.35) {
          const cp = clamp(b.t / 0.35, 0, 1);
          const r = Math.max(1, (25 + 90 * Math.sin(cp * Math.PI * 0.5)) * ps);
          const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
          g.addColorStop(0, `rgba(255,241,180,${(1 - cp) * 0.9})`);
          g.addColorStop(0.6, `rgba(255,140,60,${(1 - cp) * 0.65})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fill();
        }
        if (b.t < 0.55) {
          const wp = clamp(b.t / 0.55, 0, 1);
          const eased = 1 - Math.pow(1 - wp, 3);
          ctx.strokeStyle = t.accent2;
          ctx.globalAlpha = (1 - wp) * 0.85;
          ctx.lineWidth = Math.max(0.5, 12 * (1 - wp));
          ctx.beginPath();
          ctx.arc(b.x, b.y, (15 + eased * 250) * ps, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    } finally {
      ctx.restore();
    }
  }

  private render() {
    const s = this.settings;
    const t = THEMES[s.theme];
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Если предыдущий кадр упал между save()/restore(), состояние canvas
    // могло «залипнуть». reset() доступен в современных браузерах/Electron
    // и гарантирует чистое состояние перед отрисовкой. После reset()
    // обязательно возвращаем DPR-масштаб, иначе canvas рисует в половину размера.
    if (typeof ctx.reset === 'function') {
      ctx.reset();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    if (this.bgTheme !== s.theme) this.buildBackground();

    ctx.fillStyle = t.bgBottom;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    try {
      if (this.shake > 0) {
        ctx.translate(rand(-0.5, 0.5) * this.shake, rand(-0.5, 0.5) * this.shake);
      }
      if (this.bg) ctx.drawImage(this.bg, 0, 0, w, h);

      ctx.fillStyle = t.star;
      ctx.globalAlpha = 0.22;
      for (const d of this.dust) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (s.guide) this.drawGuides(t);

      if (s.mode === 'build') {
        for (const o of this.objects) this.drawObject(o, t);
        this.drawGhost(t);
      } else if (s.reticle) {
        this.drawReticle(t);
      }

      if (s.mode === 'build' && s.fighterEnabled && this.fighter) {
        this.drawFighter(this.fighter, s);
        if (s.showLock) this.drawLock(this.fighter, t);
      }

      this.drawParticles(t);
      for (const r of this.rockets) this.drawRocket(r, s, t);
      this.drawBooms(t);
    } finally {
      // Всегда возвращаем canvas-state, даже если какой-то draw* бросил исключение.
      ctx.restore();
    }
  }

  private loop = (time: number) => {
    if (this.dead) return;

    // Следующий кадр планируем ДО update/render: исключение ниже больше
    // не может навсегда остановить игровой цикл.
    this.raf = requestAnimationFrame(this.loop);

    const dt = clamp((time - this.last) / 1000, 0, 0.05);
    this.last = time;

    try {
      if (dt > 0) {
        this.fps = this.fps * 0.92 + (1 / dt) * 0.08;
        this.update(dt);
      }
    } catch (err) {
      console.error('Rocket update error:', err);
    }

    try {
      this.render();
    } catch (err) {
      console.error('Rocket render error:', err);
    }
  };
}

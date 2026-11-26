import {
  BODY_R, DEFAULTS, MAX_PARTICLES, MAX_ROCKETS_HARD, MAX_WRECKS, NOSE_LEN, NOZZLE_LEN,
  TARGET_HP, THEMES, WALL_HP,
  clamp, normAngle, rand, segCircle, segRect,
  type Boom, type Dust, type Mode, type ObjKind, type Particle, type Rocket,
  type SceneObject, type Settings, type Theme, type ThemeKey,
} from './config';
import { RocketAudio } from './audio';

export interface HudState {
  targets: number;
  flying: number;
  wrecks: number;
  hits: number;
  collisions: number;
  fps: number;
  speed: number;
  fuel: number;      // секунды; -1 = бесконечный бак
  fuelPct: number;   // 0..1
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
    if (next.mode !== prev.mode) this.applyMode(next.mode);

    // выключили топливо — доливаем бак всем живым ракетам
    if (next.mode === 'build' || !next.fuelOn) {
      for (const r of this.rockets) {
        if (r.powered && Number.isFinite(r.maxFuel)) {
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
    if (button === 2) {
      if (this.settings.mode === 'build') this.removeAt(x, y);
      return;
    }
    if (this.settings.mode === 'chase') this.launch();
    else this.placeAt(x, y);
  }

  launch() {
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
    const wrecks = this.rockets.filter((r) => !r.powered);
    if (wrecks.length === 0) {
      this.onToast({ text: 'Обломков на сцене нет' });
      return;
    }
    for (const w of wrecks) this.puff(w.x, w.y, 6);
    this.rockets = this.rockets.filter((r) => r.powered);
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
  }

  /* ---------- служебное ---------- */

  private onWindowResize = () => this.resize();

  private delay() {
    return this.settings.mode === 'chase' ? this.settings.respawnDelay : this.settings.launchDelay;
  }

  private applyMode(mode: Mode) {
    this.rockets = [];
    this.spawnTimer = 0.25;
    if (mode === 'chase' && !this.cursor.known) {
      this.cursor.x = this.width * 0.55;
      this.cursor.y = this.height * 0.45;
    }
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
      w,
      h,
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
    if (s.tool === 'erase') {
      this.removeAt(x, y);
      return;
    }
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
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
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

    // не даём сцене зарасти обломками
    const wrecks = this.rockets.filter((r) => !r.powered);
    if (wrecks.length >= MAX_WRECKS) {
      let oldest = wrecks[0];
      for (const w of wrecks) if (w.drift > oldest.drift) oldest = w;
      this.puff(oldest.x, oldest.y, 5);
      this.rockets = this.rockets.filter((r) => r.id !== oldest.id);
    }

    const w = this.width;
    const h = this.height;
    const m = 60;
    let x = m;
    let y = m;
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
      x, y,
      px: x, py: y,
      angle: Math.atan2(aimY - y, aimX - x),
      speed: 0,
      vx: 0, vy: 0,
      targetId: target ? target.id : null,
      trailAcc: 0,
      life: 0,
      orphan: s.mode === 'build' && !target,
      fuel: tank,
      maxFuel: tank,
      powered: true,
      drift: 0,
      spin: 0,
    });

    this.puff(x, y, 10);
    this.audio.whoosh();
  }

  private cutEngine(r: Rocket) {
    r.powered = false;
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
    const interval = 1 / s.trail;
    const nozzle = NOZZLE_LEN * s.scale;
    const tailX = r.x - Math.cos(r.angle) * nozzle;
    const tailY = r.y - Math.sin(r.angle) * nozzle;
    let guard = 0;
    while (r.trailAcc >= interval && guard < 40) {
      guard++;
      r.trailAcc -= interval;
      if (low && Math.random() < 0.4) continue; // двигатель чихает на остатках
      const back = rand(130, 220) * (low ? 0.6 : 1);
      this.particles.push({
        x: tailX + rand(-3, 3), y: tailY + rand(-3, 3),
        vx: -Math.cos(r.angle) * back + rand(-25, 25),
        vy: -Math.sin(r.angle) * back + rand(-25, 25),
        life: 0, maxLife: rand(0.14, 0.26),
        size: rand(4, 8) * s.scale * (low ? 0.7 : 1), type: 'flame', seed: Math.random() * 10,
      });
      if (Math.random() < 0.3) {
        this.particles.push({
          x: tailX + rand(-5, 5), y: tailY + rand(-5, 5),
          vx: rand(-20, 20), vy: rand(-25, 5),
          life: 0, maxLife: rand(0.6, 1.1),
          size: rand(5, 11) * s.scale, type: 'smoke', seed: Math.random() * 10,
        });
      }
    }
    if (r.trailAcc > interval) r.trailAcc = 0;
  }

  /* ---------- симуляция ---------- */

  private update(dt: number) {
    const s = this.settings;
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 90);

    for (const o of this.objects) o.flash = Math.max(0, o.flash - dt * 3);

    let active = 0;
    for (const r of this.rockets) if (r.powered) active++;

    const canSpawn = s.mode === 'chase' || this.objects.length > 0;
    if (s.auto && canSpawn && active < s.maxRockets && this.rockets.length < MAX_ROCKETS_HARD) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnRocket();
        this.spawnTimer = this.delay();
      }
    } else if (this.spawnTimer < 0) {
      this.spawnTimer = 0;
    }

    const noseLen = NOSE_LEN * s.scale;

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life += dt;
      r.px = r.x;
      r.py = r.y;

      if (r.powered && Number.isFinite(r.fuel)) {
        r.fuel -= dt;
        if (r.fuel <= 0) this.cutEngine(r);
      }

      if (r.powered) {
        let aimX: number;
        let aimY: number;

        if (s.mode === 'chase') {
          aimX = this.cursor.x;
          aimY = this.cursor.y;
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
            if (segRect(prevNoseX, prevNoseY, noseX, noseY, rect)) {
              hit = o;
              break;
            }
          }
          if (hit) {
            this.damage(hit, noseX, noseY);
            this.rockets.splice(i, 1);
            continue;
          }
        }

        if (r.life > 16) {
          this.explode(r.x, r.y, s.power * 0.6, 0);
          this.rockets.splice(i, 1);
          continue;
        }
      } else {
        // Невесомость: тяги нет, курс не меняется, скорость гаснет по настройке затухания
        const k = Math.exp(-s.drag * 1.8 * dt);
        r.vx *= k;
        r.vy *= k;
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

      const out =
        r.x < -200 || r.x > this.width + 200 || r.y < -200 || r.y > this.height + 200;
      if (out) this.rockets.splice(i, 1);
    }

    this.resolveRocketCollisions();

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      if (p.type === 'flame' || p.type === 'smoke') {
        p.vx += Math.sin(this.time * 11 + p.seed) * s.turbulence * dt * 2.4;
        p.vy += Math.cos(this.time * 9 + p.seed) * s.turbulence * dt * 2.4;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === 'spark' || p.type === 'debris') {
        p.vy += 450 * dt;
        p.vx *= 0.96;
        p.vy *= 0.96;
      } else if (p.type === 'smoke') {
        p.size += 28 * dt;
        p.vx *= 0.94;
        p.vy *= 0.94;
      }
    }
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
      if (d.y < -4) {
        d.y = this.height + 4;
        d.x = Math.random() * this.width;
      }
    }

    this.audio.setEngine(
      active > 0 ? 0.02 + 0.035 * Math.min(1, active / 3) : 0,
      240 + s.speed * 0.9,
    );

    this.hudTimer += dt;
    if (this.hudTimer >= 0.15) {
      this.hudTimer = 0;
      let speed = 0;
      let wrecks = 0;
      let fuel = -1;
      let fuelPct = 1;
      let nearest = Infinity;
      for (const r of this.rockets) {
        if (r.powered) {
          speed += r.speed;
          const d = Math.hypot(r.x - this.cursor.x, r.y - this.cursor.y);
          if (d < nearest) {
            nearest = d;
            fuel = Number.isFinite(r.fuel) ? Math.max(0, r.fuel) : -1;
            fuelPct = Number.isFinite(r.maxFuel) && r.maxFuel > 0
              ? clamp(r.fuel / r.maxFuel, 0, 1)
              : 1;
          }
        } else {
          wrecks++;
        }
      }
      this.onHud({
        targets: this.objects.length,
        flying: active,
        wrecks,
        hits: s.mode === 'chase' ? this.hitsChase : this.hitsBuild,
        collisions: this.collisions,
        fps: Math.round(this.fps),
        speed: active ? Math.round(speed / active) : 0,
        fuel,
        fuelPct,
      });
    }
  }

  /* Ракета о ракету: проверяем относительный отрезок движения против суммы радиусов */
  private resolveRocketCollisions() {
    const s = this.settings;
    if (!s.collisions || this.rockets.length < 2) return;

    const radius = BODY_R * 2 * s.scale;
    const list = this.rockets;
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
      x: Math.random() * w,
      y: Math.random() * h,
      r: rand(0.6, 2.2),
      s: rand(4, 14),
      ph: rand(0, Math.PI * 2),
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
        if (!o) continue;
        tx = o.x;
        ty = o.y;
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
    const fade = r.powered ? 1 : clamp((s.wreckLife - r.drift) / 1.2, 0, 1);

    // вектор инерции у пустого корпуса
    if (!r.powered && r.speed > 4) {
      ctx.save();
      ctx.globalAlpha = 0.28 * fade;
      ctx.strokeStyle = t.accent2;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 7]);
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x + (r.vx / r.speed) * (30 + r.speed * 0.35), r.y + (r.vy / r.speed) * (30 + r.speed * 0.35));
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = fade * (r.powered ? 1 : 0.8);
    ctx.translate(r.x, r.y);
    ctx.rotate(r.angle);
    ctx.scale(s.scale, s.scale);

    if (r.powered) {
      const haloR = 26 + s.glow * 0.25;
      const halo = ctx.createRadialGradient(-30, 0, 0, -30, 0, haloR);
      halo.addColorStop(0, `${t.flame[1]}aa`);
      halo.addColorStop(1, `${t.flame[1]}00`);
      ctx.globalAlpha = fade * (0.25 + s.glow / 160);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(-30, 0, haloR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = fade;
    }

    ctx.fillStyle = r.powered ? '#37474f' : '#2b353b';
    ctx.beginPath();
    ctx.moveTo(-22, -6); ctx.lineTo(-29, -9); ctx.lineTo(-29, 9); ctx.lineTo(-22, 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = r.powered ? '#e53935' : '#8e3b39';
    ctx.beginPath();
    ctx.moveTo(-10, -8); ctx.lineTo(-22, -18); ctx.lineTo(-18, -8);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-10, 8); ctx.lineTo(-22, 18); ctx.lineTo(-18, 8);
    ctx.closePath(); ctx.fill();

    const body = ctx.createLinearGradient(0, -10, 0, 10);
    body.addColorStop(0, r.powered ? '#ffffff' : '#c9d2d8');
    body.addColorStop(0.5, r.powered ? '#eceff1' : '#aeb8bf');
    body.addColorStop(1, '#90a4ae');
    ctx.beginPath();
    ctx.moveTo(14, -8); ctx.lineTo(-18, -8);
    ctx.quadraticCurveTo(-23, -8, -23, 0);
    ctx.quadraticCurveTo(-23, 8, -18, 8);
    ctx.lineTo(14, 8);
    ctx.closePath();
    ctx.fillStyle = body;
    ctx.fill();

    const nose = ctx.createLinearGradient(0, -8, 0, 8);
    nose.addColorStop(0, r.powered ? '#ff5252' : '#a34a4a');
    nose.addColorStop(1, '#b71c1c');
    ctx.beginPath();
    ctx.moveTo(14, -8);
    ctx.quadraticCurveTo(26, -4, 32, 0);
    ctx.quadraticCurveTo(26, 4, 14, 8);
    ctx.closePath();
    ctx.fillStyle = nose;
    ctx.fill();

    ctx.fillStyle = '#263238';
    ctx.fillRect(11, -8, 3, 16);

    ctx.beginPath(); ctx.arc(0, 0, 5.2, 0, Math.PI * 2); ctx.fillStyle = '#37474f'; ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 3.8, 0, Math.PI * 2);
    ctx.fillStyle = r.powered ? t.accent : '#4a5560';
    ctx.fill();
    ctx.beginPath(); ctx.arc(1.2, -1.2, 1.3, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();

    ctx.restore();

    // индикатор топлива над живой ракетой
    if (s.mode === 'chase' && s.showFuel && r.powered && Number.isFinite(r.maxFuel) && r.maxFuel > 0) {
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

  private drawBooms(t: Theme) {
    const ctx = this.ctx;
    const s = this.settings;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.booms) {
      const ps = 0.75 + b.power * 0.35;
      if (b.t < 0.15) {
        const fp = b.t / 0.15;
        const r = Math.max(1, (40 + 160 * fp) * ps);
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
        g.addColorStop(0, `rgba(255,255,255,${(1 - fp * 0.5) * (0.5 + s.glow / 200)})`);
        g.addColorStop(0.45, `${t.flame[1]}${Math.round((1 - fp) * 255).toString(16).padStart(2, '0')}`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fill();
      }
      if (b.t < 0.35) {
        const cp = b.t / 0.35;
        const r = Math.max(1, (25 + 90 * Math.sin(cp * Math.PI * 0.5)) * ps);
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
        g.addColorStop(0, `rgba(255,241,180,${(1 - cp) * 0.9})`);
        g.addColorStop(0.6, `rgba(255,140,60,${(1 - cp) * 0.65})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fill();
      }
      if (b.t < 0.55) {
        const wp = b.t / 0.55;
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
    ctx.restore();
  }

  private render() {
    const s = this.settings;
    const t = THEMES[s.theme];
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    if (this.bgTheme !== s.theme) this.buildBackground();

    ctx.fillStyle = t.bgBottom;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
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

    this.drawParticles(t);
    for (const r of this.rockets) this.drawRocket(r, s, t);
    this.drawBooms(t);

    ctx.restore();
  }

  private loop = (time: number) => {
    if (this.dead) return;
    const dt = Math.min((time - this.last) / 1000, 0.05);
    this.last = time;
    if (dt > 0) this.fps = this.fps * 0.92 + (1 / dt) * 0.08;
    this.update(dt);
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };
}
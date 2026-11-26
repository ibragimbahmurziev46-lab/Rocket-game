Контекст
Проект Rocket Lab — симулятор ракет на Canvas 2D, React + TypeScript + Vite. Добавлен режим fighter (истребитель с пилонами и залповым пуском), после чего приложение начало намертво зависать.
Корневые причины фриза:

    fireSalvo использует setTimeout — при зажатом Space или частых кликах копятся таймеры, которые не отменяются при смене режима/размонтировании.
    Авто-спавн обычных ракет (spawnRocket) активен в режиме fighter — параллельно залпам спамит ракеты.
    Форсаж истребителя спавнит частицы без аккумулятора dt.
    getFighterStatus() вызывается в теле рендера React каждый кадр.
    NOZZLE_LEN изменён на 54, но emitTrail жёстко использует 14 * s.scale — пламя из середины корпуса.

Файлы для правки

    src/rocket/config.ts
    src/rocket/engine.ts
    src/rocket/RocketCanvas.tsx

Задача 1. src/rocket/config.ts
1.1. Найти export const MODE_LABEL и заменить на:

ts
export const MODE_LABEL: Record<Mode, string> = {
  chase: 'Погоня',
  build: 'Строитель',
  fighter: 'Истребитель',
};

1.2. Найти export interface HudState и добавить два поля в конец (перед }):

ts
  fighterLoaded: number;
  fighterTotal: number;

Задача 2. src/rocket/engine.ts
2.1. В начало класса RocketEngine (рядом с private fighter: Fighter | null = null;) добавить три поля:

ts
  private fighter: Fighter | null = null;
  private nextHardpointId = 1;
  private fighterTrailAcc = 0;
  private salvoQueue: { h: Hardpoint; tx: number; ty: number; t: number }[] = [];

2.2. Найти метод applyMode(mode: Mode) и заменить целиком на:

ts
  private applyMode(mode: Mode) {
    this.rockets = [];
    this.spawnTimer = 0.25;
    this.salvoQueue = [];
    this.fighterTrailAcc = 0;
    if (mode === 'chase' && !this.cursor.known) {
      this.cursor.x = this.width * 0.55;
      this.cursor.y = this.height * 0.45;
    }
    if (mode === 'fighter') this.buildFighter();
    else this.fighter = null;
  }

2.3. Найти метод fireSalvo() и заменить целиком на:

ts
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
      .sort((a, b) => {
        const order = (h: Hardpoint) =>
          h.side === 'left' ? 0 : h.side === 'right' ? 1 : 2;
        return order(a) - order(b);
      });

    const count = Math.min(s.salvoSize, ready.length);
    if (count === 0) {
      this.onToast({ text: 'Все пилоны пусты — ждём перезарядки' });
      return;
    }

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

    chosen.forEach((h, i) => {
      h.loaded = false;
      h.reloading = s.reloadTime;
      this.salvoQueue.push({ h, tx, ty, t: i * s.salvoDelay });
    });

    if (this.salvoQueue.length > 24) this.salvoQueue.splice(0, this.salvoQueue.length - 24);

    this.audio.blip(520);
  }

2.4. Найти метод spawnRocketFromHardpoint(h: Hardpoint, targetX: number, targetY: number) и заменить на:

ts
  private spawnRocketFromHardpoint(h: Hardpoint, targetX: number, targetY: number) {
    const f = this.fighter;
    if (!f) return;
    const s = this.settings;

    const cos = Math.cos(f.angle);
    const sin = Math.sin(f.angle);
    const wx = f.x + cos * h.offsetX - sin * h.offsetY;
    const wy = f.y + sin * h.offsetX + cos * h.offsetY;

    const sideSign = h.side === 'left' ? -1 : h.side === 'right' ? 1 : 0;
    const ejectAngle = f.angle + sideSign * 0.35;
    const ejectVx = Math.cos(ejectAngle) * s.ejectImpulse + Math.cos(f.angle) * 60;
    const ejectVy = Math.sin(ejectAngle) * s.ejectImpulse + Math.sin(f.angle) * 60;

    this.rockets.push({
      id: this.nextId++,
      x: wx, y: wy, px: wx, py: wy,
      angle: f.angle,
      speed: s.fighterSpeed,
      vx: ejectVx, vy: ejectVy,
      targetId: null,
      trailAcc: 0, life: 0,
      orphan: false,
      fuel: Infinity, maxFuel: Infinity,
      powered: false,
      drift: 0, spin: 0,
      ignitionTimer: s.ignitionDelay,
      ejectVx, ejectVy,
      hardpointId: h.id,
    });

    this.puff(wx, wy, 4);
    this.audio.blip(880);
  }

2.5. В методе update(dt: number) найти строку:

ts
    const canSpawn = s.mode === 'chase' || this.objects.length > 0;

и заменить на:

ts
    const canSpawn = (s.mode === 'chase' || s.mode === 'build') &&
      (s.mode === 'chase' || this.objects.length > 0);

2.6. В том же update найти блок:

ts
    if (s.auto && canSpawn && active < s.maxRockets && this.rockets.length < MAX_ROCKETS_HARD) {

и перед ним вставить обработку очереди залпа:

ts
    for (let i = this.salvoQueue.length - 1; i >= 0; i--) {
      const q = this.salvoQueue[i];
      q.t -= dt;
      if (q.t <= 0) {
        this.spawnRocketFromHardpoint(q.h, q.tx, q.ty);
        this.salvoQueue.splice(i, 1);
      }
    }

2.7. В том же update найти блок:

ts
    if (s.mode === 'fighter') this.updateFighter(dt);

и сразу после него вставить форсаж с аккумулятором:

ts
    if (s.mode === 'fighter' && this.fighter) {
      this.fighterTrailAcc += dt;
      const fInterval = 1 / Math.min(120, s.trail);
      let fg = 0;
      while (this.fighterTrailAcc >= fInterval && fg < 20) {
        fg++;
        this.fighterTrailAcc -= fInterval;
        const f = this.fighter;
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
    }

2.8. В методе emitTrail найти строку:

ts
    const nozzleOffset = 14 * s.scale;

и заменить на:

ts
    const nozzleOffset = NOZZLE_LEN * s.scale;

2.9. В методе destroy() в конец добавить две строки:

ts
    this.salvoQueue = [];
    this.fighter = null;

2.10. В методе update найти блок this.onHud({ ... }) и добавить два поля в конец объекта:

ts
        fighterLoaded: this.fighter
          ? this.fighter.hardpoints.filter((h) => h.loaded).length : 0,
        fighterTotal: this.fighter ? this.fighter.hardpoints.length : 0,

Задача 3. src/rocket/RocketCanvas.tsx

3.1. В начальном useState<HudState> добавить два поля:

  const [hud, setHud] = useState<HudState>({
    targets: 0, flying: 0, wrecks: 0, hits: 0, collisions: 0, fps: 60, speed: 0, fuel: -1, fuelPct: 1,
    fighterLoaded: 0, fighterTotal: 0,
  });

3.2. Найти строку:
  const fighterStatus = engineRef.current?.getFighterStatus();

и удалить её полностью.
3.3. Найти JSX-блок статистики истребителя:
<div className="rc-stat">
  <b>{fighterStatus?.loaded ?? 0}/{fighterStatus?.total ?? 0}</b>
  <span>на пилонах</span>
</div>

и заменить на:

<div className="rc-stat">
  <b>{hud.fighterLoaded}/{hud.fighterTotal}</b>
  <span>на пилонах</span>
</div>


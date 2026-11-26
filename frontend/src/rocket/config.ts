/* Общие типы, палитры и математика проекта */


export type Mode = 'chase' | 'build';
export type PlaceTool = 'target' | 'wall' | 'erase';
export type ObjKind = 'target' | 'wall';
export type ThemeKey = 'neon' | 'magma' | 'plasma' | 'emerald';

export interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
  type: 'flame' | 'smoke' | 'spark' | 'debris';
  color?: string;
  seed: number;
}

export interface SceneObject {
  id: number;
  kind: ObjKind;
  x: number; y: number;
  w: number; h: number;
  hp: number; maxHp: number;
  flash: number;
  born: number;
}



// Новые типы для истребителя
export interface Hardpoint {
  id: number;
  side: 'left' | 'right' | 'center';
  offsetX: number;   // локально от центра истребителя
  offsetY: number;
  loaded: boolean;   // есть ли ракета на пилоне
  reloading: number; // таймер перезарядки
}

export interface Fighter {
  x: number; y: number;
  angle: number;       // курс (вдоль носа)
  bank: number;        // крен (-1..1) для визуального наклона
  speed: number;
  target: { x: number; y: number } | null;
  lockedId: number | null;
  patrolAngle: number; // для патрулирования
  hardpoints: Hardpoint[];
}

export interface Settings {
  mode: Mode;
  speed: number;
  agility: number;
  maxRockets: number;
  scale: number;
  trail: number;
  turbulence: number;
  power: number;
  glow: number;
  launchDelay: number;
  respawnDelay: number;
  auto: boolean;
  guide: boolean;
  reticle: boolean;
  wallVertical: boolean;
  tool: PlaceTool;
  theme: ThemeKey;
  muted: boolean;
  fuelOn: boolean;
  fuel: number;
  drag: number;
  wreckLife: number;
  collisions: boolean;
  showFuel: boolean;

  // истребитель
  fighterEnabled: boolean;
  fighterSpeed: number;
  fighterTurn: number;
  fighterScale: number;
  salvoSize: number;
  salvoDelay: number;
  ignitionDelay: number;
  ejectImpulse: number;
  ejectDrop: number;
  reloadTime: number;
  autoPatrol: boolean;
  showLock: boolean;
}


// В Rocket добавь поля для двухфазного пуска:
export interface Rocket {
  id: number;
  x: number; y: number;
  px: number; py: number;
  angle: number; speed: number;
  vx: number; vy: number;
  targetId: number | null;
  trailAcc: number;
  life: number;
  orphan: boolean;
  fuel: number;
  maxFuel: number;
  powered: boolean;
  drift: number;
  spin: number;

  // --- поля истребителя: ОБЯЗАТЕЛЬНО с "?" ---
  ignitionTimer?: number;
  ejectVx?: number;
  ejectVy?: number;
  hardpointId?: number | null;
  aimX?: number;
  aimY?: number;
}

// Константы
export const FIGHTER_LENGTH = 72;
export const FIGHTER_WING = 44;
export const FIGHTER_ROCKET_FUEL = 8;


export interface Boom { x: number; y: number; t: number; power: number }
export interface Dust { x: number; y: number; r: number; s: number; ph: number }


export interface Theme {
  label: string;
  accent: string;
  accent2: string;
  hot: string;
  warn: string;
  ok: string;
  bgTop: string;
  bgBottom: string;
  nebula: [string, string];
  star: string;
  flame: [string, string, string];
  spark: string[];
  smoke: [number, number, number];
  debris: string;
  wood: [string, string];
}

export const THEMES: Record<ThemeKey, Theme> = {
  neon: {
    label: '🌌 Неон',
    accent: '#38bdf8', accent2: '#a78bfa',
    hot: '#ff4d6d', warn: '#ffb74d', ok: '#34d399',
    bgTop: '#050816', bgBottom: '#0b1026',
    nebula: ['#1d4ed8', '#7c3aed'],
    star: '#9bd7ff',
    flame: ['#fff9c4', '#7dd3fc', '#38bdf8'],
    spark: ['#ffffff', '#bae6fd', '#38bdf8', '#a78bfa'],
    smoke: [120, 140, 170],
    debris: '#7dd3fc',
    wood: ['#8d6e63', '#5d4037'],
  },
  magma: {
    label: '🌋 Магма',
    accent: '#ff6d3a', accent2: '#ffc93c',
    hot: '#ff3d3d', warn: '#ffd166', ok: '#9ccc65',
    bgTop: '#170604', bgBottom: '#241005',
    nebula: ['#7f1d1d', '#b45309'],
    star: '#ffd9a0',
    flame: ['#fff3c4', '#ffb347', '#ff5722'],
    spark: ['#ffffff', '#ffe082', '#ff8a50', '#ff3d00'],
    smoke: [150, 120, 100],
    debris: '#ffb347',
    wood: ['#a1887f', '#6d4c41'],
  },
  plasma: {
    label: '💜 Плазма',
    accent: '#f472b6', accent2: '#818cf8',
    hot: '#ff4d6d', warn: '#fbbf24', ok: '#2dd4bf',
    bgTop: '#0d0518', bgBottom: '#1a0b2e',
    nebula: ['#86198f', '#4338ca'],
    star: '#f0abfc',
    flame: ['#fdf4ff', '#f0abfc', '#c026d3'],
    spark: ['#ffffff', '#f9a8d4', '#e879f9', '#818cf8'],
    smoke: [150, 120, 160],
    debris: '#e879f9',
    wood: ['#8d6e63', '#5d4037'],
  },
  emerald: {
    label: '🌿 Изумруд',
    accent: '#34d399', accent2: '#a3e635',
    hot: '#ff5252', warn: '#fbbf24', ok: '#a3e635',
    bgTop: '#03120c', bgBottom: '#0a1f14',
    nebula: ['#065f46', '#3f6212'],
    star: '#a7f3d0',
    flame: ['#f7fee7', '#bef264', '#34d399'],
    spark: ['#ffffff', '#d9f99d', '#6ee7b7', '#34d399'],
    smoke: [110, 150, 130],
    debris: '#6ee7b7',
    wood: ['#8d6e63', '#5d4037'],
  },
};

/* Оливковый корпус ракеты: цилиндрическая светотень сверху вниз */
export const MISSILE = {
  live: {
    shade: ['#3f4430', '#6d7454', '#9aa27c', '#7b8261', '#3a3e2c'],
    fin: '#5c6146',
    finEdge: '#8d9470',
    seam: 'rgba(28,31,20,0.85)',
    seamLight: 'rgba(196,202,164,0.22)',
    nozzle: '#2f3327',
    outline: 'rgba(18,20,13,0.55)',
  },
  dead: {
    shade: ['#33362a', '#565b45', '#767c60', '#5f6449', '#2c2f23'],
    fin: '#474b39',
    finEdge: '#6a7053',
    seam: 'rgba(24,26,18,0.85)',
    seamLight: 'rgba(150,155,125,0.16)',
    nozzle: '#262a20',
    outline: 'rgba(14,16,11,0.55)',
  },
} as const;

export const DEFAULTS: Settings = {
  mode: 'chase',
  speed: 240,
  agility: 280,
  maxRockets: 2,
  scale: 1,
  trail: 220,
  turbulence: 30,
  power: 1.2,
  glow: 65,
  launchDelay: 0.8,
  respawnDelay: 1.2,
  auto: true,
  guide: true,
  reticle: true,
  wallVertical: false,
  tool: 'target',
  theme: 'neon',
  muted: false,
  fuelOn: true,
  fuel: 6,
  drag: 0.2,
  wreckLife: 12,
  collisions: true,
  showFuel: true,
  // истребитель
  fighterEnabled: false,
  fighterSpeed: 180,
  fighterTurn: 90,
  fighterScale: 1,
  salvoSize: 2,
  salvoDelay: 0.12,
  ignitionDelay: 0.35,
  ejectImpulse: 80,
  ejectDrop: 140,
  reloadTime: 2.5,
  autoPatrol: true,
  showLock: true,
};

export const MODE_LABEL: Record<Mode, string> = {
  chase: 'Погоня',
  build: 'Цели / Постройки',
};

export const TARGET_HP = 1;
export const WALL_HP = 3;
export const NOSE_LEN = 56;      // кончик боевого обтекателя
export const NOZZLE_LEN = 54;    // срез сопла
export const BODY_R = 7;         // радиус корпуса
export const MAX_PARTICLES = 1200;
export const MAX_ROCKETS_HARD = 14;
export const MAX_WRECKS = 10;

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const rand = (a: number, b: number) => a + Math.random() * (b - a);

export const normAngle = (a: number) => {
  if (!Number.isFinite(a)) return 0;
  const TAU = Math.PI * 2;
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  else if (x < -Math.PI) x += TAU;
  return x;
};

/* Отрезок против прямоугольника (Лианг — Барски) */
export const segRect = (
  x1: number, y1: number, x2: number, y2: number,
  r: { x: number; y: number; w: number; h: number },
) => {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - r.x, r.x + r.w - x1, y1 - r.y, r.y + r.h - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
};

/* Отрезок против круга с центром в начале координат (относительное движение) */
export const segCircle = (x1: number, y1: number, x2: number, y2: number, r: number) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(-(x1 * dx + y1 * dy) / len2, 0, 1) : 0;
  const cx = x1 + dx * t;
  const cy = y1 + dy * t;
  return cx * cx + cy * cy <= r * r;
};

/* Квадрат расстояния между двумя отрезками — точные столкновения длинных корпусов */
export const segSegDist2 = (
  p1x: number, p1y: number, q1x: number, q1y: number,
  p2x: number, p2y: number, q2x: number, q2y: number,
) => {
  const d1x = q1x - p1x, d1y = q1y - p1y;
  const d2x = q2x - p2x, d2y = q2y - p2y;
  const rx = p1x - p2x, ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  const EPS = 1e-8;
  let s: number;
  let t: number;

  if (a <= EPS && e <= EPS) return rx * rx + ry * ry;

  if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }

  const c1x = p1x + d1x * s, c1y = p1y + d1y * s;
  const c2x = p2x + d2x * t, c2y = p2y + d2y * t;
  const dx = c1x - c2x, dy = c1y - c2y;
  return dx * dx + dy * dy;
};

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

export interface Rocket {
  id: number;
  x: number; y: number;
  px: number; py: number;          // позиция прошлого кадра — для точных столкновений
  angle: number; speed: number;
  vx: number; vy: number;          // вектор скорости (инерция после выработки топлива)
  targetId: number | null;
  trailAcc: number;
  life: number;
  orphan: boolean;
  fuel: number;                    // остаток топлива в секундах (Infinity — безлимит)
  maxFuel: number;
  powered: boolean;                // двигатель работает
  drift: number;                   // сколько секунд корпус дрейфует
  spin: number;                    // медленное вращение обломка
}

export interface Boom { x: number; y: number; t: number; power: number }
export interface Dust { x: number; y: number; r: number; s: number; ph: number }

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
}

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
};

export const MODE_LABEL: Record<Mode, string> = { chase: 'Погоня', build: 'Строитель' };

export const TARGET_HP = 1;
export const WALL_HP = 3;
export const NOSE_LEN = 32;
export const NOZZLE_LEN = 28;
export const BODY_R = 15;
export const MAX_PARTICLES = 1200;
export const MAX_ROCKETS_HARD = 14;
export const MAX_WRECKS = 10;

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const rand = (a: number, b: number) => a + Math.random() * (b - a);

export const normAngle = (a: number) => {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
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

/* Отрезок против круга с центром в начале координат (относительное движение двух ракет) */
export const segCircle = (x1: number, y1: number, x2: number, y2: number, r: number) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(-(x1 * dx + y1 * dy) / len2, 0, 1) : 0;
  const cx = x1 + dx * t;
  const cy = y1 + dy * t;
  return cx * cx + cy * cy <= r * r;
};
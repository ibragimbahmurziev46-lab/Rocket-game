import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULTS, MODE_LABEL, THEMES, rand,
  type Mode, type PlaceTool, type Settings, type ThemeKey,
} from './config';
import { RocketEngine, type HudState, type ToastRequest } from './engine';
import './RocketCanvas.css';

function Slider(props: {
  label: string; value: number; min: number; max: number;
  step?: number; unit?: string; onChange: (v: number) => void;
}) {
  const { label, value, min, max, step = 1, unit = '', onChange } = props;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="rc-ctl">
      <span className="rc-ctl-head">
        <span>{label}</span>
        <b>{value}{unit}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.value}
      className={`rc-toggle ${props.value ? 'on' : ''}`}
      onClick={() => props.onChange(!props.value)}
    >
      <span className="rc-toggle-track"><span className="rc-toggle-knob" /></span>
      <span>{props.label}</span>
    </button>
  );
}

export const RocketCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<RocketEngine | null>(null);

  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [hud, setHud] = useState<HudState>({
    targets: 0, flying: 0, wrecks: 0, hits: 0, collisions: 0, fps: 60, speed: 0, fuel: -1, fuelPct: 1,
  });
  const [toast, setToast] = useState<ToastRequest | null>(null);
  const [failed, setFailed] = useState(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    if (!canvas.getContext('2d')) {
      setFailed(true);
      return;
    }
    const engine = new RocketEngine(canvas, container, setHud, (t) => setToast(t));
    engine.setSettings(settingsRef.current);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), toast.actionLabel ? 6000 : 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const patch = useCallback((p: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...p }));
  }, []);

  const switchMode = useCallback((mode: Mode) => {
    if (settingsRef.current.mode === mode) return;
    setSettings((s) => ({ ...s, mode }));
    setToast({
      text: mode === 'chase'
        ? 'Погоня: топливо ограничено, следите за полоской над ракетой'
        : 'Строитель: ставьте мишени и стены кликом',
    });
  }, []);

  const selectTool = useCallback((tool: PlaceTool) => {
    setSettings((s) => ({ ...s, tool, mode: 'build' }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (k === '1') selectTool('target');
      else if (k === '2') selectTool('wall');
      else if (k === '3') selectTool('erase');
      else if (k === 'x') switchMode(settingsRef.current.mode === 'chase' ? 'build' : 'chase');
      else if (k === 'c') engineRef.current?.clearObjects();
      else if (k === 'v') engineRef.current?.clearWrecks();
      else if (e.code === 'Space') {
        e.preventDefault();
        engineRef.current?.unlockAudio();
        engineRef.current?.launch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectTool, switchMode]);

  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onMove = (e: React.PointerEvent) => {
    const p = local(e);
    if (p) engineRef.current?.pointerMove(p.x, p.y);
  };

  const onDown = (e: React.PointerEvent) => {
    const p = local(e);
    if (!p) return;
    engineRef.current?.unlockAudio();
    engineRef.current?.pointerDown(p.x, p.y, e.button);
  };

  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = local(e);
    if (p) engineRef.current?.pointerDown(p.x, p.y, 2);
  };

  const stop = (e: React.PointerEvent) => {
    e.stopPropagation();
    engineRef.current?.pointerLeave();
  };

  const randomize = () => {
    const keys = Object.keys(THEMES) as ThemeKey[];
    patch({
      speed: Math.round(rand(120, 420)),
      agility: Math.round(rand(120, 620)),
      maxRockets: Math.round(rand(1, 4)),
      scale: Math.round(rand(0.7, 1.6) * 20) / 20,
      trail: Math.round(rand(100, 360)),
      turbulence: Math.round(rand(0, 90)),
      power: Math.round(rand(0.7, 2.2) * 10) / 10,
      glow: Math.round(rand(25, 100)),
      fuel: Math.round(rand(3, 12) * 2) / 2,
      drag: Math.round(rand(0, 1) * 20) / 20,
      theme: keys[Math.floor(Math.random() * keys.length)],
    });
    setToast({ text: 'Параметры перемешаны' });
  };

  const resetAll = () => {
    setSettings({ ...DEFAULTS, mode: settingsRef.current.mode });
    setToast({ text: 'Настройки сброшены' });
  };

  const toggleMute = () => {
    const next = !settings.muted;
    patch({ muted: next });
    if (!next) engineRef.current?.unlockAudio();
  };

  const theme = THEMES[settings.theme];
  const isChase = settings.mode === 'chase';
  const cssVars = {
    '--accent': theme.accent,
    '--accent2': theme.accent2,
    '--hot': theme.hot,
    '--warn': theme.warn,
    '--ok': theme.ok,
    '--bg': theme.bgBottom,
    '--bg-top': theme.bgTop,
  } as React.CSSProperties;

  const fuelPct = Math.round(hud.fuelPct * 100);
  const fuelClass = hud.fuelPct < 0.25 ? 'low' : hud.fuelPct < 0.55 ? 'mid' : '';

  return (
    <div
      ref={containerRef}
      className={`rc-root rc-root--${settings.mode}`}
      style={cssVars}
      onPointerMove={onMove}
      onPointerDown={onDown}
      onPointerLeave={() => engineRef.current?.pointerLeave()}
      onContextMenu={onContext}
    >
      <canvas ref={canvasRef} className="rc-canvas" />

      {failed && (
        <div className="rc-fallback">
          Браузер не поддерживает Canvas 2D — сцена не может быть отрисована.
        </div>
      )}

      <header className="rc-top" onPointerMove={stop} onPointerDown={stop}>
        <div className="rc-brand">
          <span className="rc-logo">🚀</span>
          <div className="rc-brand-text">
            <h1>ROCKET LAB</h1>
            <p>
              {isChase
                ? 'Топливо кончается — корпус дрейфует по инерции и взрывается при таране'
                : 'Клик ставит объект · ракеты стартуют из случайных точек'}
            </p>
          </div>
        </div>

        <div className="rc-modes" role="tablist" aria-label="Режим сцены">
          <button
            role="tab"
            aria-selected={isChase}
            className={`rc-mode-btn ${isChase ? 'on' : ''}`}
            onClick={() => switchMode('chase')}
          >
            <span>🎯</span> Погоня
          </button>
          <button
            role="tab"
            aria-selected={!isChase}
            className={`rc-mode-btn ${!isChase ? 'on' : ''}`}
            onClick={() => switchMode('build')}
          >
            <span>🧱</span> Строитель
          </button>
        </div>

        <div className="rc-top-right">
          <span className="rc-fps">{hud.fps} FPS</span>
          <span className={`rc-chip ${!isChase && hud.targets === 0 ? 'rc-chip--empty' : ''}`}>
            {isChase ? `ПЕРЕХВАТОВ: ${hud.hits}` : hud.targets === 0 ? 'НЕТ ЦЕЛЕЙ' : `ЦЕЛЕЙ: ${hud.targets}`}
          </span>
          <button className="rc-sound" onClick={toggleMute} title="Весь звук вкл/выкл">
            {settings.muted ? '🔇' : '🔊'}
            <span className="rc-sound-text">{settings.muted ? 'Звук выкл' : 'Звук вкл'}</span>
          </button>
        </div>
      </header>

      <aside className="rc-panel" onPointerMove={stop} onPointerDown={stop}>
        <div className="rc-stats">
          <div className="rc-stat">
            <b>{isChase ? hud.hits : hud.targets}</b>
            <span>{isChase ? 'перехватов' : 'целей'}</span>
          </div>
          <div className="rc-stat"><b>{hud.flying}</b><span>в полёте</span></div>
          <div className="rc-stat">
            <b>{isChase ? hud.wrecks : hud.hits}</b>
            <span>{isChase ? 'обломков' : 'попаданий'}</span>
          </div>
        </div>

        <div className="rc-substat">
          <span>Столкновений ракет: <b>{hud.collisions}</b></span>
          {isChase && <span>Скорость: <b>{hud.speed}</b> px/с</span>}
        </div>

        {isChase && settings.fuelOn && (
          <div className="rc-fuel">
            <div className="rc-fuel-head">
              <span>Топливо ближайшей ракеты</span>
              <b>{hud.fuel < 0 ? '∞' : `${hud.fuel.toFixed(1)} с`}</b>
            </div>
            <div className="rc-fuel-bar">
              <div className={`rc-fuel-fill ${fuelClass}`} style={{ width: `${fuelPct}%` }} />
            </div>
          </div>
        )}

        <div className="rc-section-title">
          {isChase ? 'Погоня и топливо' : 'Инструменты стройки'}
        </div>

        {isChase ? (
          <div className="rc-section">
            <p className="rc-note">
              Пока есть топливо — ракета доворачивает носом на курсор. Бак пуст: двигатель глохнет,
              корпус летит по инерции и не реагирует на курсор, но детонирует при таране другой ракеты.
            </p>
            <Toggle label="Ограниченное топливо" value={settings.fuelOn} onChange={(v) => patch({ fuelOn: v })} />
            <Slider label="Запас топлива" value={settings.fuel} min={1} max={20} step={0.5} unit=" с"
              onChange={(v) => patch({ fuel: v })} />
            <Slider label="Затухание в невесомости" value={settings.drag} min={0} max={1} step={0.05}
              onChange={(v) => patch({ drag: v })} />
            <Slider label="Жизнь обломка" value={settings.wreckLife} min={3} max={30} step={1} unit=" с"
              onChange={(v) => patch({ wreckLife: v })} />
            <Slider label="Пауза перед новым пуском" value={settings.respawnDelay} min={0.2} max={4} step={0.1} unit=" с"
              onChange={(v) => patch({ respawnDelay: v })} />
            <Toggle label="Полоски топлива над ракетой" value={settings.showFuel} onChange={(v) => patch({ showFuel: v })} />
            <Toggle label="Прицел на курсоре" value={settings.reticle} onChange={(v) => patch({ reticle: v })} />
            <button className="rc-btn-ghost" onClick={() => engineRef.current?.clearWrecks()}>
              🧊 Убрать обломки
            </button>
          </div>
        ) : (
          <div className="rc-section">
            <div className="rc-seg">
              <button className={settings.tool === 'target' ? 'on' : ''} onClick={() => selectTool('target')}>
                🎯 Мишень
              </button>
              <button className={settings.tool === 'wall' ? 'on' : ''} onClick={() => selectTool('wall')}>
                🧱 Стена
              </button>
              <button className={settings.tool === 'erase' ? 'on' : ''} onClick={() => selectTool('erase')}>
                🧽 Ластик
              </button>
            </div>
            <Toggle
              label="Стена вертикально" value={settings.wallVertical}
              onChange={(v) => patch({ wallVertical: v })}
            />
            <Slider
              label="Пауза между пусками" value={settings.launchDelay}
              min={0.2} max={3} step={0.1} unit=" с"
              onChange={(v) => patch({ launchDelay: v })}
            />
            <div className="rc-actions-row two">
              <button className="rc-btn-ghost" onClick={() => engineRef.current?.scatter()}>🎲 Расставить</button>
              <button className="rc-btn-ghost" onClick={() => engineRef.current?.clearObjects()}>🧹 Очистить</button>
            </div>
            <p className="rc-note">
              Мишень — 1 попадание, стена — 3 и прикрывает цели за собой. В стройке бак бесконечный.
            </p>
          </div>
        )}

        <div className="rc-section-title">Полёт</div>
        <div className="rc-section">
          <Slider label="Скорость ракеты" value={settings.speed} min={60} max={600} step={10} unit=" px/с"
            onChange={(v) => patch({ speed: v })} />
          <Slider label="Манёвренность" value={settings.agility} min={60} max={720} step={10} unit="°/с"
            onChange={(v) => patch({ agility: v })} />
          <Slider label="Ракет одновременно" value={settings.maxRockets} min={1} max={6}
            onChange={(v) => patch({ maxRockets: v })} />
          <Toggle label="Ракеты взрываются друг о друга" value={settings.collisions}
            onChange={(v) => patch({ collisions: v })} />
          <Toggle
            label={isChase ? 'Авто-перезапуск' : 'Авто-пуск по целям'}
            value={settings.auto}
            onChange={(v) => patch({ auto: v })}
          />
          <Toggle label="Направляющая к цели" value={settings.guide} onChange={(v) => patch({ guide: v })} />
        </div>

        <div className="rc-section-title">Внешний вид</div>
        <div className="rc-section">
          <Slider label="Размер ракеты" value={settings.scale} min={0.6} max={1.8} step={0.05} unit="×"
            onChange={(v) => patch({ scale: v })} />
          <Slider label="Плотность следа" value={settings.trail} min={60} max={400} step={10}
            onChange={(v) => patch({ trail: v })} />
          <Slider label="Турбулентность" value={settings.turbulence} min={0} max={100}
            onChange={(v) => patch({ turbulence: v })} />
          <Slider label="Мощность взрыва" value={settings.power} min={0.5} max={2.5} step={0.1} unit="×"
            onChange={(v) => patch({ power: v })} />
          <Slider label="Свечение" value={settings.glow} min={0} max={100}
            onChange={(v) => patch({ glow: v })} />

          <div className="rc-select-wrap">
            <select
              className="rc-select"
              value={settings.theme}
              onChange={(e) => patch({ theme: e.target.value as ThemeKey })}
              aria-label="Палитра сцены"
            >
              {(Object.keys(THEMES) as ThemeKey[]).map((k) => (
                <option key={k} value={k}>{THEMES[k].label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="rc-actions">
          <button className="rc-btn-primary" onClick={() => engineRef.current?.launch()}>
            🚀 Запустить сейчас
          </button>
          <div className="rc-actions-row">
            <button className="rc-btn-ghost" onClick={resetAll}>Сброс</button>
            <button className="rc-btn-ghost" onClick={randomize}>Случайно</button>
            <button className="rc-btn-ghost" onClick={() => engineRef.current?.exportPng()}>🖼 PNG</button>
          </div>
        </div>
      </aside>

      <div className="rc-hint">
        {isChase ? (
          <>
            <b>Ведите курсор</b> — топливо тратится · <kbd>Space</kbd> пуск · <kbd>V</kbd> убрать обломки ·{' '}
            <kbd>X</kbd> режим «{MODE_LABEL.build}»
          </>
        ) : (
          <>
            <b>ЛКМ</b> поставить · <b>ПКМ</b> убрать · <kbd>1</kbd> мишень <kbd>2</kbd> стена <kbd>3</kbd> ластик ·{' '}
            <kbd>C</kbd> очистить · <kbd>X</kbd> режим «{MODE_LABEL.chase}»
          </>
        )}
      </div>

      {toast && (
        <div className="rc-toast" role="status">
          <span className="rc-toast-text">{toast.text}</span>
          {toast.actionLabel && toast.action && (
            <button className="rc-toast-action" onClick={() => toast.action?.()}>
              {toast.actionLabel}
            </button>
          )}
          <button className="rc-toast-close" onClick={() => setToast(null)} aria-label="Закрыть">✕</button>
        </div>
      )}
    </div>
  );
};

export default RocketCanvas;
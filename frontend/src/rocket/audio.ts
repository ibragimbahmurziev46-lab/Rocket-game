/* Синтезированный звук: рокот двигателя, взрыв, пуск, щелчок установки, срыв двигателя */

export class RocketAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineSrc: AudioBufferSourceNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private appliedMuted: boolean | null = null;

  private makeNoise(ctx: AudioContext, dur: number) {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  unlock(force = false) {
    if (!force && this.muted) return;
    try {
      if (!this.ctx) {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        this.ctx = ctx;

        const master = ctx.createGain();
        master.gain.value = this.muted ? 0 : 0.85;
        master.connect(ctx.destination);
        this.master = master;
        this.noise = this.makeNoise(ctx, 1.5);

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 320;
        filter.Q.value = 0.9;

        const gain = ctx.createGain();
        gain.gain.value = 0;

        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        src.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        src.start();

        this.engineFilter = filter;
        this.engineGain = gain;
        this.engineSrc = src;
        this.appliedMuted = this.muted;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => { /* autoplay policy */ });
    } catch {
      /* звук не обязателен для работы сцены */
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    const ctx = this.ctx;
    const master = this.master;
    if (ctx && master && this.appliedMuted !== m) {
      try {
        master.gain.setTargetAtTime(m ? 0 : 0.85, ctx.currentTime, 0.05);
        this.appliedMuted = m;
      } catch {
        /* аудио-контекст мог быть уже закрыт */
      }
    }
  }

  setEngine(level: number, pitch: number) {
    const ctx = this.ctx;
    if (!ctx || !this.engineGain || !this.engineFilter) return;
    // AudioParam.setTargetAtTime() кидает RangeError на NaN/Infinity,
    // а loop() вызывает этот метод каждый кадр.
    if (!Number.isFinite(level) || !Number.isFinite(pitch)) return;
    try {
      const t = ctx.currentTime;
      const lv = Math.max(0, Math.min(1, level));
      const freq = Math.max(20, Math.min(12000, pitch));
      this.engineGain.gain.setTargetAtTime(this.muted ? 0 : lv, t, 0.1);
      this.engineFilter.frequency.setTargetAtTime(freq, t, 0.15);
    } catch {
      /* noop */
    }
  }

  boom(power: number) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noise || this.muted) return;
    try {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(3200, t);
      lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.min(0.4, 0.24 * power), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      src.connect(lp);
      lp.connect(g);
      g.connect(master);
      src.start(t, Math.random() * 0.6, 0.62);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(95, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 0.4);
      const og = ctx.createGain();
      og.gain.setValueAtTime(Math.min(0.4, 0.26 * power), t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      osc.connect(og);
      og.connect(master);
      osc.start(t);
      osc.stop(t + 0.5);
    } catch {
      /* noop */
    }
  }

  whoosh() {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noise || this.muted) return;
    try {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(1700, t + 0.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.1, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      src.connect(bp);
      bp.connect(g);
      g.connect(master);
      src.start(t, Math.random() * 0.8, 0.36);
    } catch {
      /* noop */
    }
  }

  /* Двигатель захлебнулся: падающий тон + шипение стравливания */
  sputter() {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted) return;
    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(420, t);
      osc.frequency.exponentialRampToValueAtTime(70, t + 0.45);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(lp);
      lp.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + 0.52);

      if (this.noise) {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1600;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.05, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        src.connect(hp);
        hp.connect(ng);
        ng.connect(master);
        src.start(t, Math.random() * 0.8, 0.42);
      }
    } catch {
      /* noop */
    }
  }

  blip(freq: number) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted) return;
    if (!Number.isFinite(freq) || freq <= 0) return;
    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + 0.12);
    } catch {
      /* noop */
    }
  }

  destroy() {
    try { this.engineSrc?.stop(); } catch { /* noop */ }
    try { void this.ctx?.close(); } catch { /* noop */ }
    this.engineSrc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.master = null;
    this.noise = null;
    this.ctx = null;
    this.appliedMuted = null;
  }
}
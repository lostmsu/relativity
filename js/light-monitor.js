/* Whole-view light readout, a beaming curve, and optional synthesized clicks. */
(function (R) {
  'use strict';

  function clickRate(incidentCps) {
    const rate = Math.max(0, incidentCps);
    return rate / (1 + rate * R.radiation.deadTime);
  }

  // A linear knob in dB gives exponential amplitude, with an exact mute at 0.
  function volumeGain(volume) {
    return volume <= 0 ? 0 : Math.pow(10, (volume - 1) * 40 / 20);
  }

  function intensityGain(incidentCps) {
    // A real counter's individual pulse does not get quieter at low dose.
    return incidentCps > 0 ? 1 : 0;
  }

  class LightAudio {
    constructor() {
      this.enabled = false;
      this.incidentCps = 0;
      this.volume = 1.0;
      this.timer = null;
      this.context = null;
      this.sources = new Set();
      this.hazard = -Math.log(Math.max(1e-9, Math.random()));
      this.deadUntil = 0;
    }

    async setEnabled(enabled) {
      this.enabled = enabled;
      if (!enabled || document.hidden) {
        clearInterval(this.timer);
        this.timer = null;
        if (this.context) {
          this.stopScheduled();
          this.master.gain.setValueAtTime(0, this.context.currentTime);
          await this.context.suspend();
        }
        return;
      }
      if (!this.context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) throw new Error('Audio is unavailable in this browser.');
        this.context = new Audio();
        const ctx = this.context;
        this.master = ctx.createGain();
        this.compressor = ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -3;
        this.compressor.knee.value = 6;
        this.compressor.ratio.value = 12;
        this.compressor.attack.value = 0.001;
        this.compressor.release.value = 0.06;
        this.output = ctx.createWaveShaper();
        const curve = new Float32Array(4097);
        for (let i = 0; i < curve.length; i++) {
          const x = i / (curve.length - 1) * 2 - 1;
          const a = Math.abs(x);
          curve[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.18 * (1 - Math.exp(-(a - 0.8) / 0.18)));
        }
        this.output.curve = curve;
        this.master.connect(this.compressor);
        this.compressor.connect(this.output);
        this.output.connect(ctx.destination);
        this.click = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.012), ctx.sampleRate);
        const samples = this.click.getChannelData(0);
        for (let i = 0; i < samples.length; i++) {
          samples[i] = (Math.random() * 2 - 1) * 0.65 * Math.exp(-i / (ctx.sampleRate * 0.0025));
        }
        samples[0] = 0.95;
        samples[1] = -0.55;
        const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
        for (let i = 0; i < samples.length; i++) samples[i] -= mean;
      }
      await this.context.resume();
      if (!this.enabled || document.hidden) return this.setEnabled(this.enabled);
      this.syncGain();
      clearInterval(this.timer);
      this.nextBlock = this.context.currentTime + 0.005;
      this.timer = setInterval(() => this.schedule(), 25);
    }

    setVolume(volume) {
      this.volume = volume;
      this.syncGain();
    }

    setIncidentRate(rate) {
      const before = this.incidentCps;
      this.incidentCps = Math.max(0, rate);
      if (this.context && !this.incidentCps && before) {
        this.stopScheduled();
        this.syncGain();
      } else if (this.context && this.incidentCps && !before) {
        this.nextBlock = this.context.currentTime + 0.005;
        this.syncGain();
      }
    }

    stopScheduled() {
      for (const source of this.sources) {
        try { source.stop(); } catch {}
        source.disconnect();
      }
      this.sources.clear();
      this.deadUntil = 0;
      this.hazard = -Math.log(Math.max(1e-9, Math.random()));
      this.nextBlock = this.context.currentTime + 0.005;
    }

    syncGain() {
      if (this.context && this.enabled && !document.hidden) {
        const gain = volumeGain(this.volume) * intensityGain(this.incidentCps);
        if (gain === 0) {
          this.master.gain.cancelScheduledValues(this.context.currentTime);
          this.master.gain.setValueAtTime(0, this.context.currentTime);
        } else {
          this.master.gain.setTargetAtTime(gain, this.context.currentTime, 0.04);
        }
      }
    }

    schedule() {
      const ctx = this.context;
      if (!this.enabled || ctx.state !== 'running') return;
      const rate = this.incidentCps;
      if (!rate) { this.nextBlock = ctx.currentTime + 0.005; return; }
      this.nextBlock = Math.max(this.nextBlock, ctx.currentTime + 0.005);
      const pulse = this.click.getChannelData(0);
      // Pack real stochastic pulses into short audio blocks. This preserves
      // sparse Poisson ticks and handles thousands of counts/s without making
      // a Web Audio node for every event. Tube dead time is physical saturation.
      for (let block = 0; block < 4 && this.nextBlock < ctx.currentTime + 0.1; block++) {
        const start = this.nextBlock, end = start + 0.05;
        let time = Math.max(start, this.deadUntil), buffer = null, samples = null;
        while (time < end) {
          const wait = this.hazard / rate;
          if (time + wait >= end) {
            this.hazard = Math.max(0, this.hazard - rate * (end - time));
            break;
          }
          time += wait;
          if (!buffer) {
            buffer = ctx.createBuffer(1, Math.ceil(0.05 * ctx.sampleRate) + pulse.length, ctx.sampleRate);
            samples = buffer.getChannelData(0);
          }
          const offset = Math.floor((time - start) * ctx.sampleRate);
          for (let j = 0; j < pulse.length; j++) samples[offset + j] += pulse[j];
          this.deadUntil = time + R.radiation.deadTime;
          time = this.deadUntil;
          this.hazard = -Math.log(Math.max(1e-9, Math.random()));
        }
        if (buffer) {
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(this.master);
          this.sources.add(source);
          source.onended = () => { this.sources.delete(source); source.disconnect(); };
          source.start(start);
        }
        this.nextBlock = end;
      }
    }
  }

  class LightMonitor {
    constructor() {
      this.baseline = null;
      this.ratio = 1;
      this.background = true;
      this.exposure = R.radiation.at(0, this.background);
      this.audio = new LightAudio();
      this.audio.enabled = true;
      this.audio.setIncidentRate(this.exposure.incidentCps);
      this.readout = document.getElementById('v-light');
      this.bar = document.getElementById('v-light-level');
      this.button = document.getElementById('toggle-light-sound');
      this.checkbox = document.getElementById('opt-light-sound');
      this.status = document.getElementById('light-sound-status');
      this.lastPaint = 0;
      document.getElementById('opt-background-radiation').addEventListener('change', e => {
        this.background = e.target.checked;
      });
      // Enabled by default; unlock playback on the first browser user gesture.
      this.activateSound = event => {
        if (event.target.closest?.('label')?.contains(this.checkbox)) return;
        if (this.audio.enabled) this.setSound(true);
      };
      document.addEventListener('click', this.activateSound);
      document.addEventListener('keydown', this.activateSound);
      this.button.addEventListener('click', () => this.setSound(!this.audio.enabled));
      this.checkbox.addEventListener('change', e => this.setSound(e.target.checked));
      const volume = document.getElementById('opt-light-volume');
      volume.addEventListener('input', () => {
        this.audio.setVolume(Number(volume.value));
        const v = Number(volume.value);
        document.getElementById('opt-light-volume-out').textContent = v === 0
          ? 'Muted' : Math.round(v * 100) + '% · ' + Math.round((v - 1) * 40) + ' dB';
      });
      document.addEventListener('visibilitychange', () => {
        if (this.audio.enabled && this.audio.context) this.setSound(true);
      });
    }

    async setSound(enabled) {
      document.removeEventListener('click', this.activateSound);
      document.removeEventListener('keydown', this.activateSound);
      this.checkbox.checked = enabled;
      this.button.setAttribute('aria-pressed', String(enabled));
      this.button.textContent = enabled ? 'Sound on' : 'Sound off';
      try {
        await this.audio.setEnabled(enabled);
        this.status.textContent = enabled
          ? 'Irregular detector ticks; dense counts merge into crackle.'
          : 'Sound is muted.';
      } catch (err) {
        await this.audio.setEnabled(false).catch(() => {});
        this.checkbox.checked = false;
        this.button.setAttribute('aria-pressed', 'false');
        this.button.textContent = 'Sound off';
        this.status.textContent = err.message;
      }
    }

    reset() {
      this.baseline = null;
      this.ratio = 1;
      this.exposure = R.radiation.at(0, this.background);
      this.audio.setIncidentRate(this.exposure.incidentCps);
    }

    update(luminance, beta) {
      if (luminance !== null && this.baseline === null) this.baseline = Math.max(luminance, 1e-14);
      const ratio = luminance === null ? 1 : Math.max(0, luminance / this.baseline);
      this.ratio = ratio;
      this.exposure = R.radiation.at(beta, this.background);
      this.audio.setIncidentRate(this.exposure.incidentCps);
      const now = performance.now();
      if (now - this.lastPaint < 100) return;
      this.lastPaint = now;
      this.audio.syncGain();
      const cps = this.exposure.detectedCps;
      document.getElementById('v-radiation').textContent = cps < 1
        ? Math.round(cps * 60) + ' CPM' : cps.toLocaleString('en', { maximumFractionDigits: 0 }) + ' CPS';
      const value = ratio >= 10000 || (ratio > 0 && ratio < 0.001)
        ? ratio.toExponential(1) : ratio.toLocaleString('en', { maximumFractionDigits: ratio < 10 ? 2 : 0 });
      this.readout.textContent = '× ' + value;
      this.bar.style.width = Math.min(100, 12 + 88 * Math.log2(1 + ratio) / 20).toFixed(1) + '%';
    }
  }

  R.LightMonitor = LightMonitor;
  R.LightAudio = LightAudio;
  R.lightClickRate = clickRate;
  R.lightVolumeGain = volumeGain;
  R.lightIntensityGain = intensityGain;
})(window.Rel = window.Rel || {});

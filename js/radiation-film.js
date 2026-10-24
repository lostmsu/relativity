/* A screen-space photographic exposure effect, independent of scene metering. */
(function (R) {
  'use strict';

  function filmLevel(dose) {
    return R.radiation.visualLevel(dose);
  }

  class RadiationFilm {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.enabled = true;
      this.strength = 0.50; // maximum fraction of the screen covered by visible grain
      this.level = 0;
      this.particles = [];
      this.spawnBudget = 0;
      this.grainAge = 1;
      this.grain = document.createElement('canvas');
      this.grain.width = this.grain.height = 256;
      this.grainCtx = this.grain.getContext('2d');
      this.grainPixels = this.grainCtx.createImageData(256, 256);
      this.halo = document.createElement('canvas');
      this.halo.width = this.halo.height = 24;
      const halo = this.halo.getContext('2d');
      const glow = halo.createRadialGradient(12, 12, 0, 12, 12, 12);
      glow.addColorStop(0, 'rgba(255,255,255,0.7)');
      glow.addColorStop(0.2, 'rgba(230,230,230,0.18)');
      glow.addColorStop(1, 'rgba(220,220,220,0)');
      halo.fillStyle = glow;
      halo.fillRect(0, 0, 24, 24);

      const toggle = document.getElementById('opt-film');
      const slider = document.getElementById('opt-film-strength');
      toggle.addEventListener('change', () => {
        this.enabled = toggle.checked;
        canvas.hidden = !this.enabled;
        slider.disabled = !this.enabled;
        document.getElementById('film-strength-control').classList.toggle('is-disabled', !this.enabled);
        this.reset();
      });
      slider.addEventListener('input', () => {
        this.strength = Number(slider.value);
        document.getElementById('opt-film-strength-out').textContent = Math.round(this.strength * 100) + '%';
        this.grainAge = 1;
        if (!this.strength) this.reset();
      });
    }

    reset() {
      this.particles.length = 0;
      this.spawnBudget = 0;
      this.level = 0;
      this.pattern = null;
      this.grainAge = 1;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
      const w = Math.max(1, Math.round(width * dpr));
      const h = Math.max(1, Math.round(height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.particles.length = 0;
      }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.imageSmoothingEnabled = false;
      return { width, height };
    }

    grainPattern() {
      const pixels = this.grainPixels.data;
      const coverage = this.strength * this.level;
      const rowBytes = this.grain.width * 4;
      for (let i = 0; i < pixels.length; i += 4) {
        const gray = 120 + Math.floor(Math.random() * 136);
        pixels[i] = pixels[i + 1] = pixels[i + 2] = gray;
        // Correlate some neighbors into photographic clumps while preserving
        // the requested average coverage. Remaining pixels stay transparent.
        const neighbor = Math.random();
        const marked = i % rowBytes > 0 && neighbor < 0.22 ? pixels[i - 1] > 0
          : i >= rowBytes && neighbor < 0.35 ? pixels[i - rowBytes + 3] > 0
          : Math.random() < coverage;
        pixels[i + 3] = marked ? 115 + Math.floor(Math.random() * 126) : 0;
      }
      this.grainCtx.putImageData(this.grainPixels, 0, 0);
      this.pattern = this.ctx.createPattern(this.grain, 'repeat');
    }

    spawn(width, height) {
      const kind = Math.random();
      const particle = {
        x: Math.random() * width, y: Math.random() * height,
        life: 0.07 + Math.random() * 0.18, age: 0,
        radius: 0.4 + Math.pow(Math.random(), 3) * 1.8,
        gray: 125 + Math.floor(Math.random() * 131),
        opacity: (0.25 + Math.random() * 0.65) * this.strength,
        type: kind < 0.61 ? 'fleck' : kind < 0.85 ? 'cluster' : 'track',
        angle: Math.random() * Math.PI * 2,
        length: 3 + Math.pow(Math.random(), 2) * 24,
        bend: (Math.random() - 0.5) * 4,
        grains: Array.from({ length: 2 + Math.floor(Math.random() * 4) }, () => [
          (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, 0.3 + Math.random() * 0.8
        ])
      };
      this.particles.push(particle);
    }

    render(dt, exposure, active) {
      if (!this.enabled) return;
      const { width, height } = this.resize();
      const ctx = this.ctx;
      ctx.clearRect(0, 0, width, height);
      if (!active || !this.strength) return;
      if (!exposure.incidentCps) { this.reset(); return; }
      this.level += (exposure.visualLevel - this.level) * (1 - Math.exp(-dt / 0.3));
      this.grainAge += dt;
      if (this.grainAge >= 1 / 12 || !this.pattern) {
        this.grainPattern();
        this.grainAge = 0;
      }

      // Small, slowly varying photographic fog, not a full-screen flash.
      const fog = Math.pow(Math.max(0, this.level - 0.1), 2) * 0.14 * this.strength;
      const haze = ctx.createLinearGradient(0, height * 0.1, width, height * 0.8);
      haze.addColorStop(0, 'rgba(215,215,215,' + fog * 0.45 + ')');
      haze.addColorStop(0.45, 'rgba(225,225,225,' + fog + ')');
      haze.addColorStop(1, 'rgba(215,215,215,' + fog * 0.6 + ')');
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = this.pattern;
      ctx.fillRect(0, 0, width, height);

      const rate = exposure.detectedCps * this.strength * width * height / 1e6;
      this.spawnBudget += rate * Math.min(dt, 0.05);
      const count = Math.min(200, Math.floor(this.spawnBudget), 1200 - this.particles.length);
      this.spawnBudget -= Math.floor(this.spawnBudget);
      for (let i = 0; i < count; i++) this.spawn(width, height);
      this.particles = this.particles.filter(p => p.age < p.life);
      for (const p of this.particles) {
        p.age += dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = p.opacity * Math.pow(Math.max(0, 1 - p.age / p.life), 0.6);
        ctx.fillStyle = 'rgb(' + p.gray + ',' + p.gray + ',' + p.gray + ')';
        ctx.strokeStyle = ctx.fillStyle;
        if (p.type === 'track') {
          // A short kinked, broken exposure track, not a moving star trail.
          ctx.lineWidth = p.radius * 0.8;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-p.length * 0.5, 0);
          ctx.lineTo(-p.length * 0.1, p.bend);
          ctx.moveTo(p.length * 0.03, p.bend * 0.7);
          ctx.lineTo(p.length * 0.5, -p.bend * 0.2);
          ctx.stroke();
          ctx.drawImage(this.halo, -p.radius * 4, -p.radius * 4, p.radius * 8, p.radius * 8);
        } else if (p.type === 'cluster') {
          for (const [x, y, r] of p.grains) {
            ctx.beginPath(); ctx.arc(x, y, r * p.radius, 0, Math.PI * 2); ctx.fill();
          }
        } else {
          ctx.beginPath();
          ctx.ellipse(0, 0, p.radius, p.radius * 0.6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.drawImage(this.halo, -p.radius * 3, -p.radius * 3, p.radius * 6, p.radius * 6);
        }
        ctx.restore();
      }
    }
  }

  R.RadiationFilm = RadiationFilm;
  R.filmLevel = filmLevel;
})(window.Rel = window.Rel || {});

/* Scene-based, circular center metering. No float render target required. */
(function (R) {
  'use strict';

  const SIZE = 48;
  const INTERVAL = 0.10;
  const TAU = 0.30;
  const KEY = 0.18;

  // The cropped square represents a circle's bounding box. Pixel centers
  // outside the circle never contribute, including the four bright corners.
  function average(pixels, circular) {
    let sum = 0, linearSum = 0, count = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = (x + 0.5) / SIZE * 2 - 1;
        const dy = (y + 0.5) / SIZE * 2 - 1;
        if (circular && dx * dx + dy * dy > 1) continue;
        const i = (y * SIZE + x) * 4;
        if (!pixels[i + 3]) continue;
        const stops = (pixels[i] * 256 + pixels[i + 1]) / 65535 * 96 - 48;
        sum += stops;
        linearSum += Math.pow(2, stops);
        count++;
      }
    }
    return count ? { log: sum / count, linear: linearSum / count } : null;
  }

  class CenterExposure {
    constructor(gl, options = {}) {
      this.gl = gl;
      this.stops = 0;
      this.targetStops = 0;
      this.interval = options.interval ?? INTERVAL;
      this.circular = options.circular ?? true;
      this.elapsed = this.interval;
      this.luminance = null;
      this.revision = 0;
      this.pending = null;
      this.pixels = new Uint8Array(SIZE * SIZE * 4);
      this.framebuffer = gl.createFramebuffer();
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SIZE, SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, SIZE, SIZE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Could not create the auto exposure meter.');
      }
      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, this.pixels.byteLength, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    }

    invalidate() {
      // Ignore in-flight readings for a previous region or toggle state.
      this.revision++;
      this.elapsed = this.interval;
    }

    reset() {
      this.invalidate();
      this.stops = this.targetStops = 0;
      this.luminance = null;
    }

    update(dt, enabled) {
      const gl = this.gl;
      this.elapsed += dt;
      if (this.pending) {
        const status = gl.clientWaitSync(this.pending.fence, 0, 0);
        if (status !== gl.TIMEOUT_EXPIRED) {
          if (status !== gl.WAIT_FAILED && enabled && this.pending.revision === this.revision) {
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer);
            gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.pixels);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
            const mean = average(this.pixels, this.circular);
            if (mean !== null) {
              this.targetStops = Math.max(-40, Math.min(20, Math.log2(KEY) - mean.log));
              this.luminance = mean.linear;
            }
          }
          gl.deleteSync(this.pending.fence);
          this.pending = null;
        }
      }
      if (!enabled) return 1;
      // Adapt in exposure stops, so large brightness changes stay stable.
      this.stops += (this.targetStops - this.stops) * (1 - Math.exp(-dt / TAU));
      return Math.pow(2, this.stops);
    }

    sample(projection, width, height, percent, draw) {
      if (this.pending || this.elapsed < this.interval) return;
      const gl = this.gl;
      const px = projection[0], py = projection[5];
      const diameter = percent == null ? null : Math.min(width, height) * percent / 100;
      const dither = gl.isEnabled(gl.DITHER);
      // Crop the existing camera to exactly the central circle's bounding box.
      // Both axes use physical pixels, so it stays circular at every aspect.
      if (diameter !== null) {
        projection[0] *= width / diameter;
        projection[5] *= height / diameter;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.viewport(0, 0, SIZE, SIZE);
      gl.disable(gl.DITHER); // preserve the encoded bytes
      try {
        draw();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer);
        gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, 0);
        this.pending = { fence: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), revision: this.revision };
        gl.flush();
        this.elapsed = 0;
      } finally {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        if (dither) gl.enable(gl.DITHER);
        projection[0] = px;
        projection[5] = py;
      }
    }
  }

  R.CenterExposure = CenterExposure;
})(window.Rel = window.Rel || {});

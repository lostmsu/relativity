/* An explicit reference field, separate from visible scene brightness.
 * This calibrates a virtual detector, not a human dose calculation. */
(function (R) {
  'use strict';
  const BACKGROUND_GY_PER_SECOND = 0.1e-6 / 3600;
  const COUNTS_PER_GY = 2e6 * 3600;
  const DEAD_TIME = 90e-6;
  const COMPRESSION_KNEE = 0.5; // reference Gy/s: 10 Gy accumulated in 20 s

  function visualLevel(dose) {
    const x = Math.max(0, dose) / COMPRESSION_KNEE;
    // Linear below the extreme-exposure knee; C1-smooth rolloff above it.
    return x <= 1 ? 0.75 * x : 0.75 + 0.25 * -Math.expm1(-3 * (x - 1));
  }

  function radiationAt(beta, background = true) {
    const b = Math.min(0.99999, Math.max(0, Math.abs(beta)));
    const gain = Math.pow((1 + b) / (1 - b), 2);
    const dose = BACKGROUND_GY_PER_SECOND * (background ? gain : gain - 1);
    const incidentCps = dose * COUNTS_PER_GY;
    return {
      doseGyPerSecond: dose,
      incidentCps,
      detectedCps: incidentCps / (1 + incidentCps * DEAD_TIME),
      visualLevel: visualLevel(dose),
      compressed: dose > COMPRESSION_KNEE
    };
  }

  R.radiation = { at: radiationAt, visualLevel, deadTime: DEAD_TIME,
    backgroundDose: BACKGROUND_GY_PER_SECOND, compressionKnee: COMPRESSION_KNEE };
})(window.Rel = window.Rel || {});

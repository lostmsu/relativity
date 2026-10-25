/* Reference field for a virtual detector, separate from visible scene light.
 * This calibration is illustrative, not a physical dose calculation. */
(function (R) {
  'use strict';

  const BACKGROUND_GY_PER_SECOND = 0.1e-6 / 3600;
  const COUNTS_PER_GY = 2e6 * 3600;
  const DEAD_TIME = 90e-6;

  function radiationAt(beta, background = true) {
    const b = Math.min(0.99999, Math.max(0, Math.abs(beta)));
    const gain = Math.pow((1 + b) / (1 - b), 2);
    const dose = BACKGROUND_GY_PER_SECOND * (background ? gain : gain - 1);
    const incidentCps = dose * COUNTS_PER_GY;
    return {
      doseGyPerSecond: dose,
      incidentCps,
      detectedCps: incidentCps / (1 + incidentCps * DEAD_TIME)
    };
  }

  R.radiation = { at: radiationAt, deadTime: DEAD_TIME,
    backgroundDose: BACKGROUND_GY_PER_SECOND };
})(window.Rel = window.Rel || {});

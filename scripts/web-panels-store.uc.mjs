const PREFS = Object.freeze({
  enabled: "sine.web-panels.enabled",
  width: "sine.web-panels.width",
});

const DEFAULTS = Object.freeze({
  enabled: true,
  width: 420,
});

function readIntPref(name, fallback) {
  const value = Services.prefs.getStringPref(name, String(fallback));
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const WebPanelsStore = Object.freeze({
  get enabled() {
    return Services.prefs.getBoolPref(PREFS.enabled, DEFAULTS.enabled);
  },

  get width() {
    return readIntPref(PREFS.width, DEFAULTS.width);
  },

  prefs: PREFS,
});

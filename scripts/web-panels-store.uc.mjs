export const PANEL_TYPE = "panel";
export const MIN_PANEL_WIDTH = 320;
export const DEFAULT_PANEL_WIDTH = 420;

const PREFS = Object.freeze({
  enabled: "sine.web-panels.enabled",
  compact: "sine.web-panels.compact",
  width: "sine.web-panels.width",
  viewerWidth: "sine.web-panels.viewer-width",
  maxViewerWidth: "sine.web-panels.max-viewer-width",
  railWidth: "sine.web-panels.rail-width",
  maxRailWidth: "sine.web-panels.max-rail-width",
  textMinWidth: "sine.web-panels.text-min-width",
  items: "sine.web-panels.items",
  panelWidths: "sine.web-panels.panel-widths",
  workspaceId: "sine.web-panels.workspace-id",
});

function generateId(prefix = "item") {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

export function normalizeWebPanelUrl(rawUrl) {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function titleFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const TITLE_PREFIX_UNREAD_COUNT = /^\s*(?:\((\d{1,4})\)|\[(\d{1,4})\])(?:\s+|$)/;

export function parseWebPanelUnreadCount(title) {
  if (typeof title !== "string") {
    return null;
  }

  const match = TITLE_PREFIX_UNREAD_COUNT.exec(title);
  if (!match) {
    return null;
  }

  const count = Number.parseInt(match[1] ?? match[2], 10);
  return count > 0 ? count : null;
}

export function formatWebPanelUnreadCount(count) {
  if (!Number.isInteger(count) || count <= 0) {
    return "";
  }
  return count > 99 ? "99+" : String(count);
}

function sanitizeItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const id = item.id ? String(item.id) : null;
  if (!id) {
    return null;
  }

  const url = normalizeWebPanelUrl(item.url);
  if (!url) {
    return null;
  }

  return {
    type: PANEL_TYPE,
    id,
    title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : titleFromUrl(url),
    url,
    workspaceId: typeof item.workspaceId === "string" ? item.workspaceId : "",
  };
}

function readStringPref(name, fallback = "") {
  return Services.prefs.getStringPref(name, fallback);
}

function setStringPref(name, value) {
  Services.prefs.setStringPref(name, String(value));
}

export class WebPanelsStore {
  static prefs = PREFS;

  get enabled() {
    return Services.prefs.getBoolPref(PREFS.enabled, true);
  }

  set enabled(value) {
    Services.prefs.setBoolPref(PREFS.enabled, Boolean(value));
  }

  get compact() {
    return Services.prefs.getBoolPref(PREFS.compact, false);
  }

  set compact(value) {
    Services.prefs.setBoolPref(PREFS.compact, Boolean(value));
  }

  get width() {
    const value = Number.parseInt(readStringPref(PREFS.width, String(DEFAULT_PANEL_WIDTH)), 10);
    return Math.max(MIN_PANEL_WIDTH, Number.isFinite(value) ? value : DEFAULT_PANEL_WIDTH);
  }

  set width(value) {
    const width = Math.max(MIN_PANEL_WIDTH, Math.round(Number(value) || DEFAULT_PANEL_WIDTH));
    setStringPref(PREFS.width, String(width));
  }

  get viewerWidth() {
    const value = Number.parseInt(readStringPref(PREFS.viewerWidth, String(DEFAULT_PANEL_WIDTH)), 10);
    return Math.max(MIN_PANEL_WIDTH, Number.isFinite(value) ? value : DEFAULT_PANEL_WIDTH);
  }

  set viewerWidth(value) {
    const width = Math.max(MIN_PANEL_WIDTH, Math.round(Number(value) || DEFAULT_PANEL_WIDTH));
    setStringPref(PREFS.viewerWidth, String(width));
  }

  get maxViewerWidth() {
    const value = Number.parseInt(readStringPref(PREFS.maxViewerWidth, "1920"), 10);
    return Math.max(MIN_PANEL_WIDTH, Number.isFinite(value) ? value : 1920);
  }

  set maxViewerWidth(value) {
    const width = Math.max(MIN_PANEL_WIDTH, Math.round(Number(value) || 1920));
    setStringPref(PREFS.maxViewerWidth, String(width));
  }

  get railWidth() {
    const value = Number.parseInt(readStringPref(PREFS.railWidth, "40"), 10);
    return Math.max(24, Number.isFinite(value) ? value : 40);
  }

  set railWidth(value) {
    const width = Math.max(24, Math.round(Number(value) || 40));
    setStringPref(PREFS.railWidth, String(width));
  }

  get maxRailWidth() {
    const value = Number.parseInt(readStringPref(PREFS.maxRailWidth, "260"), 10);
    return Math.max(40, Number.isFinite(value) ? value : 260);
  }

  set maxRailWidth(value) {
    const width = Math.max(40, Math.round(Number(value) || 260));
    setStringPref(PREFS.maxRailWidth, String(width));
  }

  get textMinWidth() {
    const value = Number.parseInt(readStringPref(PREFS.textMinWidth, "40"), 10);
    return Math.max(24, Number.isFinite(value) ? value : 40);
  }

  set textMinWidth(value) {
    const width = Math.max(24, Math.round(Number(value) || 40));
    setStringPref(PREFS.textMinWidth, String(width));
  }

  get items() {
    return this.loadItems();
  }

  set items(items) {
    const sanitized = Array.isArray(items) ? items.map(sanitizeItem).filter(Boolean) : [];
    setStringPref(PREFS.items, JSON.stringify(sanitized));
  }

  getPanelWidths() {
    let parsed;
    try {
      parsed = JSON.parse(readStringPref(PREFS.panelWidths, "{}"));
    } catch {
      parsed = {};
    }
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  }

  getPanelWidth(id) {
    const value = this.getPanelWidths()[id];
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  }

  setPanelWidth(id, width) {
    if (!id || !Number.isFinite(width) || width <= 0) {
      return;
    }
    const widths = this.getPanelWidths();
    widths[id] = Math.round(width);
    setStringPref(PREFS.panelWidths, JSON.stringify(widths));
  }

  clearPanelWidth(id) {
    const widths = this.getPanelWidths();
    if (!(id in widths)) {
      return;
    }
    delete widths[id];
    setStringPref(PREFS.panelWidths, JSON.stringify(widths));
  }

  get workspaceId() {
    return readStringPref(PREFS.workspaceId, "");
  }

  set workspaceId(value) {
    setStringPref(PREFS.workspaceId, String(value));
  }

  loadItems({ persistNormalized = false } = {}) {
    let parsed;
    try {
      parsed = JSON.parse(readStringPref(PREFS.items, "[]"));
    } catch {
      parsed = [];
    }

    if (!Array.isArray(parsed)) {
      parsed = [];
    }

    const sanitized = parsed.map(sanitizeItem).filter(Boolean);
    if (persistNormalized) {
      this.items = sanitized;
    }
    return sanitized;
  }

  createPanel(rawUrl, title, workspaceId = "") {
    const url = normalizeWebPanelUrl(rawUrl);
    if (!url) {
      return null;
    }
    return {
      type: PANEL_TYPE,
      id: generateId("panel"),
      title: (title || "").trim() || titleFromUrl(url),
      url,
      workspaceId: typeof workspaceId === "string" ? workspaceId : "",
    };
  }

  insert(item, index = this.items.length) {
    const nextItems = this.items;
    const safeIndex = Math.max(0, Math.min(Number.isInteger(index) ? index : nextItems.length, nextItems.length));
    nextItems.splice(safeIndex, 0, item);
    this.items = nextItems;
    return nextItems;
  }

  updatePanel(id, rawUrl) {
    const url = normalizeWebPanelUrl(rawUrl);
    if (!url) {
      return null;
    }

    const nextItems = this.items;
    const index = nextItems.findIndex(item => item.id === id && item.type === PANEL_TYPE);
    if (index < 0) {
      return null;
    }

    nextItems[index] = {
      ...nextItems[index],
      title: titleFromUrl(url),
      url,
    };
    this.items = nextItems;
    return nextItems[index];
  }

  renamePanel(id, title) {
    const nextItems = this.items;
    const index = nextItems.findIndex(item => item.id === id && item.type === PANEL_TYPE);
    if (index < 0) return null;

    nextItems[index] = {
      ...nextItems[index],
      title: String(title ?? "").trim() || nextItems[index].title,
    };
    this.items = nextItems;
    return nextItems[index];
  }

  remove(id) {
    const nextItems = this.items.filter(item => item.id !== id);
    this.items = nextItems;
    return nextItems;
  }

  move(id, targetIndex) {
    const nextItems = this.items;
    const currentIndex = nextItems.findIndex(item => item.id === id);
    if (currentIndex < 0) {
      return nextItems;
    }

    const [item] = nextItems.splice(currentIndex, 1);
    const safeIndex = Math.max(0, Math.min(targetIndex, nextItems.length));
    nextItems.splice(safeIndex, 0, item);
    this.items = nextItems;
    return nextItems;
  }
}

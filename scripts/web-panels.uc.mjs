import { WebPanelsRuntime } from "./web-panels-runtime.uc.mjs";
import {
  MIN_PANEL_WIDTH,
  PANEL_TYPE,
  WebPanelsStore,
  normalizeWebPanelUrl,
  parseWebPanelUnreadCount,
} from "./web-panels-store.uc.mjs";

const ROOT_ID = "sine-web-panels-root";
const RAIL_ID = "sine-web-panels-rail";
const LIST_ID = "sine-web-panels-list";
const ADD_BUTTON_ID = "sine-web-panels-add-button";
const BACKDROP_ID = "sine-web-panels-backdrop";
const MENU_ID = "sine-web-panels-menu";
const EDITOR_ID = "sine-web-panels-editor";
const SETTINGS_ID = "sine-web-panels-settings";
const TAB_MENU_ITEM_ID = "sine-web-panels-tab-context-add";

function isPanel(item) {
  return item?.type === PANEL_TYPE;
}

function displayCount(count) {
  return Number.isInteger(count) && count > 0 ? (count > 99 ? "99+" : String(count)) : "";
}

class SineWebPanels {
  #store = new WebPanelsStore();
  #root;
  #rail;
  #list;
  #surface;
  #surfaceShell;
  #backdrop;
  #editor;
  #settings;
  #menu;
  #browserChrome;
  #contentContainer;
  #tabContextMenuItem;
  #runtime;
  #items = [];
  #activeIds = [];
  #surfaces = new Map();
  #editorState = null;
  #railInsertIndex = null;
  #unreadCounts = new Map();
  #menuOpenedAt = 0;
  #abortController = new AbortController();
  #prefObserver;
  #compactObserver;
  #textMinWidthObserver;
  #zenSideObserver;
  #resizeState = null;
  #dragState = null;
  #compactHoverTimer = null;
  #compactExpanded = false;
  #resizeHandle;
  #edgeGutter;
  #railResizeHandle;
  #railResizeState = null;
  #hotZone;
  #titleListeners = new Map();

  constructor(windowRef) {
    this.window = windowRef;
    this.document = windowRef.document;
  }

  init() {
    this.destroyExistingRoot();
    this.#items = this.#store.loadItems({ persistNormalized: true });
    this.#mount();
    this.#runtime = new WebPanelsRuntime(this.window);
    this.#applyEnabledState();
    this.#observePrefs();
  }

  destroyExistingRoot() {
    this.document.getElementById(ROOT_ID)?.remove();
    this.document.getElementById(EDITOR_ID)?.remove();
    this.document.getElementById(SETTINGS_ID)?.remove();
    this.document.getElementById(TAB_MENU_ITEM_ID)?.remove();
  }

  destroy() {
    this.#titleListeners.clear();
    this.#abortController.abort();
    if (this.#prefObserver) {
      Services.prefs.removeObserver(WebPanelsStore.prefs.enabled, this.#prefObserver);
    }
    if (this.#compactObserver) {
      Services.prefs.removeObserver(WebPanelsStore.prefs.compact, this.#compactObserver);
    }
    if (this.#textMinWidthObserver) {
      Services.prefs.removeObserver(WebPanelsStore.prefs.textMinWidth, this.#textMinWidthObserver);
    }
    this.#zenSideObserver?.disconnect();
    this.#clearCompactHoverTimer();
    this.#runtime?.destroy();
    this.#resetChromeLayout();
    this.#editor?.remove();
    this.#settings?.remove();
    this.#tabContextMenuItem?.remove();
    this.#edgeGutter?.remove();
    this.#root?.remove();
    this.#activeIds = [];
    this.#editor = null;
    this.#tabContextMenuItem = null;
    this.#root = null;
  }

  #mount() {
    this.#browserChrome = this.document.getElementById("browser");
    if (!this.#browserChrome) {
      console.warn("[Web Panels] Browser chrome root was not found.");
      return;
    }

    this.#root = this.#el("div", {
      id: ROOT_ID,
      side: this.#placementSide(),
    });
    this.#root.style.setProperty("--sine-web-panels-width", `${this.#store.viewerWidth}px`);
    this.#root.style.setProperty("--sine-web-panels-rail-size", `${this.#store.railWidth}px`);

    this.#backdrop = this.#el("div", { id: BACKDROP_ID, hidden: "true" });
    this.#surfaceShell = this.#el("div", { id: "sine-web-panels-shell", hidden: "true" });

    this.#rail = this.#el("div", {
      id: RAIL_ID,
      role: "toolbar",
      "aria-label": "Web Panels",
    });
    this.#list = this.#el("div", { id: LIST_ID });
    const addButton = this.#button({
      id: ADD_BUTTON_ID,
      label: "",
      title: "New Web Panel",
      className: "sine-web-panels-add-button",
    });
    addButton.setAttribute("aria-label", "New Web Panel");
    this.#rail.append(this.#list, addButton);

    this.#editor = this.#buildEditor();
    this.#settings = this.#buildSettings();
    this.#menu = this.#el("div", { id: MENU_ID, hidden: "true", role: "menu" });

    const hotZone = this.#el("div", { id: "sine-web-panels-hotzone" });
    this.#hotZone = hotZone;

    const edgeGutter = this.#el("div", { id: "sine-web-panels-edge-gutter" });
    this.#edgeGutter = edgeGutter;

    const resizer = this.#el("div", { id: "sine-web-panels-viewer-resizer", hidden: "true" });
    this.#resizeHandle = resizer;

    const railResizer = this.#el("div", { id: "sine-web-panels-rail-resizer" });
    this.#railResizeHandle = railResizer;

    this.#root.append(this.#backdrop, edgeGutter, resizer, this.#surfaceShell, railResizer, this.#rail, this.#menu, hotZone);
    this.#browserChrome.append(this.#root);
    (this.document.getElementById("mainPopupSet") ?? this.#browserChrome).append(this.#editor);
    (this.document.getElementById("mainPopupSet") ?? this.#browserChrome).append(this.#settings);
    this.#mountTabContextMenuItem();
    this.#syncChromeLayout();
    this.#applyCompactState();

    const signal = this.#abortController.signal;
    addButton.addEventListener("click", event => {
      event.stopPropagation();
      this.#openEditor({ mode: "add", anchor: addButton, insertIndex: this.#items.length });
    }, { signal });
    hotZone.addEventListener("pointerenter", this.#onHotZoneEnter, { signal });
    hotZone.addEventListener("pointerleave", this.#onHotZoneLeave, { signal });
    edgeGutter.addEventListener("pointerdown", this.#onResizeStart, { signal });
    resizer.addEventListener("pointerdown", this.#onResizeStart, { signal });
    railResizer.addEventListener("pointerdown", this.#onRailResizeStart, { signal });
    this.#root.addEventListener("pointerleave", this.#onRootLeave, { signal });
    this.#backdrop.addEventListener("click", () => {
      while (this.#activeIds.length > 0) {
        this.#closePanel(0);
      }
    }, { signal });
    this.#surfaceShell.addEventListener("click", event => event.stopPropagation(), { signal });
    this.#rail.addEventListener("contextmenu", this.#onRailContextMenu, { signal });
    this.window.addEventListener("pointermove", this.#onEdgeHover, { signal });
    this.window.addEventListener("pointermove", this.#onPointerMove, { signal });
    this.window.addEventListener("pointerup", this.#onPointerUp, { signal });
    this.window.addEventListener("pointerleave", this.#onPointerLeave, { signal });
    this.window.addEventListener("resize", this.#onWindowResize, { signal });
    this.document.addEventListener("click", this.#onDocumentClick, { signal });
    this.document.addEventListener("keydown", this.#onKeyDown, { signal });

    // Listen for Zen workspace changes
    this.window.addEventListener("ZenWorkspaceChanged", this.#onWorkspaceChange, { signal });

    this.#render();
  }

  #mountTabContextMenuItem() {
    const tabContextMenu = this.document.getElementById("tabContextMenu");
    if (!tabContextMenu) {
      console.warn("[Web Panels] Tab context menu was not found.");
      return;
    }

    const menuItem = this.#xul("menuitem", {
      id: TAB_MENU_ITEM_ID,
      label: "Add to Web Panels",
      accesskey: "W",
    });
    const insertBefore =
      this.document.getElementById("context_bookmarkTab") ??
      this.document.getElementById("context_closeTab") ??
      null;
    tabContextMenu.insertBefore(menuItem, insertBefore);
    menuItem.addEventListener("command", this.#onAddTabToWebPanels, {
      signal: this.#abortController.signal,
    });
    tabContextMenu.addEventListener("popupshowing", this.#onTabContextMenuShowing, {
      signal: this.#abortController.signal,
    });
    this.#tabContextMenuItem = menuItem;
  }

  #observePrefs() {
    this.#prefObserver = {
      observe: (_subject, topic, prefName) => {
        if (topic === "nsPref:changed" && prefName === WebPanelsStore.prefs.enabled) {
          this.#applyEnabledState();
        }
      },
    };
    Services.prefs.addObserver(WebPanelsStore.prefs.enabled, this.#prefObserver);

    this.#compactObserver = {
      observe: (_subject, topic, prefName) => {
        if (topic === "nsPref:changed" && prefName === WebPanelsStore.prefs.compact) {
          this.#applyCompactState();
        }
      },
    };
    Services.prefs.addObserver(WebPanelsStore.prefs.compact, this.#compactObserver);

    this.#textMinWidthObserver = {
      observe: (_subject, topic, prefName) => {
        if (topic === "nsPref:changed" && prefName === WebPanelsStore.prefs.textMinWidth) {
          this.#syncLabels();
        }
      },
    };
    Services.prefs.addObserver(WebPanelsStore.prefs.textMinWidth, this.#textMinWidthObserver);

    // Watch for Zen tab position changes
    this.#zenSideObserver = new MutationObserver(() => {
      this.#updateSide();
    });
    this.#zenSideObserver.observe(this.document.documentElement, {
      attributes: true,
      attributeFilter: ["zen-right-side"]
    });
  }

  #applyEnabledState() {
    if (!this.#root) {
      return;
    }

    if (this.#store.enabled) {
      this.#root.removeAttribute("disabled");
      this.#syncChromeLayout();
      this.#render();
      return;
    }

    while (this.#activeIds.length > 0) {
      this.#closePanel(0);
    }
    this.#runtime?.destroy();
    this.#runtime = new WebPanelsRuntime(this.window);
    this.#root.setAttribute("disabled", "true");
    this.#resetChromeLayout();
  }

  #applyCompactState() {
    if (!this.#root) {
      return;
    }

    const compact = this.#store.compact && this.#store.enabled;
    this.#root.toggleAttribute("compact", compact);
    if (compact) {
      this.#compactExpanded = false;
      this.#syncChromeLayout();
    } else {
      this.#clearCompactHoverTimer();
      this.#compactExpanded = false;
      this.#syncChromeLayout();
    }
  }

  #onHotZoneEnter = () => {
    console.log("[PANELS] hotzone enter");
    if (!this.#store.compact || !this.#store.enabled) {
      return;
    }
    if (this.#activeIds.length > 0 && this.#root.hasAttribute("compact-panel-active")) {
      console.log("[PANELS] re-entering from compact-panel-active, expanding");
      this.#clearCompactHoverTimer();
      this.#root.removeAttribute("compact-panel-active");
      this.#root.setAttribute("compact-expanded", "true");
      this.#compactExpanded = true;
      this.#reconcile();
      return;
    }
    if (this.#activeIds.length > 0 || this.#compactExpanded) {
      return;
    }
    this.#clearCompactHoverTimer();
    this.#compactExpanded = true;
    this.#root.setAttribute("compact-expanded", "true");
    this.#reconcile();
  };

  #onHotZoneLeave = () => {
    this.#clearCompactHoverTimer();
  };

  #isCursorInSafeZone(event) {
    // Active resize is a hard modal state — collapse is fully disabled
    if (this.#resizeState || this.#railResizeState) return true;

    const side = this.#placementSide();
    const fromEdge = side === "right"
      ? this.window.innerWidth - event.clientX
      : event.clientX;

    // UI hit-test first — eliminates the 2-3px dead zone between
    // the resize handle outer edge and the geometric boundary
    const onPanelUI = event.target instanceof Element && (
      this.#rail.contains(event.target) ||
      this.#railResizeHandle?.contains(event.target) ||
      this.#edgeGutter?.contains(event.target) ||
      this.#resizeHandle?.contains(event.target) ||
      this.#hotZone.contains(event.target)
    );
    if (onPanelUI) return true;

    const styles = this.window.getComputedStyle(this.#root);
    const gap = Number.parseFloat(styles.getPropertyValue("--sine-web-panels-gap")) || 6;
    const railSize = Number.parseFloat(styles.getPropertyValue("--sine-web-panels-rail-size")) || 40;
    // +14 covers the 6px resize handle + 8px buffer past rail edge,
    // so fast cursor movement that skips over the handle still stays
    // within the safe zone
    const exitBoundary = gap + railSize + 14;

    return fromEdge <= exitBoundary;
  }

  #onEdgeHover = event => {
    if (!this.#store.compact || !this.#store.enabled) {
      return;
    }

    // Hard-gate: collapse is disabled while cursor hovers a resize handle
    // or an active drag is in progress. Checked here before any geometry
    // logic so resize interactions never compete with collapse scheduling.
    if (
      this.#resizeState ||
      this.#railResizeState ||
      this.#edgeGutter?.matches(":hover") ||
      this.#resizeHandle?.matches(":hover") ||
      this.#railResizeHandle?.matches(":hover")
    ) {
      this.#clearCompactHoverTimer();
      return;
    }

    const side = this.#placementSide();
    const fromEdge = side === "right"
      ? this.window.innerWidth - event.clientX
      : event.clientX;

    if (!this.#compactExpanded) {
      if (fromEdge <= 12) {
        this.#clearCompactHoverTimer();
        if (this.#root.hasAttribute("compact-panel-active")) {
          this.#root.removeAttribute("compact-panel-active");
        }
        this.#compactExpanded = true;
        this.#root.setAttribute("compact-expanded", "true");
        this.#reconcile();
      }
      return;
    }

    if (this.#isCursorInSafeZone(event)) {
      this.#clearCompactHoverTimer();
    } else if (this.#compactHoverTimer === null) {
      this.#scheduleCollapse();
    }
  };

  #onPointerLeave = event => {
    if (!this.#store.compact || !this.#store.enabled || !this.#compactExpanded) {
      return;
    }

    // When the cursor leaves the window entirely, collapse the panel
    // This handles the case where the user moves the cursor off-screen
    if (this.#compactHoverTimer === null) {
      this.#scheduleCollapse();
    }
  };

  #onWorkspaceChange = () => {
    // Re-render rail when workspace changes to show/hide workspace-specific panels
    this.#render();
  };

  #onRootLeave = event => {
    if (!this.#store.compact || !this.#store.enabled || !this.#compactExpanded) {
      return;
    }

    // Don't trust relatedTarget — use geometry with a safety margin
    const side = this.#placementSide();
    const fromEdge = side === "right"
      ? this.window.innerWidth - event.clientX
      : event.clientX;

    const styles = this.window.getComputedStyle(this.#root);
    const gap = Number.parseFloat(styles.getPropertyValue("--sine-web-panels-gap")) || 6;
    const railSize = Number.parseFloat(styles.getPropertyValue("--sine-web-panels-rail-size")) || 40;
    const exitBoundary = gap + railSize + 14;

    // +6 safety margin: pointerleave events can fire from subpixel
    // hit-test changes during layout/transition
    if (fromEdge <= exitBoundary + 6) {
      return;
    }

    if (this.#compactHoverTimer === null) {
      this.#scheduleCollapse();
    }
  };

  #reconcile() {
    this.#syncSurfaces();
    this.#syncLayout();
    this.#syncChromeLayout();
  }

  #syncSurfaces() {
    const desired = new Set(this.#activeIds);

    for (const [id, surface] of this.#surfaces) {
      if (!desired.has(id)) {
        const browser = surface.querySelector("browser");
        if (browser) {
          this.#titleListeners.delete(browser);
        }
        surface.remove();
        this.#runtime.unload(id);
        this.#surfaces.delete(id);
      }
    }

    for (const id of this.#activeIds) {
      if (this.#surfaces.has(id)) continue;

      const surface = this.#el("div", { class: "sine-web-panels-surface" });
      surface.style.cssText = "min-width:0;min-height:0;width:100%;height:100%;display:flex;background:Canvas;overflow:hidden;";
      this.#surfaceShell.append(surface);
      this.#surfaces.set(id, surface);

      const item = this.#items.find(i => i.id === id);
      if (item) {
        const browser = this.#runtime.attach(item, surface);
        this.#bindBrowserTitle(item, browser);
      }
    }

    if (this.#activeIds.length > 0) {
      this.#root.setAttribute("active", this.#activeIds[this.#activeIds.length - 1]);
    } else {
      this.#root.removeAttribute("active");
    }
    this.#root.toggleAttribute("open", this.#activeIds.length > 0);
  }

  #syncLayout() {
    const ids = this.#activeIds;
    const surfaces = ids.map(id => this.#surfaces.get(id)).filter(Boolean);
    let areas = this.#resolveLayout(surfaces.length);

    // When tabs are on the right, reverse the area assignment
    // so panels spawn on the left side instead of right
    const side = this.#placementSide();
    if (side === "right") {
      areas = areas.reverse();
    }

    surfaces.forEach((surface, i) => {
      surface.style.gridArea = areas[i] ?? "";
    });

    this.#root.setAttribute("panel-count", String(ids.length));

    if (this.#resizeHandle) {
      this.#resizeHandle.hidden = ids.length === 0;
    }
    if (this.#edgeGutter) {
      this.#edgeGutter.hidden = ids.length === 0;
    }
    if (this.#railResizeHandle) {
      this.#railResizeHandle.hidden = false;
    }
  }

  #resolveLayout(count) {
    switch (count) {
      case 0: return [];
      case 1: return ["1 / 1 / 3 / 3"];
      case 2: return ["2 / 1 / 3 / 2", "1 / 1 / 2 / 2"];
      case 3: return ["2 / 1 / 3 / 3", "1 / 1 / 2 / 2", "1 / 2 / 2 / 3"];
      default: return ["2 / 1 / 3 / 2", "1 / 1 / 2 / 2", "1 / 2 / 2 / 3", "2 / 2 / 3 / 3"];
    }
  }

  #collapseCompact() {
    if (!this.#compactExpanded) {
      return;
    }
    this.#compactExpanded = false;
    this.#root.removeAttribute("compact-expanded");
    this.#reconcile();
  }

  #clearCompactHoverTimer() {
    if (this.#compactHoverTimer !== null) {
      this.window.clearTimeout(this.#compactHoverTimer);
      this.#compactHoverTimer = null;
    }
  }

  #scheduleCollapse() {
    if (this.#compactHoverTimer !== null) {
      return;
    }
    this.#compactHoverTimer = this.window.setTimeout(() => {
      this.#compactHoverTimer = null;
      if (!this.#compactExpanded) {
        return;
      }
      if (this.#activeIds.length > 0) {
        this.#root.removeAttribute("compact-expanded");
        this.#root.setAttribute("compact-panel-active", "true");
        this.#compactExpanded = false;
        this.#reconcile();
      } else {
        this.#collapseCompact();
      }
    }, 250);
  }

  #syncLabels() {
    const styles = this.window.getComputedStyle(this.#root);
    const railSize = Number.parseFloat(styles.getPropertyValue("--sine-web-panels-rail-size")) || 0;
    this.#root.toggleAttribute("labels", railSize > this.#store.textMinWidth);
  }

  #syncChromeLayout() {
    if (!this.#browserChrome || !this.#root || !this.#store.enabled) {
      return;
    }

    const side = this.#placementSide();
    const styles = this.window.getComputedStyle(this.#root);
    const compact = this.#store.compact && !this.#compactExpanded;
    const railSize = compact
      ? 0
      : Number.parseFloat(styles.getPropertyValue("--sine-web-panels-rail-size")) || 40;
    const gap = Number.parseFloat(styles.getPropertyValue("--sine-web-panels-gap")) || 8;
    // In compact mode when collapsed, don't reserve any space (rail has width: 0)
    // This matches Zen's behavior where the sidebar doesn't take up space when hidden
    const reservedSize = compact ? "0px" : `${railSize + gap}px`;
    this.#browserChrome.setAttribute("sine-web-panels-side", side);
    this.#browserChrome.style.setProperty(
      "--sine-web-panels-reserved-inline-size",
      reservedSize
    );
    this.#contentContainer = this.#findContentContainer();
    this.#contentContainer?.style.removeProperty("margin-inline-start");
    this.#contentContainer?.style.removeProperty("margin-inline-end");
    this.#contentContainer?.style.setProperty(
      side === "right" ? "margin-inline-end" : "margin-inline-start",
      reservedSize,
      "important"
    );
  }

  #resetChromeLayout() {
    this.#browserChrome?.removeAttribute("sine-web-panels-side");
    this.#browserChrome?.style.removeProperty("--sine-web-panels-reserved-inline-size");
    this.#contentContainer?.style.removeProperty("margin-inline-start");
    this.#contentContainer?.style.removeProperty("margin-inline-end");
    this.#contentContainer = null;
  }

  #findContentContainer() {
    return (
      this.document.getElementById("zen-appcontent-wrapper") ??
      this.document.getElementById("zen-tabbox-wrapper") ??
      this.document.getElementById("tabbrowser-tabbox") ??
      this.document.getElementById("appcontent")
    );
  }

  #getCurrentWorkspace() {
    if (typeof window.gZenWorkspaces !== "undefined") {
      try {
        return window.gZenWorkspaces.activeWorkspace || "";
      } catch (e) {
        return "";
      }
    }
    return "";
  }

  #render() {
    if (!this.#list || !this.#store.enabled) {
      return;
    }

    const currentWorkspace = this.#getCurrentWorkspace();
    this.#items = this.#store.items.filter(item => {
      // Show panel if workspaceId is empty (all workspaces) or matches current workspace
      return !item.workspaceId || item.workspaceId === currentWorkspace;
    });
    this.#runtime?.unloadMissing(this.#items.filter(isPanel).map(item => item.id));

    this.#list.replaceChildren();
    let itemIndex = 0;

    for (const item of this.#items) {
      this.#list.append(this.#renderPanelButton(item, itemIndex));
      itemIndex++;
    }

    this.#root.toggleAttribute("has-items", this.#items.length > 0);
    this.#root.setAttribute("side", this.#placementSide());
    this.#syncChromeLayout();
    this.#syncLabels();
  }

  #renderPanelButton(item, index) {
    const button = this.#button({
      className: "sine-web-panels-item sine-web-panels-panel-button",
      title: item.title || item.url,
    });
    button.dataset.itemId = item.id;
    button.dataset.index = String(index);
    button.setAttribute("aria-label", item.title || item.url);
    if (this.#activeIds.includes(item.id)) {
      button.setAttribute("active", "true");
    }

    const icon = this.#el("img", {
      class: "sine-web-panels-favicon",
      alt: "",
      draggable: "false",
    });
    icon.src = `page-icon:${item.url}`;
    icon.addEventListener("error", () => {
      icon.removeAttribute("src");
      icon.setAttribute("fallback", "true");
    }, { once: true });
    const label = this.#el("span", { class: "sine-web-panels-label" }, item.title || item.url);
    button.append(icon, label);
    this.#applyUnreadBadge(button, item.id);

    button.addEventListener("click", event => {
      event.stopPropagation();
      this.#togglePanel(item);
    }, { signal: this.#abortController.signal });
    button.addEventListener("contextmenu", event => this.#openItemMenu(event, item), {
      signal: this.#abortController.signal,
    });
    button.addEventListener("pointerdown", event => this.#onItemPointerDown(event, item), {
      signal: this.#abortController.signal,
    });
    return button;
  }

  #togglePanel(item) {
    const idx = this.#activeIds.indexOf(item.id);
    if (idx >= 0) {
      this.#closePanel(idx);
      return;
    }
    if (this.#activeIds.length >= 4) {
      return;
    }
    this.#openPanel(item);
  }

  #openPanel(item) {
    if (this.#activeIds.length >= 4) return;
    if (this.#activeIds.includes(item.id)) return;

    this.#closeEditor();
    this.#activeIds = [...this.#activeIds, item.id];

    if (this.#store.compact) {
      this.#compactExpanded = true;
      this.#root.setAttribute("compact-expanded", "true");
    }

    // Single-panel width memory: if this is the only panel open and the
    // user previously resized it while it was the only one open, restore
    // that width instead of the global default. Multi-panel sessions
    // never read or write this — they always use the global viewerWidth
    // pref, untouched by this feature.
    if (this.#activeIds.length === 1) {
      const remembered = this.#store.getPanelWidth(item.id);
      const width = remembered > 0 ? remembered : this.#store.viewerWidth;
      const clamped = this.#clampWidth(width);
      this.#root.style.setProperty("--sine-web-panels-width", `${clamped}px`);
    } else {
      this.#root.style.setProperty("--sine-web-panels-width", `${this.#clampWidth(this.#store.viewerWidth)}px`);
    }

    this.#surfaceShell.hidden = false;
    this.#backdrop.hidden = false;
    this.#reconcile();
    this.#render();
  }

  #closePanel(idx) {
    const animate = typeof idx !== "number";
    const index = typeof idx === "number" ? idx : this.#activeIds.length - 1;
    const id = this.#activeIds[index];
    if (!id) return;

    this.#activeIds = this.#activeIds.filter(x => x !== id);
    this.#unreadCounts.delete(id);
    // Clean up the title listener reference for this panel's browser.
    const surface = this.#surfaces.get(id);
    const browser = surface?.querySelector?.("browser");
    if (browser) {
      this.#titleListeners.delete(browser);
    }
    this.#reconcile();
    this.#render();

    if (this.#activeIds.length === 0) {
      if (animate) {
        this.#root.setAttribute("closing", "true");
        this.window.setTimeout(() => {
          if (this.#activeIds.length === 0) {
            this.#surfaceShell.hidden = true;
            this.#backdrop.hidden = true;
            this.#root?.removeAttribute("closing");
          }
        }, 90);
      } else {
        this.#surfaceShell.hidden = true;
        this.#backdrop.hidden = true;
        this.#root.removeAttribute("closing");
      }
    }
  }

  #bindBrowserTitle(item, browser) {
    if (browser.getAttribute("sine-web-panels-title-bound") === item.id) {
      return;
    }
    browser.setAttribute("sine-web-panels-title-bound", item.id);
    const update = () => {
      const title = browser.contentTitle || browser.getAttribute("contentTitle") || "";
      const count = parseWebPanelUnreadCount(title);
      const prev = this.#unreadCounts.get(item.id) ?? 0;
      if (count) {
        this.#unreadCounts.set(item.id, count);
      } else {
        this.#unreadCounts.delete(item.id);
      }
      // Only touch the DOM when the count actually changed — avoids
      // rebuilding the entire rail on every title-change event (which
      // fires constantly on Gmail/Discord/Slack/Outlook).
      if (count !== prev) {
        this.#updateUnreadBadge(item.id);
      }
    };
    browser.addEventListener("DOMTitleChanged", update, { signal: this.#abortController.signal });
    browser.addEventListener("load", update, { signal: this.#abortController.signal });
    this.#titleListeners.set(browser, update);
  }

  #applyUnreadBadge(button, itemId) {
    const count = this.#unreadCounts.get(itemId);
    const badge = displayCount(count);
    if (!badge) {
      return;
    }

    button.setAttribute("badged", "true");
    button.setAttribute("unread-count", String(count));
    button.append(this.#el("span", { class: "sine-web-panels-badge" }, badge));
  }

  // Updates only the badge on the button for `itemId`, without rebuilding
  // the whole rail. Called from the title-change listener when the unread
  // count actually changes.
  #updateUnreadBadge(itemId) {
    const count = this.#unreadCounts.get(itemId);
    const badgeText = displayCount(count);
    const button = this.#list.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`);
    if (!button) {
      return;
    }
    if (!badgeText) {
      button.removeAttribute("badged");
      button.removeAttribute("unread-count");
      button.querySelector(".sine-web-panels-badge")?.remove();
      return;
    }
    button.setAttribute("badged", "true");
    button.setAttribute("unread-count", String(count));
    let badge = button.querySelector(".sine-web-panels-badge");
    if (badge) {
      badge.textContent = badgeText;
    } else {
      badge = this.#el("span", { class: "sine-web-panels-badge" }, badgeText);
      button.append(badge);
    }
  }

  #buildEditor() {
    const editor = this.#xul("panel", {
      id: EDITOR_ID,
      class: "cui-widget-panel panel-no-padding",
      type: "arrow",
      orient: "vertical",
      flip: "slide",
      consumeoutsideclicks: "never",
      hidden: "true",
    });
    const form = this.#el("form", { id: "sine-web-panels-editor-content" });
    const input = this.#el("input", {
      id: "sine-web-panels-url-input",
      type: "text",
      autocomplete: "url",
      placeholder: "https://calendar.google.com",
      "aria-label": "Web Panel URL",
    });

    // Workspace dropdown
    const workspaceRow = this.#el("div", { class: "sine-web-panels-editor-row" });
    const workspaceLabel = this.#el("label", { class: "sine-web-panels-editor-label" }, "Workspace");
    const workspaceSelect = this.#el("select", {
      id: "sine-web-panels-editor-workspace",
      class: "sine-web-panels-editor-select",
    });

    // Populate workspace options
    const allWorkspacesOption = this.#el("option", { value: "" }, "All Workspaces");
    workspaceSelect.append(allWorkspacesOption);

    // Try to get Zen workspaces if available
    if (typeof window.gZenWorkspaces !== "undefined") {
      try {
        const workspaces = window.gZenWorkspaces.getWorkspaces();
        for (const workspace of workspaces) {
          const option = this.#el("option", { value: workspace.uuid }, workspace.name || "Unnamed Space");
          workspaceSelect.append(option);
        }
      } catch (e) {
        // Zen workspaces not available, just use "All Workspaces"
      }
    }

    workspaceRow.append(workspaceLabel, workspaceSelect);

    const error = this.#el("div", {
      id: "sine-web-panels-editor-error",
      role: "alert",
      hidden: "true",
    });
    const submit = this.#button({
      id: "sine-web-panels-editor-submit",
      label: "+ Add",
      className: "sine-web-panels-ghost-button",
    });
    submit.type = "submit";
    form.append(input, workspaceRow, submit, error);
    form.addEventListener("submit", event => {
      event.preventDefault();
      this.#saveEditor();
    }, { signal: this.#abortController.signal });
    input.addEventListener("input", () => {
      submit.disabled = !input.value.trim();
      error.hidden = true;
    }, { signal: this.#abortController.signal });
    editor.addEventListener("popuphidden", () => {
      editor.hidden = true;
      this.#editorState = null;
    }, { signal: this.#abortController.signal });
    editor.append(form);
    return editor;
  }

  #buildSettings() {
    const settings = this.#xul("panel", {
      id: SETTINGS_ID,
      class: "cui-widget-panel panel-no-padding",
      type: "arrow",
      orient: "vertical",
      flip: "slide",
      consumeoutsideclicks: "never",
      hidden: "true",
    });

    const content = this.#el("div", { id: "sine-web-panels-settings-content" });

    // Enable Web Panels
    const enabledRow = this.#el("div", { class: "sine-web-panels-setting-row" });
    const enabledLabel = this.#el("label", { class: "sine-web-panels-setting-label" }, "Enable Web Panels");
    const enabledToggle = this.#el("input", {
      type: "checkbox",
      id: "sine-web-panels-setting-enabled",
    });
    enabledToggle.checked = this.#store.enabled;
    enabledToggle.addEventListener("change", () => {
      this.#store.enabled = enabledToggle.checked;
    }, { signal: this.#abortController.signal });
    enabledRow.append(enabledLabel, enabledToggle);

    // Compact Mode
    const compactRow = this.#el("div", { class: "sine-web-panels-setting-row" });
    const compactLabel = this.#el("label", { class: "sine-web-panels-setting-label" }, "Compact Mode");
    const compactToggle = this.#el("input", {
      type: "checkbox",
      id: "sine-web-panels-setting-compact",
    });
    compactToggle.checked = this.#store.compact;
    compactToggle.addEventListener("change", () => {
      this.#store.compact = compactToggle.checked;
    }, { signal: this.#abortController.signal });
    compactRow.append(compactLabel, compactToggle);

    // Panel Width
    const widthRow = this.#el("div", { class: "sine-web-panels-setting-row" });
    const widthLabel = this.#el("label", { class: "sine-web-panels-setting-label" }, "Panel Width");
    const widthInput = this.#el("input", {
      type: "number",
      id: "sine-web-panels-setting-width",
      min: MIN_PANEL_WIDTH,
      max: 1920,
      value: this.#store.width,
    });
    widthInput.addEventListener("change", () => {
      const value = Number.parseInt(widthInput.value, 10);
      if (Number.isFinite(value) && value >= MIN_PANEL_WIDTH) {
        this.#store.width = value;
      } else {
        widthInput.value = this.#store.width;
      }
    }, { signal: this.#abortController.signal });
    widthRow.append(widthLabel, widthInput);

    // Viewer Width
    const viewerWidthRow = this.#el("div", { class: "sine-web-panels-setting-row" });
    const viewerWidthLabel = this.#el("label", { class: "sine-web-panels-setting-label" }, "Viewer Width");
    const viewerWidthInput = this.#el("input", {
      type: "number",
      id: "sine-web-panels-setting-viewer-width",
      min: MIN_PANEL_WIDTH,
      max: 1920,
      value: this.#store.viewerWidth,
    });
    viewerWidthInput.addEventListener("change", () => {
      const value = Number.parseInt(viewerWidthInput.value, 10);
      if (Number.isFinite(value) && value >= MIN_PANEL_WIDTH) {
        this.#store.viewerWidth = value;
      } else {
        viewerWidthInput.value = this.#store.viewerWidth;
      }
    }, { signal: this.#abortController.signal });
    viewerWidthRow.append(viewerWidthLabel, viewerWidthInput);

    // Max Viewer Width
    const maxViewerWidthRow = this.#el("div", { class: "sine-web-panels-setting-row" });
    const maxViewerWidthLabel = this.#el("label", { class: "sine-web-panels-setting-label" }, "Max Viewer Width");
    const maxViewerWidthInput = this.#el("input", {
      type: "number",
      id: "sine-web-panels-setting-max-viewer-width",
      min: MIN_PANEL_WIDTH,
      max: 3840,
      value: this.#store.maxViewerWidth,
    });
    maxViewerWidthInput.addEventListener("change", () => {
      const value = Number.parseInt(maxViewerWidthInput.value, 10);
      if (Number.isFinite(value) && value >= MIN_PANEL_WIDTH) {
        this.#store.maxViewerWidth = value;
      } else {
        maxViewerWidthInput.value = this.#store.maxViewerWidth;
      }
    }, { signal: this.#abortController.signal });
    maxViewerWidthRow.append(maxViewerWidthLabel, maxViewerWidthInput);

    // Rail Width
    const railWidthRow = this.#el("div", { class: "sine-web-panels-setting-row" });
    const railWidthLabel = this.#el("label", { class: "sine-web-panels-setting-label" }, "Rail Width");
    const railWidthInput = this.#el("input", {
      type: "number",
      id: "sine-web-panels-setting-rail-width",
      min: 24,
      max: 260,
      value: this.#store.railWidth,
    });
    railWidthInput.addEventListener("change", () => {
      const value = Number.parseInt(railWidthInput.value, 10);
      if (Number.isFinite(value) && value >= 24) {
        this.#store.railWidth = value;
      } else {
        railWidthInput.value = this.#store.railWidth;
      }
    }, { signal: this.#abortController.signal });
    railWidthRow.append(railWidthLabel, railWidthInput);

    // Text Min Width
    const textMinWidthRow = this.#el("div", { class: "sine-web-panels-setting-row" });
    const textMinWidthLabel = this.#el("label", { class: "sine-web-panels-setting-label" }, "Text Min Width");
    const textMinWidthInput = this.#el("input", {
      type: "number",
      id: "sine-web-panels-setting-text-min-width",
      min: 24,
      max: 260,
      value: this.#store.textMinWidth,
    });
    textMinWidthInput.addEventListener("change", () => {
      const value = Number.parseInt(textMinWidthInput.value, 10);
      if (Number.isFinite(value) && value >= 24) {
        this.#store.textMinWidth = value;
      } else {
        textMinWidthInput.value = this.#store.textMinWidth;
      }
    }, { signal: this.#abortController.signal });
    textMinWidthRow.append(textMinWidthLabel, textMinWidthInput);

    content.append(enabledRow, compactRow, widthRow, viewerWidthRow, maxViewerWidthRow, railWidthRow, textMinWidthRow);
    settings.append(content);

    settings.addEventListener("popuphidden", () => {
      settings.hidden = true;
    }, { signal: this.#abortController.signal });

    return settings;
  }

  #openSettings() {
    this.#closeMenu();
    this.#closeEditor();

    // Refresh values
    const enabledToggle = this.#settings.querySelector("#sine-web-panels-setting-enabled");
    const compactToggle = this.#settings.querySelector("#sine-web-panels-setting-compact");
    const widthInput = this.#settings.querySelector("#sine-web-panels-setting-width");
    const viewerWidthInput = this.#settings.querySelector("#sine-web-panels-setting-viewer-width");
    const maxViewerWidthInput = this.#settings.querySelector("#sine-web-panels-setting-max-viewer-width");
    const railWidthInput = this.#settings.querySelector("#sine-web-panels-setting-rail-width");
    const textMinWidthInput = this.#settings.querySelector("#sine-web-panels-setting-text-min-width");

    if (enabledToggle) enabledToggle.checked = this.#store.enabled;
    if (compactToggle) compactToggle.checked = this.#store.compact;
    if (widthInput) widthInput.value = this.#store.width;
    if (viewerWidthInput) viewerWidthInput.value = this.#store.viewerWidth;
    if (maxViewerWidthInput) maxViewerWidthInput.value = this.#store.maxViewerWidth;
    if (railWidthInput) railWidthInput.value = this.#store.railWidth;
    if (textMinWidthInput) textMinWidthInput.value = this.#store.textMinWidth;

    this.#settings.hidden = false;
    this.#openSettingsPopup();
  }

  #closeSettings() {
    if (!this.#settings) {
      return;
    }

    if (typeof this.#settings.hidePopup === "function" && this.#settings.state !== "closed") {
      this.#settings.hidePopup();
      return;
    }

    this.#settings.hidden = true;
  }

  #openSettingsPopup() {
    const position = this.#placementSide() === "right"
      ? "leftcenter rightcenter"
      : "rightcenter leftcenter";
    this.#settings.openPopup(this.#rail, position, 0, 0, false, false);
  }

  #openEditor({ mode, item = null, anchor = null, insertIndex = this.#items.length }) {
    const input = this.#editor.querySelector("input");
    const workspaceSelect = this.#editor.querySelector("select");
    const submit = this.#editor.querySelector("button");
    const error = this.#editor.querySelector('[role="alert"]');
    this.#closeMenu();
    this.#editorState = { mode, itemId: item?.id ?? null, insertIndex };
    input.value = item?.url ?? this.#currentTabUrl() ?? "";
    workspaceSelect.value = item?.workspaceId ?? "";
    submit.textContent = mode === "edit" ? "Save" : "+ Add";
    submit.disabled = !input.value.trim();
    error.hidden = true;
    this.#editor.hidden = false;
    this.#openEditorPopup(anchor ?? this.#rail);
    this.window.requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  #saveEditor() {
    const input = this.#editor.querySelector("input");
    const workspaceSelect = this.#editor.querySelector("select");
    const error = this.#editor.querySelector('[role="alert"]');
    const url = normalizeWebPanelUrl(input.value);
    if (!url) {
      error.textContent = "Enter a valid http or https URL.";
      error.hidden = false;
      return;
    }

    const workspaceId = workspaceSelect?.value ?? "";

    if (this.#editorState?.mode === "edit") {
      const updated = this.#store.updatePanel(this.#editorState.itemId, url);
      if (updated) {
        updated.workspaceId = workspaceId;
        this.#store.items = [...this.#store.items];
        this.#runtime.unload(updated.id);
        const surface = this.#surfaces.get(updated.id);
        if (surface) {
          this.#runtime.attach(updated, surface);
        }
      }
    } else {
      this.#store.insert(this.#store.createPanel(url, undefined, workspaceId), this.#editorState?.insertIndex ?? this.#items.length);
    }

    this.#closeEditor();
    this.#render();
  }

  #closeEditor() {
    if (!this.#editor) {
      return;
    }

    if (typeof this.#editor.hidePopup === "function" && this.#editor.state !== "closed") {
      this.#editor.hidePopup();
      return;
    }

    this.#editor.hidden = true;
    this.#editorState = null;
  }

  #openItemMenu(event, item) {
    event.preventDefault();
    event.stopPropagation();
    const index = this.#items.findIndex(entry => entry.id === item.id);
    const actions = [
      ["Open in New Tab", () => this.#openInNewTab(item.url)],
      ["Rename", () => this.#renamePanel(item)],
      ["Edit Web Panel", () => this.#openEditor({ mode: "edit", item, anchor: this.#findItemElement(item.id) })],
      ["Move Up", () => this.#moveItem(item.id, index - 1), index <= 0],
      ["Move Down", () => this.#moveItem(item.id, index + 1), index >= this.#items.length - 1],
      ["separator"],
      ["Unload Web Panel", () => this.#runtime.unload(item.id)],
      ["Delete Web Panel", () => this.#deleteItem(item.id)],
    ];
    this.#openMenu(event.clientX, event.clientY, actions);
  }

  #onRailContextMenu = event => {
    if (event.target.closest(".sine-web-panels-item") || event.target.closest(`#${ADD_BUTTON_ID}`)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.#railInsertIndex = this.#insertIndexFromY(event.clientY);
    this.#openMenu(event.clientX, event.clientY, [
      ["New Web Panel", () => this.#openEditor({ mode: "add", anchor: this.#rail, insertIndex: this.#railInsertIndex })],
      ["separator"],
      ["Settings", () => this.#openSettings()],
    ]);
  };

  #openMenu(x, y, actions) {
    this.#closeEditor();
    this.#menu.replaceChildren();
    for (const action of actions) {
      if (action[0] === "separator") {
        this.#menu.append(this.#el("hr"));
        continue;
      }
      const [label, handler, disabled = false] = action;
      const button = this.#button({ label, className: "sine-web-panels-menu-item" });
      button.disabled = disabled;
      button.addEventListener("click", event => {
        event.stopPropagation();
        this.#closeMenu();
        handler();
      }, { signal: this.#abortController.signal });
      this.#menu.append(button);
    }
    this.#menu.hidden = false;
    this.#menuOpenedAt = this.window.performance.now();
    this.#menu.style.left = `${Math.min(x, this.window.innerWidth - 220)}px`;
    this.#menu.style.top = `${Math.min(y, this.window.innerHeight - 20)}px`;
  }

  #closeMenu() {
    this.#menu.hidden = true;
    this.#menuOpenedAt = 0;
  }

  #deleteItem(id) {
    this.#store.remove(id);
    const idx = this.#activeIds.indexOf(id);
    if (idx >= 0) {
      this.#closePanel(idx);
    } else {
      this.#unreadCounts.delete(id);
      this.#render();
    }
  }

  #renamePanel(item) {
    const name = this.window.prompt("Panel name:", item.title || "");
    if (name === null) return;
    const trimmed = name.trim();
    if (trimmed && trimmed !== item.title) {
      this.#store.renamePanel(item.id, trimmed);
      this.#render();
    }
  }

  #moveItem(id, targetIndex) {
    this.#store.move(id, targetIndex);
    this.#render();
  }

  #onItemPointerDown(event, item) {
    if (event.button !== 0) {
      return;
    }
    const target = this.#findItemElement(item.id);
    this.#dragState = {
      itemId: item.id,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      target,
    };
    target?.setPointerCapture?.(event.pointerId);
  }

  #onPointerMove = event => {
    // Active resize disables collapse scheduling — the user is
    // intentionally interacting with the panel boundaries
    if (this.#resizeState) {
      this.#clearCompactHoverTimer();
      this.#resize(event);
      return;
    }

    if (this.#railResizeState) {
      this.#clearCompactHoverTimer();
      this.#onRailResize(event);
      return;
    }

    if (!this.#dragState) {
      return;
    }

    const distance = Math.hypot(event.clientX - this.#dragState.startX, event.clientY - this.#dragState.startY);
    if (!this.#dragState.dragging && distance < 4) {
      return;
    }

    this.#dragState.dragging = true;
    this.#root.setAttribute("dragging", "true");
    this.#dragState.target?.setAttribute("dragging", "true");
    this.#showDropIndicator(this.#insertIndexFromY(event.clientY));
  };

  #onPointerUp = event => {
    if (this.#resizeState) {
      this.#finishResize();
      return;
    }

    if (this.#railResizeState) {
      this.#onRailResizeEnd();
      return;
    }

    if (!this.#dragState) {
      return;
    }

    const drag = this.#dragState;
    this.#dragState = null;
    this.#root.removeAttribute("dragging");
    drag.target?.removeAttribute("dragging");
    this.#hideDropIndicator();

    if (drag.dragging) {
      event.preventDefault();
      this.#store.move(drag.itemId, this.#insertIndexFromY(event.clientY));
      this.#render();
    }
  };

  #showDropIndicator(index) {
    let indicator = this.document.getElementById("sine-web-panels-drop-indicator");
    if (!indicator) {
      indicator = this.#el("div", { id: "sine-web-panels-drop-indicator" });
      this.#rail.append(indicator);
    }

    const children = [...this.#list.querySelectorAll(".sine-web-panels-item")];
    const target = children[index] ?? children[children.length - 1];
    const railRect = this.#rail.getBoundingClientRect();
    const targetRect = target?.getBoundingClientRect();
    const top = targetRect
      ? index >= children.length
        ? targetRect.bottom - railRect.top + 3
        : targetRect.top - railRect.top - 3
      : 16;
    indicator.style.top = `${top}px`;
  }

  #hideDropIndicator() {
    this.document.getElementById("sine-web-panels-drop-indicator")?.remove();
  }

  #insertIndexFromY(clientY) {
    const nodes = [...this.#list.querySelectorAll(".sine-web-panels-item")];
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return Number.parseInt(node.dataset.index, 10);
      }
    }
    return this.#items.length;
  }

  #onResizeStart = event => {
    event.preventDefault();
    const count = this.#activeIds.filter(Boolean).length;
    if (count === 0) return;
    const width = this.#surfaceShell.getBoundingClientRect().width;
    this.#resizeState = {
      startX: event.clientX,
      startWidth: width,
      side: this.#placementSide(),
    };
    this.#root.setAttribute("resizing", "true");
  };

  #resize(event) {
    const delta = this.#resizeState.side === "right"
      ? this.#resizeState.startX - event.clientX
      : event.clientX - this.#resizeState.startX;
    const width = this.#clampWidth(this.#resizeState.startWidth + delta);
    this.#root.style.setProperty("--sine-web-panels-width", `${width}px`);
  }

  #finishResize() {
    const width = Number.parseInt(
      this.window.getComputedStyle(this.#root).getPropertyValue("--sine-web-panels-width"),
      10
    );
    const clamped = this.#clampWidth(width);

    if (this.#activeIds.length === 1) {
      // Single panel open: remember this width against that panel
      // specifically, and leave the global pref untouched.
      this.#store.setPanelWidth(this.#activeIds[0], clamped);
    } else {
      // Multi-panel: unchanged from original behavior, global pref only.
      this.#store.viewerWidth = clamped;
    }

    this.#root.style.setProperty("--sine-web-panels-width", `${clamped}px`);
    this.#root.removeAttribute("resizing");
    this.#resizeState = null;
  }

  #clampWidth(width) {
    const railRect = this.#rail.getBoundingClientRect();
    const gap = Number.parseFloat(this.window.getComputedStyle(this.#root).getPropertyValue("--sine-web-panels-gap")) || 8;
    const prefMax = this.#store.maxViewerWidth;
    const viewportMax = this.window.innerWidth - railRect.width - gap * 3;
    const max = Math.min(prefMax, viewportMax);
    return Math.min(max, Math.max(MIN_PANEL_WIDTH, Math.round(width)));
  }

  #onWindowResize = () => {
    if (this.#activeIds.length === 1) {
      // Re-clamp whatever this single panel's current width is (don't
      // force it back to the global pref), so its remembered width
      // still respects new viewport bounds after a window resize.
      const current = Number.parseInt(
        this.window.getComputedStyle(this.#root).getPropertyValue("--sine-web-panels-width"),
        10
      );
      const clamped = this.#clampWidth(Number.isFinite(current) ? current : this.#store.viewerWidth);
      this.#root.style.setProperty("--sine-web-panels-width", `${clamped}px`);
      return;
    }
    const width = this.#clampWidth(this.#store.viewerWidth);
    this.#store.viewerWidth = width;
    this.#root.style.setProperty("--sine-web-panels-width", `${width}px`);
  };

  #onRailResizeStart = event => {
    event.preventDefault();
    this.#clearCompactHoverTimer();
    const railRect = this.#rail.getBoundingClientRect();
    this.#railResizeState = {
      startX: event.clientX,
      startWidth: railRect.width,
      side: this.#placementSide(),
    };
    this.#root.setAttribute("resizing-rail", "true");
  };

  #onRailResize = event => {
    if (!this.#railResizeState) return;
    const delta = this.#railResizeState.side === "right"
      ? this.#railResizeState.startX - event.clientX
      : event.clientX - this.#railResizeState.startX;
    const width = Math.max(32, Math.min(this.#store.maxRailWidth, this.#railResizeState.startWidth + delta));
    this.#root.style.setProperty("--sine-web-panels-rail-size", `${width}px`);
    this.#syncLabels();

    // Sync browser chrome margin live so the page doesn't overlap or leave a gap
    const gap = Number.parseFloat(
      this.window.getComputedStyle(this.#root).getPropertyValue("--sine-web-panels-gap")
    ) || 6;
    const reserved = `${width + gap}px`;
    const side = this.#placementSide();
    this.#browserChrome.style.setProperty("--sine-web-panels-reserved-inline-size", reserved);
    const container = this.#contentContainer ?? this.#findContentContainer();
    container?.style.setProperty(
      side === "right" ? "margin-inline-end" : "margin-inline-start",
      reserved,
      "important"
    );
  };

  #onRailResizeEnd = () => {
    const size = Number.parseInt(
      this.window.getComputedStyle(this.#root).getPropertyValue("--sine-web-panels-rail-size"),
      10
    );
    this.#store.railWidth = Math.max(32, Math.min(this.#store.maxRailWidth, Math.round(size)));
    this.#root.style.setProperty("--sine-web-panels-rail-size", `${this.#store.railWidth}px`);
    this.#syncLabels();
    this.#root.removeAttribute("resizing-rail");
    this.#railResizeState = null;
  };

  #onDocumentClick = event => {
    if (!this.#menu.hidden && this.window.performance.now() - this.#menuOpenedAt < 250) {
      return;
    }
    if (event.target.closest(`#${MENU_ID}`) || event.target.closest(`#${EDITOR_ID}`)) {
      return;
    }
    this.#closeMenu();
    if (!event.target.closest(`#${ADD_BUTTON_ID}`)) {
      this.#closeEditor();
    }
  };

  #onKeyDown = event => {
    if (event.key === "Escape") {
      this.#closeMenu();
      this.#closeEditor();
      this.#closePanel();
    }
  };

  #onTabContextMenuShowing = event => {
    if (event.target.id !== "tabContextMenu" || !this.#tabContextMenuItem) {
      return;
    }

    const url = this.#contextTabUrl();
    const isAvailable = this.#store.enabled && Boolean(url);
    this.#tabContextMenuItem.hidden = false;
    this.#tabContextMenuItem.disabled = !isAvailable;
  };

  #onAddTabToWebPanels = event => {
    event.preventDefault();
    const url = this.#contextTabUrl();
    if (!url) return;

    const tab =
      this.window.TabContextMenu?.contextTab ??
      this.window.gBrowser?.selectedTab ??
      null;
    const tabTitle = tab?.label || "";
    const panel = this.#store.createPanel(url, tabTitle);
    if (!panel) return;

    this.#store.insert(panel, this.#store.items.length);
    this.#render();
  };

  #contextTabUrl() {
    const tab =
      this.window.TabContextMenu?.contextTab ??
      this.window.gBrowser?.selectedTab ??
      null;
    const spec = tab?.linkedBrowser?.currentURI?.spec;
    return normalizeWebPanelUrl(spec);
  }

  #openEditorPopup(anchor) {
    if (typeof this.#editor.openPopup !== "function") {
      return;
    }

    const position = this.#placementSide() === "right"
      ? "leftcenter rightcenter"
      : "rightcenter leftcenter";
    this.#editor.openPopup(anchor, position, 0, 0, false, false);
  }

  #placementSide() {
    return this.document.documentElement.getAttribute("zen-right-side") === "true" ? "left" : "right";
  }

  #updateSide() {
    if (!this.#root) {
      return;
    }
    this.#root.setAttribute("side", this.#placementSide());
    this.#syncChromeLayout();
  }

  #currentTabUrl() {
    const spec = this.window.gBrowser?.selectedBrowser?.currentURI?.spec;
    return normalizeWebPanelUrl(spec) ? spec : "";
  }

  #openInNewTab(url) {
    if (typeof this.window.openTrustedLinkIn === "function") {
      this.window.openTrustedLinkIn(url, "tab", {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
      return;
    }
    this.window.gBrowser?.addTrustedTab?.(url, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
  }

  #findItemElement(id) {
    return this.#list.querySelector(`[data-item-id="${CSS.escape(id)}"]`);
  }

  #button({ id = null, label = "", title = "", className = "" } = {}) {
    const button = this.#el("button", { type: "button" }, label);
    if (id) {
      button.id = id;
    }
    if (title) {
      button.title = title;
    }
    if (className) {
      button.className = className;
    }
    return button;
  }

  #el(tagName, attrs = {}, text = null) {
    const element = this.document.createElement(tagName);
    this.#setAttributes(element, attrs);
    if (text) {
      element.textContent = text;
    }
    return element;
  }

  #xul(tagName, attrs = {}) {
    const element = typeof this.document.createXULElement === "function"
      ? this.document.createXULElement(tagName)
      : this.document.createElementNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        tagName
      );
    this.#setAttributes(element, attrs);
    return element;
  }

  #setAttributes(element, attrs = {}) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) {
        continue;
      }
      if (name === "class" || name === "className") {
        element.setAttribute("class", String(value));
      } else if (name === "hidden" && value === "true") {
        element.hidden = true;
      } else {
        element.setAttribute(name, String(value));
      }
    }
  }
}

const instance = new SineWebPanels(window);
instance.init();

if (typeof window.addUnloadListener === "function") {
  window.addUnloadListener(() => instance.destroy());
} else {
  window.addEventListener("unload", () => instance.destroy(), { once: true });
}

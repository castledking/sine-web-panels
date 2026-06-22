import { WebPanelsRuntime } from "./web-panels-runtime.uc.mjs";
import {
  MIN_PANEL_WIDTH,
  PANEL_TYPE,
  SEPARATOR_TYPE,
  WebPanelsStore,
  normalizeWebPanelUrl,
  parseWebPanelUnreadCount,
} from "./web-panels-store.uc.mjs";

const ROOT_ID = "sine-web-panels-root";
const RAIL_ID = "sine-web-panels-rail";
const LIST_ID = "sine-web-panels-list";
const ADD_BUTTON_ID = "sine-web-panels-add-button";
const SURFACE_ID = "sine-web-panels-surface";
const BACKDROP_ID = "sine-web-panels-backdrop";
const MENU_ID = "sine-web-panels-menu";
const EDITOR_ID = "sine-web-panels-editor";

function isPanel(item) {
  return item?.type === PANEL_TYPE;
}

function isSeparator(item) {
  return item?.type === SEPARATOR_TYPE;
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
  #menu;
  #runtime;
  #items = [];
  #activeId = null;
  #editorState = null;
  #railInsertIndex = null;
  #unreadCounts = new Map();
  #abortController = new AbortController();
  #prefObserver;
  #resizeState = null;
  #dragState = null;

  constructor(windowRef) {
    this.window = windowRef;
    this.document = windowRef.document;
  }

  init() {
    this.destroyExistingRoot();
    this.#items = this.#store.loadItems({ persistNormalized: true });
    this.#mount();
    this.#runtime = new WebPanelsRuntime(this.window, this.#surface);
    this.#applyEnabledState();
    this.#observePrefs();
  }

  destroyExistingRoot() {
    this.document.getElementById(ROOT_ID)?.remove();
  }

  destroy() {
    this.#abortController.abort();
    if (this.#prefObserver) {
      Services.prefs.removeObserver(WebPanelsStore.prefs.enabled, this.#prefObserver);
    }
    this.#runtime?.destroy();
    this.#root?.remove();
    this.#activeId = null;
    this.#root = null;
  }

  #mount() {
    const browserChrome = this.document.getElementById("browser");
    if (!browserChrome) {
      console.warn("[Web Panels] Browser chrome root was not found.");
      return;
    }

    this.#root = this.#el("div", {
      id: ROOT_ID,
      side: this.#placementSide(),
    });
    this.#root.style.setProperty("--sine-web-panels-width", `${this.#store.width}px`);

    this.#backdrop = this.#el("div", { id: BACKDROP_ID, hidden: "true" });
    this.#surfaceShell = this.#el("div", { id: "sine-web-panels-shell", hidden: "true" });
    const resizer = this.#el("div", {
      id: "sine-web-panels-resizer",
      role: "separator",
      "aria-orientation": "vertical",
      title: "Resize Web Panel",
    });
    this.#surface = this.#el("div", { id: SURFACE_ID });
    this.#surfaceShell.append(resizer, this.#surface);

    this.#rail = this.#el("div", {
      id: RAIL_ID,
      role: "toolbar",
      "aria-label": "Web Panels",
    });
    this.#list = this.#el("div", { id: LIST_ID });
    const addButton = this.#button({
      id: ADD_BUTTON_ID,
      label: "+",
      title: "New Web Panel",
      className: "sine-web-panels-add-button",
    });
    this.#rail.append(this.#list, addButton);

    this.#editor = this.#buildEditor();
    this.#menu = this.#el("div", { id: MENU_ID, hidden: "true", role: "menu" });

    this.#root.append(this.#backdrop, this.#surfaceShell, this.#rail, this.#editor, this.#menu);
    browserChrome.append(this.#root);

    const signal = this.#abortController.signal;
    addButton.addEventListener("click", event => {
      event.stopPropagation();
      this.#openEditor({ mode: "add", anchor: addButton, insertIndex: this.#items.length });
    }, { signal });
    this.#backdrop.addEventListener("click", () => this.#closePanel(), { signal });
    this.#surfaceShell.addEventListener("click", event => event.stopPropagation(), { signal });
    this.#rail.addEventListener("contextmenu", this.#onRailContextMenu, { signal });
    resizer.addEventListener("pointerdown", this.#onResizeStart, { signal });
    this.window.addEventListener("pointermove", this.#onPointerMove, { signal });
    this.window.addEventListener("pointerup", this.#onPointerUp, { signal });
    this.window.addEventListener("resize", this.#onWindowResize, { signal });
    this.document.addEventListener("click", this.#onDocumentClick, { signal });
    this.document.addEventListener("keydown", this.#onKeyDown, { signal });
    this.#render();
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
  }

  #applyEnabledState() {
    if (!this.#root) {
      return;
    }

    if (this.#store.enabled) {
      this.#root.removeAttribute("disabled");
      this.#render();
      return;
    }

    this.#closePanel();
    this.#runtime?.destroy();
    this.#runtime = new WebPanelsRuntime(this.window, this.#surface);
    this.#root.setAttribute("disabled", "true");
  }

  #render() {
    if (!this.#list || !this.#store.enabled) {
      return;
    }

    this.#items = this.#store.items;
    this.#runtime?.unloadMissing(this.#items.filter(isPanel).map(item => item.id));
    this.#list.replaceChildren();

    for (const [index, item] of this.#items.entries()) {
      const node = isSeparator(item)
        ? this.#renderSeparator(item, index)
        : this.#renderPanelButton(item, index);
      this.#list.append(node);
    }

    this.#root.toggleAttribute("has-items", this.#items.length > 0);
    this.#root.setAttribute("side", this.#placementSide());
  }

  #renderPanelButton(item, index) {
    const button = this.#button({
      className: "sine-web-panels-item sine-web-panels-panel-button",
      title: item.title || item.url,
    });
    button.dataset.itemId = item.id;
    button.dataset.index = String(index);
    button.setAttribute("aria-label", item.title || item.url);
    if (item.id === this.#activeId) {
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
    button.append(icon);
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

  #renderSeparator(item, index) {
    const separator = this.#el("div", {
      class: "sine-web-panels-item sine-web-panels-separator",
      role: "separator",
      "aria-label": "Web Panels separator",
    });
    separator.dataset.itemId = item.id;
    separator.dataset.index = String(index);
    separator.append(this.#el("span"));
    separator.addEventListener("contextmenu", event => this.#openItemMenu(event, item), {
      signal: this.#abortController.signal,
    });
    separator.addEventListener("pointerdown", event => this.#onItemPointerDown(event, item), {
      signal: this.#abortController.signal,
    });
    return separator;
  }

  #togglePanel(item) {
    if (this.#activeId === item.id) {
      this.#closePanel();
      return;
    }
    this.#openPanel(item);
  }

  #openPanel(item) {
    this.#closeEditor();
    const switching = Boolean(this.#activeId);
    this.#activeId = item.id;
    const browser = this.#runtime.attach(item);
    this.#surfaceShell.hidden = false;
    this.#backdrop.hidden = false;
    this.#root.setAttribute("open", "true");
    this.#root.toggleAttribute("switching", switching);
    this.#root.removeAttribute("closing");
    this.#root.setAttribute("active", item.id);
    this.#bindBrowserTitle(item, browser);
    this.#render();
    this.window.setTimeout(() => this.#root?.removeAttribute("switching"), 90);
  }

  #closePanel({ animate = true } = {}) {
    if (!this.#activeId) {
      return;
    }

    this.#activeId = null;
    this.#root.removeAttribute("active");
    this.#root.removeAttribute("open");
    if (animate) {
      this.#root.setAttribute("closing", "true");
      this.window.setTimeout(() => {
        if (!this.#activeId) {
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
    this.#render();
  }

  #bindBrowserTitle(item, browser) {
    if (browser.getAttribute("sine-web-panels-title-bound") === item.id) {
      return;
    }
    browser.setAttribute("sine-web-panels-title-bound", item.id);
    const update = () => {
      const title = browser.contentTitle || browser.getAttribute("contentTitle") || "";
      const count = parseWebPanelUnreadCount(title);
      if (count) {
        this.#unreadCounts.set(item.id, count);
      } else {
        this.#unreadCounts.delete(item.id);
      }
      this.#render();
    };
    browser.addEventListener("DOMTitleChanged", update, { signal: this.#abortController.signal });
    browser.addEventListener("load", update, { signal: this.#abortController.signal });
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

  #buildEditor() {
    const editor = this.#el("form", { id: EDITOR_ID, hidden: "true" });
    const input = this.#el("input", {
      id: "sine-web-panels-url-input",
      type: "text",
      autocomplete: "url",
      placeholder: "https://calendar.google.com",
      "aria-label": "Web Panel URL",
    });
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
    editor.append(input, submit, error);
    editor.addEventListener("submit", event => {
      event.preventDefault();
      this.#saveEditor();
    }, { signal: this.#abortController.signal });
    input.addEventListener("input", () => {
      submit.disabled = !input.value.trim();
      error.hidden = true;
    }, { signal: this.#abortController.signal });
    return editor;
  }

  #openEditor({ mode, item = null, anchor = null, insertIndex = this.#items.length }) {
    const input = this.#editor.querySelector("input");
    const submit = this.#editor.querySelector("button");
    const error = this.#editor.querySelector('[role="alert"]');
    this.#closeMenu();
    this.#editorState = { mode, itemId: item?.id ?? null, insertIndex };
    input.value = item?.url ?? this.#currentTabUrl() ?? "";
    submit.textContent = mode === "edit" ? "Save" : "+ Add";
    submit.disabled = !input.value.trim();
    error.hidden = true;
    this.#editor.hidden = false;
    this.#positionPopup(this.#editor, anchor ?? this.#rail);
    input.focus();
    input.select();
  }

  #saveEditor() {
    const input = this.#editor.querySelector("input");
    const error = this.#editor.querySelector('[role="alert"]');
    const url = normalizeWebPanelUrl(input.value);
    if (!url) {
      error.textContent = "Enter a valid http or https URL.";
      error.hidden = false;
      return;
    }

    if (this.#editorState?.mode === "edit") {
      const updated = this.#store.updatePanel(this.#editorState.itemId, url);
      if (updated) {
        this.#runtime.unload(updated.id);
      }
    } else {
      this.#store.insert(this.#store.createPanel(url), this.#editorState?.insertIndex ?? this.#items.length);
    }

    this.#closeEditor();
    this.#render();
  }

  #closeEditor() {
    this.#editor.hidden = true;
    this.#editorState = null;
  }

  #openItemMenu(event, item) {
    event.preventDefault();
    event.stopPropagation();
    const index = this.#items.findIndex(entry => entry.id === item.id);
    const actions = isPanel(item)
      ? [
          ["Open in New Tab", () => this.#openInNewTab(item.url)],
          ["Edit Web Panel", () => this.#openEditor({ mode: "edit", item, anchor: this.#findItemElement(item.id) })],
          ["Move Up", () => this.#moveItem(item.id, index - 1), index <= 0],
          ["Move Down", () => this.#moveItem(item.id, index + 1), index >= this.#items.length - 1],
          ["separator"],
          ["Unload Web Panel", () => this.#runtime.unload(item.id)],
          ["Delete Web Panel", () => this.#deleteItem(item.id)],
        ]
      : [
          ["Move Up", () => this.#moveItem(item.id, index - 1), index <= 0],
          ["Move Down", () => this.#moveItem(item.id, index + 1), index >= this.#items.length - 1],
          ["separator"],
          ["Delete", () => this.#deleteItem(item.id)],
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
      ["Add Spacer", () => {
        this.#store.insert(this.#store.createSeparator(), this.#railInsertIndex);
        this.#render();
      }],
      ["New Web Panel", () => this.#openEditor({ mode: "add", anchor: this.#rail, insertIndex: this.#railInsertIndex })],
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
    this.#menu.style.left = `${Math.min(x, this.window.innerWidth - 220)}px`;
    this.#menu.style.top = `${Math.min(y, this.window.innerHeight - 20)}px`;
  }

  #closeMenu() {
    this.#menu.hidden = true;
  }

  #deleteItem(id) {
    this.#runtime.unload(id);
    this.#store.remove(id);
    if (this.#activeId === id) {
      this.#closePanel({ animate: false });
    }
    this.#unreadCounts.delete(id);
    this.#render();
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
    if (this.#resizeState) {
      this.#resize(event);
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
    this.#store.width = this.#clampWidth(width);
    this.#root.style.setProperty("--sine-web-panels-width", `${this.#store.width}px`);
    this.#root.removeAttribute("resizing");
    this.#resizeState = null;
  }

  #clampWidth(width) {
    const railRect = this.#rail.getBoundingClientRect();
    const gap = Number.parseFloat(this.window.getComputedStyle(this.#root).getPropertyValue("--sine-web-panels-gap")) || 8;
    const max = Math.max(MIN_PANEL_WIDTH, this.window.innerWidth - railRect.width - gap * 3);
    return Math.min(max, Math.max(MIN_PANEL_WIDTH, Math.round(width)));
  }

  #onWindowResize = () => {
    const width = this.#clampWidth(this.#store.width);
    this.#store.width = width;
    this.#root.style.setProperty("--sine-web-panels-width", `${width}px`);
  };

  #onDocumentClick = event => {
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

  #positionPopup(popup, anchor) {
    const anchorRect = anchor.getBoundingClientRect();
    popup.style.removeProperty("left");
    popup.style.removeProperty("right");
    popup.style.top = `${Math.max(8, anchorRect.bottom - popup.offsetHeight - 8)}px`;
    if (this.#placementSide() === "right") {
      popup.style.right = `${this.window.innerWidth - anchorRect.right}px`;
    } else {
      popup.style.left = `${anchorRect.left}px`;
    }
  }

  #placementSide() {
    return this.document.documentElement.getAttribute("zen-right-side") === "true" ? "left" : "right";
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
    for (const [name, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) {
        continue;
      }
      if (name === "class") {
        element.className = value;
      } else if (name === "hidden" && value === "true") {
        element.hidden = true;
      } else {
        element.setAttribute(name, String(value));
      }
    }
    if (text) {
      element.textContent = text;
    }
    return element;
  }
}

const instance = new SineWebPanels(window);
instance.init();

if (typeof window.addUnloadListener === "function") {
  window.addUnloadListener(() => instance.destroy());
} else {
  window.addEventListener("unload", () => instance.destroy(), { once: true });
}

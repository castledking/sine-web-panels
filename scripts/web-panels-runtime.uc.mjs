export class WebPanelsRuntime {
  #window;
  #document;
  #surface;
  #browsers = new Map();

  constructor(windowRef, surface) {
    this.#window = windowRef;
    this.#document = windowRef.document;
    this.#surface = surface;
  }

  getBrowser(item) {
    return this.#browsers.get(item.id)?.browser ?? null;
  }

  ensureBrowser(item) {
    const existing = this.getBrowser(item);
    if (existing) {
      return existing;
    }

    const browser = this.#document.createXULElement
      ? this.#document.createXULElement("browser")
      : this.#document.createElement("browser");
    browser.setAttribute("class", "sine-web-panels-browser");
    browser.setAttribute("type", "content");
    browser.setAttribute("remote", "true");
    browser.setAttribute("maychangeremoteness", "true");
    browser.setAttribute("disableglobalhistory", "false");
    browser.setAttribute("messagemanagergroup", "browsers");
    browser.setAttribute("context", "contentAreaContextMenu");
    browser.setAttribute("tooltip", "aHTMLTooltip");
    browser.setAttribute("autocompletepopup", "PopupAutoComplete");
    browser.setAttribute("selectmenulist", "ContentSelectDropdown");
    browser.setAttribute("sine-web-panel-id", item.id);
    browser.setAttribute("src", item.url);
    browser.setAttribute("flex", "1");
    this.#browsers.set(item.id, { browser, item });
    return browser;
  }

  attach(item) {
    const browser = this.ensureBrowser(item);
    if (browser.parentElement !== this.#surface) {
      this.#surface.replaceChildren(browser);
    }
    return browser;
  }

  unload(id) {
    const runtime = this.#browsers.get(id);
    if (!runtime) {
      return;
    }
    runtime.browser.remove();
    this.#browsers.delete(id);
  }

  unloadMissing(itemIds) {
    const currentIds = new Set(itemIds);
    for (const id of this.#browsers.keys()) {
      if (!currentIds.has(id)) {
        this.unload(id);
      }
    }
  }

  destroy() {
    for (const id of [...this.#browsers.keys()]) {
      this.unload(id);
    }
    this.#surface?.replaceChildren();
    this.#window = null;
    this.#document = null;
    this.#surface = null;
  }
}

import { WebPanelsRuntime } from "./web-panels-runtime.uc.mjs";
import { WebPanelsStore } from "./web-panels-store.uc.mjs";

const ROOT_ID = "sine-web-panels-root";
const RAIL_ID = "sine-web-panels-rail";
const ADD_BUTTON_ID = "sine-web-panels-add-button";

class SineWebPanels {
  #runtime;
  #root;
  #abortController = new AbortController();

  constructor(windowRef) {
    this.window = windowRef;
    this.document = windowRef.document;
    this.#runtime = new WebPanelsRuntime(windowRef);
  }

  init() {
    this.destroyExistingRoot();

    if (!WebPanelsStore.enabled) {
      return;
    }

    const browserChrome = this.document.getElementById("browser");
    if (!browserChrome) {
      console.warn("[Web Panels] Browser chrome root was not found.");
      return;
    }

    this.#root = this.document.createElement("div");
    this.#root.id = ROOT_ID;
    this.#root.style.setProperty("--sine-web-panels-width", `${WebPanelsStore.width}px`);

    const rail = this.document.createElement("div");
    rail.id = RAIL_ID;
    rail.setAttribute("role", "toolbar");
    rail.setAttribute("aria-label", "Web Panels");

    const addButton = this.document.createElement("button");
    addButton.id = ADD_BUTTON_ID;
    addButton.type = "button";
    addButton.setAttribute("aria-label", "New Web Panel");
    addButton.textContent = "+";
    addButton.addEventListener("click", this.#onAddClick, {
      signal: this.#abortController.signal,
    });

    rail.append(addButton);
    this.#root.append(rail);
    browserChrome.append(this.#root);
  }

  destroyExistingRoot() {
    this.document.getElementById(ROOT_ID)?.remove();
  }

  destroy() {
    this.#abortController.abort();
    this.#root?.remove();
    this.#root = null;
    this.#runtime.destroy();
  }

  #onAddClick = () => {
    this.window.alert("Web Panels for Sine loaded. URL management will be added in the next implementation pass.");
  };
}

const instance = new SineWebPanels(window);
instance.init();

if (typeof window.addUnloadListener === "function") {
  window.addUnloadListener(() => instance.destroy());
} else {
  window.addEventListener("unload", () => instance.destroy(), { once: true });
}

export class WebPanelsRuntime {
  #window;

  constructor(windowRef) {
    this.#window = windowRef;
  }

  destroy() {
    this.#window = null;
  }
}

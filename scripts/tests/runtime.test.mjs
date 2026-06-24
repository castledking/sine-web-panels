import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.Services = {
  scriptSecurityManager: {
    getSystemPrincipal() {
      return "system-principal";
    },
  },
};

const { WebPanelsRuntime } = await import("../web-panels-runtime.uc.mjs");

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.classList = new Set();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  closest(selector) {
    return selector === ".browserSidebarContainer" ? this : null;
  }
}

class FakeTab extends FakeElement {
  constructor(url) {
    super();
    this.url = url;
    this.linkedBrowser = new FakeElement();
    this.id = `tab-${Math.random().toString(16).slice(2)}`;
    this.closing = false;
  }
}

function createWindow() {
  const tabs = [];
  const hiddenTabs = [];
  const removedTabs = [];
  const calls = [];

  return {
    calls,
    tabs,
    hiddenTabs,
    removedTabs,
    gBrowser: {
      addTrustedTab(url, options) {
        calls.push({ name: "addTrustedTab", url, options });
        const tab = new FakeTab(url);
        tabs.push(tab);
        return tab;
      },
      hideTab(tab, reason) {
        hiddenTabs.push({ tab, reason });
      },
      removeTab(tab, options) {
        tab.closing = true;
        removedTabs.push({ tab, options });
      },
    },
  };
}

test("ensurePanelTab creates a trusted hidden tab with panel metadata", () => {
  const windowRef = createWindow();
  const runtime = new WebPanelsRuntime(windowRef);
  const parentTab = new FakeTab("https://parent.example/");
  parentTab.id = "parent-1";

  const tab = runtime.ensurePanelTab(
    { id: "panel-1", url: "https://calendar.example/" },
    parentTab
  );

  assert.equal(windowRef.calls.length, 1);
  assert.equal(windowRef.calls[0].name, "addTrustedTab");
  assert.equal(windowRef.calls[0].url, "https://calendar.example/");
  assert.equal(windowRef.calls[0].options.inBackground, true);
  assert.equal(windowRef.calls[0].options.skipAnimation, true);
  assert.equal(windowRef.calls[0].options.skipBackgroundNotify, true);
  assert.equal(windowRef.calls[0].options.triggeringPrincipal, "system-principal");
  assert.equal(tab.getAttribute("sine-web-panel-tab"), "true");
  assert.equal(tab.getAttribute("sine-web-panel-id"), "panel-1");
  assert.equal(tab.getAttribute("sine-web-panel-parent-id"), "parent-1");
  assert.equal(windowRef.hiddenTabs.length, 1);
  assert.equal(windowRef.hiddenTabs[0].tab, tab);
  assert.equal(windowRef.hiddenTabs[0].reason, "sine-web-panels");
});

test("ensurePanelTab reuses existing tabs and refreshes parent metadata", () => {
  const windowRef = createWindow();
  const runtime = new WebPanelsRuntime(windowRef);
  const firstParent = new FakeTab("https://first.example/");
  firstParent.id = "first-parent";
  const secondParent = new FakeTab("https://second.example/");
  secondParent.id = "second-parent";

  const firstTab = runtime.ensurePanelTab(
    { id: "panel-1", url: "https://calendar.example/" },
    firstParent
  );
  const reusedTab = runtime.ensurePanelTab(
    { id: "panel-1", url: "https://calendar.example/" },
    secondParent
  );

  assert.equal(reusedTab, firstTab);
  assert.equal(windowRef.calls.length, 1);
  assert.equal(reusedTab.getAttribute("sine-web-panel-parent-id"), "second-parent");
  assert.equal(runtime.get("panel-1").parentTab, secondParent);
});

test("unload removes the managed tab and clears runtime state", () => {
  const windowRef = createWindow();
  const runtime = new WebPanelsRuntime(windowRef);
  const tab = runtime.ensurePanelTab({ id: "panel-1", url: "https://calendar.example/" });

  runtime.unload("panel-1");

  assert.equal(windowRef.removedTabs.length, 1);
  assert.equal(windowRef.removedTabs[0].tab, tab);
  assert.deepEqual(windowRef.removedTabs[0].options, {
    animate: false,
    skipPermitUnload: true,
  });
  assert.equal(runtime.get("panel-1"), null);
});

test("unloadMissing keeps existing panel ids and removes stale panel tabs", () => {
  const windowRef = createWindow();
  const runtime = new WebPanelsRuntime(windowRef);
  const keptTab = runtime.ensurePanelTab({ id: "panel-keep", url: "https://keep.example/" });
  const removedTab = runtime.ensurePanelTab({ id: "panel-remove", url: "https://remove.example/" });

  runtime.unloadMissing(["panel-keep"]);

  assert.equal(runtime.get("panel-keep").tab, keptTab);
  assert.equal(runtime.get("panel-remove"), null);
  assert.equal(windowRef.removedTabs.length, 1);
  assert.equal(windowRef.removedTabs[0].tab, removedTab);
});

test("noteTabClosed clears the stored tab without deleting the panel record", () => {
  const windowRef = createWindow();
  const runtime = new WebPanelsRuntime(windowRef);
  runtime.ensurePanelTab({ id: "panel-1", url: "https://calendar.example/" });

  runtime.noteTabClosed("panel-1");

  assert.equal(runtime.get("panel-1").tab, undefined);
});

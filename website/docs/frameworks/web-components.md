---
title: Web Components
description: Wrap the Crosswalk editor in a custom element, for Lit or any framework.
---

# Web Components

A custom element wraps the editor once and works in any framework, or none. It's also the way in for frameworks without their own page here.

## The element

```ts title="crosswalk-editor.ts"
import { createMapper, type Mapper } from "@crosswalkjs/canvas";
import type { MapDocument, OperatorRegistry } from "@crosswalkjs/core";

/**
 * <crosswalk-editor>: set `map`, and `registry` for your own operators, before
 * it's added to the page, and listen for `change` events. `theme` is an
 * attribute, so your own themes are registered and used by id.
 */
export class CrosswalkEditor extends HTMLElement {
  static observedAttributes = ["theme"];

  map?: MapDocument;
  registry?: OperatorRegistry;
  #editor?: Mapper;

  connectedCallback() {
    if (!this.map) throw new Error("<crosswalk-editor> needs its map property set before it's added to the page");
    if (!this.style.height) this.style.height = "600px";
    this.style.display = "block";
    this.#editor = createMapper(this, {
      document: this.map,
      theme: this.getAttribute("theme") ?? "ink",
      ...(this.registry ? { registry: this.registry } : {}),
      onChange: (map) => this.dispatchEvent(new CustomEvent("change", { detail: map })),
    });
  }

  disconnectedCallback() {
    this.#editor?.destroy();
    this.#editor = undefined;
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name === "theme") this.#editor?.setTheme(value ?? "ink");
  }

  /** The current map. */
  get value(): MapDocument | undefined {
    return this.#editor?.getDocument() ?? this.map;
  }

  /** Loads a different map. */
  setDocument(map: MapDocument) {
    this.#editor?.setDocument(map);
  }
}

customElements.define("crosswalk-editor", CrosswalkEditor);
```

```ts
import { CrosswalkEditor } from "./crosswalk-editor";

const editor = document.createElement("crosswalk-editor") as CrosswalkEditor;
editor.map = startingMap;
editor.setAttribute("theme", "nord");
editor.addEventListener("change", (event) => save((event as CustomEvent).detail));
document.body.append(editor);
```

:::note Light DOM, not shadow DOM
The element mounts the editor directly inside itself, not in a shadow root. The editor adds its styles to the page's `<head>`, and styles there don't reach inside a shadow root. If your element needs a shadow root for its other markup, keep the editor in a light DOM child and show it through a `<slot>`: slotted content is styled by the page.
:::

## In Lit

Lit components render into a shadow root, where the editor's styles can't reach. Have the Lit component that uses the editor render into its light DOM instead, by overriding `createRenderRoot`:

```ts
import { html, LitElement } from "lit";
import type { MapDocument } from "@crosswalkjs/core";
import "./crosswalk-editor";

class OrderMapper extends LitElement {
  static properties = { map: { attribute: false } };
  declare map: MapDocument;

  // Render into the light DOM, so the editor's page-level styles reach it.
  createRenderRoot() {
    return this;
  }

  render() {
    return html`<crosswalk-editor .map=${this.map} theme="nord" @change=${(event: CustomEvent) => (this.map = event.detail)}></crosswalk-editor>`;
  }
}

customElements.define("order-mapper", OrderMapper);
```

Lit's `.map=${...}` sets the property, which a plain attribute couldn't do for an object.

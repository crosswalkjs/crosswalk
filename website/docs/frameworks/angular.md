---
title: Angular
description: Use the Crosswalk editor in Angular, including with server rendering.
---

# Angular

These examples use standalone components and the signal-based `input()`, `output()` and `viewChild()` APIs, so they need Angular 17.3 or later.

## Install

```bash
npm install @crosswalkjs/canvas @crosswalkjs/core
```

## The component

```ts title="map-editor.component.ts"
import { afterNextRender, Component, effect, ElementRef, input, OnDestroy, output, viewChild } from "@angular/core";
import { createMapper, type Mapper, type ThemeDefinition } from "@crosswalkjs/canvas";
import type { MapDocument, OperatorRegistry } from "@crosswalkjs/core";

@Component({
  selector: "app-map-editor",
  standalone: true,
  template: `<div #host [style.height]="height()"></div>`,
})
export class MapEditorComponent implements OnDestroy {
  readonly map = input.required<MapDocument>();
  /** A theme id, or your own theme. */
  readonly theme = input<string | ThemeDefinition>("ink");
  /** Your operators. Read once, when the editor is created. */
  readonly registry = input<OperatorRegistry>();
  readonly height = input("600px");
  readonly mapChange = output<MapDocument>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>("host");
  private editor?: Mapper;

  constructor() {
    // afterNextRender never runs on the server.
    afterNextRender(() => {
      this.editor = createMapper(this.host().nativeElement, {
        document: this.map(),
        theme: this.theme(),
        registry: this.registry(),
        onChange: (map) => this.mapChange.emit(map),
      });
    });

    effect(() => {
      const theme = this.theme();
      this.editor?.setTheme(theme);
    });
  }

  setDocument(map: MapDocument) {
    this.editor?.setDocument(map);
  }

  ngOnDestroy() {
    this.editor?.destroy();
  }
}
```

## Using it

```ts title="app.component.ts"
import { Component, computed, signal } from "@angular/core";
import { JsonPipe } from "@angular/common";
import { createTransform, type MapDocument } from "@crosswalkjs/core";
import { MapEditorComponent } from "./map-editor.component";
import startingMap from "./order.map.json";
import sampleOrder from "./sample-order.json";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [MapEditorComponent, JsonPipe],
  template: `
    <app-map-editor [map]="startingMap" (mapChange)="map.set($event)" />
    <pre>{{ output() | json }}</pre>
  `,
})
export class AppComponent {
  readonly startingMap = startingMap as MapDocument;
  readonly map = signal(this.startingMap);
  readonly output = computed(() => {
    try {
      return createTransform(this.map())(sampleOrder);
    } catch (error) {
      return (error as Error).message;
    }
  });
}
```

Importing a JSON file needs `"resolveJsonModule": true` in `tsconfig.json`, or load the map with `HttpClient` instead.

The editor is still given the starting map, not `map` ([why](./overview.md#the-map-belongs-to-the-editor)). To load a different map, call the component's `setDocument` through a `viewChild`.

## Server rendering

The component needs no changes for Angular SSR ([why](./overview.md#server-rendering)). On older versions without `afterNextRender`, create the editor in `ngAfterViewInit` inside an `isPlatformBrowser(platformId)` check.

## Zone.js

The editor's pointer and keyboard handling triggers change detection in apps that use zone.js. That's harmless, but on a busy page you can create the editor outside Angular's zone and step back in only for `onChange`:

```ts
this.zone.runOutsideAngular(() => {
  this.editor = createMapper(element, {
    document: this.map(),
    onChange: (map) => this.zone.run(() => this.mapChange.emit(map)),
  });
});
```

`zone` is `inject(NgZone)`. Zoneless apps don't need this.

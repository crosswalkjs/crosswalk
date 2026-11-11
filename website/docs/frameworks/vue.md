---
title: Vue
description: Use the Crosswalk editor in Vue 3 and Nuxt.
---

# Vue

## Install

```bash
npm install @crosswalkjs/canvas @crosswalkjs/core
```

## The component

```vue title="MapEditor.vue"
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { createMapper, type Mapper, type ThemeDefinition } from "@crosswalkjs/canvas";
import type { MapDocument, OperatorRegistry } from "@crosswalkjs/core";

const props = withDefaults(
  defineProps<{
    map: MapDocument;
    /** A theme id, or your own theme. */
    theme?: string | ThemeDefinition;
    /** Your operators. Read once, when the editor is created. */
    registry?: OperatorRegistry;
    height?: string;
  }>(),
  {
    theme: "ink",
    height: "600px",
  },
);
const emit = defineEmits<{ change: [map: MapDocument] }>();

const host = ref<HTMLDivElement>();
// Not reactive: Vue doesn't need to track the editor's insides.
let editor: Mapper | undefined;

onMounted(() => {
  editor = createMapper(host.value!, {
    document: props.map,
    theme: props.theme,
    registry: props.registry,
    onChange: (map) => emit("change", map),
  });
});

watch(
  () => props.theme,
  (theme) => editor?.setTheme(theme),
);

onBeforeUnmount(() => editor?.destroy());

defineExpose({ setDocument: (map: MapDocument) => editor?.setDocument(map) });
</script>

<template>
  <div ref="host" :style="{ height }" />
</template>
```

## Using it

```vue title="App.vue"
<script setup lang="ts">
import { computed, ref } from "vue";
import { createTransform, type MapDocument } from "@crosswalkjs/core";
import MapEditor from "./MapEditor.vue";
import startingMap from "./order.map.json";
import sampleOrder from "./sample-order.json";

const initialMap = startingMap as MapDocument;
const map = ref(initialMap);
const output = computed(() => {
  try {
    return createTransform(map.value)(sampleOrder);
  } catch (error) {
    return (error as Error).message;
  }
});
</script>

<template>
  <MapEditor :map="initialMap" @change="map = $event" />
  <pre>{{ JSON.stringify(output, null, 2) }}</pre>
</template>
```

The editor is still given the starting map, not `map` ([why](./overview.md#the-map-belongs-to-the-editor)). To load a different map, call `setDocument` through a template ref, or change the component's `key`.

Keep the editor out of reactive state. A `ref()` or `reactive()` around the object `createMapper` returns would make Vue wrap the editor's internals in proxies for no benefit.

## Nuxt

The component needs no changes for Nuxt ([why](./overview.md#server-rendering)). To leave it out of the server render altogether, name the file `MapEditor.client.vue`, or wrap it in `<ClientOnly>`:

```vue
<ClientOnly>
  <MapEditor :map="map" @change="save" />
  <template #fallback>Loading the editor…</template>
</ClientOnly>
```

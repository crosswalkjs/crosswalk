import { isValueSchema, listFields, type Field, type JsonValue, type MapDocument, type OperatorDefinition, type OperatorRegistry, type PreviewResponse, type Schema } from "@crosswalkjs/core";
import type { Labels } from "./labels.js";
import * as recipes from "./recipes.js";
import type { Slot, Step, StepValue } from "./recipes.js";

/*
 * The editor on a phone. Three columns side by side don't fit a phone, so the
 * map is shown as a list of target fields instead, each saying where its value
 * comes from and what it is for the sample input. A field opens a sheet with
 * how it's made, step by step, each with its value, and there it can be
 * changed. The read-only view shows the same, without the changes.
 */

/** What the phone view needs from the editor it's part of. */
export interface PhoneHost {
  /** The editor's own element, whose theme the sheets take on. */
  root: HTMLElement;
  t: Labels;
  registry: OperatorRegistry;
  readOnly: boolean;
  /** The map being shown. */
  map: () => MapDocument;
  /** Applies an edit, as the canvas does, so it can be undone and the host hears of it. */
  commit: (next: MapDocument) => void;
  undo: () => void;
  /** The sample input, if the host gave one. */
  input: () => JsonValue | undefined;
  /** Runs a map on the sample input, as the live preview does. */
  run: (map: MapDocument, signal: AbortSignal) => Promise<PreviewResponse>;
  operatorText: (definition: OperatorDefinition | undefined, fallback: string) => { label: string; inputs?: readonly string[] };
  glyph: (definition: OperatorDefinition | undefined) => string;
  typeBadge: (schema: Schema, repeating: boolean) => string;
}

export interface PhoneView {
  element: HTMLElement;
  /** Draws the list, and any open sheet, again for the map as it is now. */
  render: () => void;
  destroy: () => void;
}

type Sheet =
  | { kind: "field" }
  | { kind: "menu"; route: number[]; existing: boolean }
  | { kind: "fields"; route: number[] }
  | { kind: "operators"; route: number[]; as: "fresh" | "wrap" | "replace" };

const esc = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** A path's last name, such as `Cost` for `PhoneCalls[].Cost`. */
const nameOf = (path: string) => path.replace(/\[\]/g, "").split(".").pop() ?? path;
/** A record's path as it reads, such as `Customer › Address`. */
const trail = (path: string) => path.replace(/\[\]/g, "").split(".").join(" › ");

export function createPhoneView(host: PhoneHost): PhoneView {
  const { t, registry } = host;
  const element = document.createElement("div");
  element.className = "cw-phone-view";
  const list = document.createElement("div");
  list.className = "cw-phone-list";
  const layer = document.createElement("div");
  layer.className = "cw-phone-layer";
  element.append(list);
  // Sheets and messages go on the page itself, so nothing the host draws over the editor can cover them.
  // They carry the editor's theme with them.
  const float = document.createElement("div");
  float.className = "cw-root cw-phone-float";
  float.append(layer);
  const lift = () => {
    if (!float.isConnected) host.root.ownerDocument.body.append(float);
    float.dataset.cwTheme = host.root.dataset.cwTheme ?? "";
  };

  // The field whose sheet is open, the sheets on top of it, and inputs added but not filled yet.
  let open: string | undefined;
  let stack: Sheet[] = [];
  const extra = new Map<string, number>();
  let values: { output: JsonValue; steps: Map<string, StepValue> } | undefined;
  let valuesFor: string | undefined;
  let running: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // ---- Values ----

  /** Works out every step's value for the sample input, in one run of the map with each step written out too. */
  const refreshValues = () => {
    const input = host.input();
    const key = input === undefined ? undefined : JSON.stringify([host.map(), input]);
    if (key === valuesFor) return;
    valuesFor = key;
    clearTimeout(timer);
    running?.abort();
    if (input === undefined) {
      values = undefined;
      return paint();
    }
    timer = setTimeout(async () => {
      const run = new AbortController();
      running = run;
      let response: PreviewResponse;
      try {
        response = await host.run(recipes.probeMap(host.map(), registry), run.signal);
      } catch {
        if (!run.signal.aborted) (values = undefined), paint();
        return;
      }
      if (run.signal.aborted) return;
      values = "output" in response ? recipes.readProbe(response.output) : undefined;
      paint();
    }, 150);
  };

  const show = (value: StepValue | undefined): string => {
    if (!value) return "";
    if ("value" in value) return value.value === undefined ? `<span class="cw-phone-left-out">${esc(t.leftOut)}</span>` : esc(JSON.stringify(value.value));
    const shown = value.each.slice(0, 8).map((v) => (v === undefined ? "–" : JSON.stringify(v)));
    const more = value.each.length > 8 ? ` ${t.andMore(value.each.length - 8)}` : "";
    return esc(shown.join(", ") + more);
  };
  const valueOfStep = (step: Step | undefined): StepValue | undefined => {
    if (!step) return undefined;
    if (step.kind === "constant") return undefined;
    const input = host.input();
    if (step.kind === "source") return input === undefined ? undefined : recipes.valueAt(input, step.path);
    return values?.steps.get(step.id);
  };

  // ---- The list ----

  const fields = (): Field[] => listFields(host.map().target);
  const isValue = (field: Field) => isValueSchema(field.schema);

  const tile = (operator: string) => {
    const definition = registry.get(operator);
    return `<span class="cw-chip cw-phone-tile cw-cat-${esc(definition?.category ?? "unknown")}">${esc(host.glyph(definition))}</span>`;
  };
  const label = (operator: string) => host.operatorText(registry.get(operator), operator).label;
  const pill = (path: string, hint = true) => {
    const list = recipes.listOf(path);
    return `<span class="cw-phone-pill">${esc(nameOf(path))}${hint && list ? `<span class="cw-phone-in">${esc(t.each(nameOf(list)))}</span>` : ""}</span>`;
  };

  function renderList() {
    const map = host.map();
    const all = fields();
    const valueFields = all.filter(isValue);
    const mapped = valueFields.filter((f) => recipes.recipeOf(map, registry, f.path)).length;
    let html = `<p class="cw-phone-summary">${esc(t.fieldsMapped(mapped, valueFields.length))}</p>`;
    let cards = "";
    const flush = () => {
      if (cards) html += `<div class="cw-phone-cards">${cards}</div>`;
      cards = "";
    };
    for (const field of all) {
      if (isValue(field)) {
        cards += card(map, field);
        continue;
      }
      flush();
      const loop = map.loops?.find((l) => l.target === field.path);
      const whole = map.links.find((l) => "target" in l.to && l.to.target === field.path);
      const note = loop
        ? t.ofEach(nameOf(loop.source))
        : whole && "source" in whole.from
          ? t.copiedWhole(nameOf(whole.from.source))
          : field.repeating
            ? t.notRepeated
            : "";
      html += `<div class="cw-phone-section"><span class="cw-phone-section-name">${esc(trail(field.path))}</span>${note ? `<span class="cw-phone-section-note">${esc(note)}</span>` : ""}</div>`;
    }
    flush();
    list.innerHTML = html;
  }

  function card(map: MapDocument, field: Field): string {
    const step = recipes.recipeOf(map, registry, field.path);
    const head = `<span class="cw-phone-card-head"><span class="cw-phone-field">${esc(field.name)}</span><span class="cw-type">${esc(host.typeBadge(field.schema, field.repeating))}</span></span>`;
    if (!step) {
      const action = host.readOnly ? "" : ` <span class="cw-phone-map-it">${esc(t.mapIt)}</span>`;
      return `<button type="button" class="cw-phone-card cw-phone-unmapped" data-field="${esc(field.path)}">${head}<span class="cw-phone-recipe">${esc(t.notMapped)}${action}</span></button>`;
    }
    let recipe: string;
    if (step.kind === "source") recipe = `${esc(t.copiedFrom)} ${pill(step.path)}`;
    else if (step.kind === "node") {
      const sources = recipes.sourcesOf(step);
      const total = step.scope !== undefined;
      recipe = `${tile(step.operator)}<span class="cw-phone-op">${esc(label(step.operator))}</span>${total ? `<span>${esc(t.ofEach(nameOf(step.scope!)))}</span>` : ""}${sources.length ? `<span>${esc(t.from)}</span>${sources.map((s) => pill(s, !total)).join("")}` : ""}`;
    } else recipe = esc(recipes.formatConstant(step.value));
    const value = values ? recipes.valueAt(values.output, field.path) : undefined;
    return `<button type="button" class="cw-phone-card" data-field="${esc(field.path)}">${head}<span class="cw-phone-recipe">${recipe}</span>${value ? `<span class="cw-phone-value"><span class="cw-phone-eq">= </span>${show(value)}</span>` : ""}</button>`;
  }

  list.addEventListener("click", (event) => {
    const card = (event.target as Element).closest<HTMLElement>(".cw-phone-card");
    if (!card?.dataset.field) return;
    if (host.readOnly && card.classList.contains("cw-phone-unmapped")) return;
    open = card.dataset.field;
    stack = [{ kind: "field" }];
    extra.clear();
    paintSheets();
  });

  // ---- Recipes by route: the inputs taken from the field down to a step ----

  const root = () => (open === undefined ? undefined : recipes.recipeOf(host.map(), registry, open));
  const stepAt = (route: number[]): Step | undefined => route.reduce<Step | undefined>((step, i) => (step?.kind === "node" ? step.inputs[i] : undefined), root());
  const slotAt = (route: number[]): Slot => {
    if (route.length === 0) return { target: open! };
    const parent = stepAt(route.slice(0, -1));
    return { node: parent?.kind === "node" ? parent.id : "", input: route.at(-1)! };
  };
  /** The source lists a step can read fields from: the list of a total it's inside, or of a repeating record the field is in. */
  const listsFor = (route: number[]): Set<string> | "any" => {
    const lists = new Set<string>();
    for (const loop of host.map().loops ?? []) if (open?.startsWith(loop.target)) lists.add(loop.source);
    for (let depth = 0; depth < route.length; depth++) {
      const step = stepAt(route.slice(0, depth));
      if (step?.kind !== "node" || registry.get(step.operator)?.kind !== "aggregate") continue;
      if (!step.scope) return "any";
      lists.add(step.scope);
    }
    return lists;
  };

  // ---- Sheets ----

  function paintSheets() {
    if (open === undefined || stack.length === 0) {
      layer.innerHTML = "";
      layer.hidden = true;
      return;
    }
    // A field that's gone, as after an undo of the schema, closes its sheet.
    if (!fields().some((f) => f.path === open)) return close();
    lift();
    layer.hidden = false;
    const sheet = stack.at(-1)!;
    const html = sheet.kind === "field" ? fieldSheet() : sheet.kind === "menu" ? menuSheet(sheet) : sheet.kind === "fields" ? fieldPicker(sheet) : operatorPicker(sheet);
    const search = layer.querySelector<HTMLInputElement>(".cw-phone-search");
    const query = search?.value ?? "";
    const scrolled = layer.querySelector(".cw-phone-sheet-body")?.scrollTop ?? 0;
    layer.innerHTML = `<div class="cw-phone-scrim"></div><section class="cw-phone-sheet${sheet.kind === "menu" ? " cw-phone-menu" : ""}" role="dialog" aria-modal="true"><div class="cw-phone-grab"></div>${html}</section>`;
    const body = layer.querySelector(".cw-phone-sheet-body");
    if (body && sheet.kind === "field") body.scrollTop = scrolled;
    const next = layer.querySelector<HTMLInputElement>(".cw-phone-search");
    if (next && query) {
      next.value = query;
      filter(next);
    }
  }

  const close = () => {
    open = undefined;
    stack = [];
    extra.clear();
    paintSheets();
  };
  const back = () => {
    stack.pop();
    if (stack.length === 0) return close();
    paintSheets();
  };
  const push = (sheet: Sheet) => {
    stack.push(sheet);
    paintSheets();
  };

  const head = (title: string, sub: string | undefined, action: "done" | "back") =>
    `<div class="cw-phone-sheet-head"><div><h2 class="cw-phone-sheet-title">${esc(title)}</h2>${sub ? `<p class="cw-phone-sheet-sub">${esc(sub)}</p>` : ""}</div><button type="button" class="cw-phone-done" data-act="${action}">${esc(action === "done" ? t.done : t.back)}</button></div>`;

  function fieldSheet(): string {
    const field = fields().find((f) => f.path === open)!;
    const record = open!.includes(".") ? trail(open!.slice(0, open!.lastIndexOf("."))) : undefined;
    const sub = [host.typeBadge(field.schema, field.repeating), record && t.inRecord(record)].filter(Boolean).join(" · ");
    const step = root();
    if (!step) {
      return `${head(field.name, sub, "done")}<div class="cw-phone-sheet-body"><p class="cw-phone-note">${esc(t.whereFrom(field.name))}</p><div class="cw-phone-actions">
        <button type="button" class="cw-phone-action" data-act="root-field"><span class="cw-phone-pill">abc</span><span>${esc(t.copyField)}<span class="cw-phone-hint">${esc(t.copyFieldHint)}</span></span></button>
        <button type="button" class="cw-phone-action" data-act="root-op"><span class="cw-chip cw-phone-tile cw-cat-unknown">ƒ</span><span>${esc(t.useOperator)}<span class="cw-phone-hint">${esc(t.useOperatorHint)}</span></span></button>
      </div></div>`;
    }
    const result = values ? recipes.valueAt(values.output, open!) : undefined;
    const users = recipes.targetsByNode(host.map(), registry);
    return `${head(field.name, sub, "done")}<div class="cw-phone-sheet-body">
      ${result ? `<div class="cw-phone-result"><span class="cw-phone-label">${esc(t.valueForSample)}</span><span class="cw-phone-value">${show(result)}</span></div>` : ""}
      <div class="cw-phone-label">${esc(t.howItsMade)}</div>
      ${stepHtml(step, [], undefined, users)}
      <div class="cw-phone-into"><span>↳ ${esc(t.into)}</span><span class="cw-phone-field">${esc(field.name)}</span></div>
      ${host.readOnly ? "" : `<div class="cw-phone-actions"><button type="button" class="cw-phone-action cw-phone-danger" data-act="unmap">${esc(t.stopMapping(field.name))}</button></div>`}
    </div>`;
  }

  /** One step: an operator with its inputs under it on a rule, a source field, a typed value, or an empty input. */
  function stepHtml(step: Step | undefined, route: number[], slotLabel: string | undefined, users: Map<string, string[]>): string {
    const key = route.join(".");
    const labelHtml = slotLabel ? `<span class="cw-phone-slot-label">${esc(slotLabel)}</span>` : "";
    const more = host.readOnly ? "" : `<button type="button" class="cw-phone-more" data-act="more" data-route="${key}" aria-label="${esc(t.moreForStep)}">⋯</button>`;
    const value = (v: StepValue | undefined) => (v ? `<span class="cw-phone-step-value">${show(v)}</span>` : "");
    if (!step) {
      return `<div class="cw-phone-slot">${labelHtml}<div class="cw-phone-slot-row">${host.readOnly ? `<span class="cw-phone-left-out">${esc(t.notMapped)}</span>` : `<button type="button" class="cw-phone-choose" data-act="choose" data-route="${key}">${esc(t.choose)}</button>`}</div></div>`;
    }
    if (step.kind === "source") {
      return `<div class="cw-phone-slot">${labelHtml}<div class="cw-phone-slot-row">${host.readOnly ? pill(step.path) : `<button type="button" class="cw-phone-pill" data-act="swap" data-route="${key}">${esc(nameOf(step.path))}${recipes.listOf(step.path) ? `<span class="cw-phone-in">${esc(t.each(nameOf(recipes.listOf(step.path)!)))}</span>` : ""}</button>`}${more}${value(valueOfStep(step))}</div></div>`;
    }
    if (step.kind === "constant") {
      const text = recipes.formatConstant(step.value);
      return `<div class="cw-phone-slot">${labelHtml}<div class="cw-phone-slot-row">${host.readOnly ? `<span class="cw-phone-typed">${esc(text)}</span>` : `<input class="cw-phone-typed" data-route="${key}" value="${esc(text)}" aria-label="${esc(t.typedValue)}">`}${more}</div></div>`;
    }
    const definition = registry.get(step.operator);
    const names = host.operatorText(definition, step.operator).inputs ?? definition?.inputs.labels ?? [];
    const variadic = definition?.inputs.max === undefined;
    const inputs = [...step.inputs, ...Array.from<undefined>({ length: extra.get(step.id) ?? 0 })];
    const nameFor = (i: number) => names[i] ?? (definition?.inputs.max === 1 ? undefined : t.part(i));
    const shared = (users.get(step.id) ?? []).filter((path) => path !== open);
    const children = inputs.map((input, i) => stepHtml(input, [...route, i], nameFor(i), users)).join("");
    const add = variadic && !host.readOnly ? `<button type="button" class="cw-phone-add" data-act="add" data-route="${key}">${esc(t.addInput)}</button>` : "";
    return `<div class="cw-phone-slot">${labelHtml}<div class="cw-phone-op-step">
      <div class="cw-phone-slot-row">${tile(step.operator)}<span class="cw-phone-op-name">${esc(label(step.operator))}${step.scope ? ` <span class="cw-phone-over">${esc(t.ofEach(nameOf(step.scope)))}</span>` : ""}</span>${more}${route.length ? value(valueOfStep(step)) : ""}</div>
      ${shared.length ? `<p class="cw-phone-shared">${esc(t.alsoUsedBy(shared.map(nameOf)))}</p>` : ""}
      ${children || add ? `<div class="cw-phone-inputs">${children}${add}</div>` : ""}
    </div></div>`;
  }

  function menuSheet(sheet: Extract<Sheet, { kind: "menu" }>): string {
    const step = stepAt(sheet.route);
    const isNode = step?.kind === "node";
    const onInput = sheet.route.length > 0;
    return `${head(sheet.existing ? t.changeStep : t.chooseInput, undefined, "back")}<div class="cw-phone-sheet-body"><div class="cw-phone-actions">
      <button type="button" class="cw-phone-action" data-act="pick-field"><span class="cw-phone-pill">abc</span><span>${esc(t.aSourceField)}</span></button>
      <button type="button" class="cw-phone-action" data-act="pick-op"><span class="cw-chip cw-phone-tile cw-cat-unknown">ƒ</span><span>${esc(isNode ? t.aDifferentOperator : t.anOperator)}${isNode ? `<span class="cw-phone-hint">${esc(t.inputsCarryOver)}</span>` : ""}</span></button>
      ${onInput ? `<button type="button" class="cw-phone-action cw-phone-quiet" data-act="typed"><span class="cw-phone-typed-sample">" "</span><span>${esc(t.aTypedValue)}</span></button>` : ""}
      ${sheet.existing ? `<button type="button" class="cw-phone-action cw-phone-quiet" data-act="wrap"><span class="cw-chip cw-phone-tile cw-cat-unknown">+</span><span>${esc(t.wrapStep)}<span class="cw-phone-hint">${esc(t.wrapStepHint)}</span></span></button>` : ""}
      ${sheet.existing && onInput ? `<button type="button" class="cw-phone-action cw-phone-danger" data-act="take-out">${esc(t.takeOut)}</button>` : ""}
    </div></div>`;
  }

  function fieldPicker(sheet: Extract<Sheet, { kind: "fields" }>): string {
    const map = host.map();
    const lists = listsFor(sheet.route);
    const input = host.input();
    const title = map.source.title ?? "the source";
    let rows = "";
    const sourceFields = listFields(map.source);
    for (const field of sourceFields) {
      const list = recipes.listOf(field.path);
      const inList = list !== undefined;
      if (!isValueSchema(field.schema)) {
        // A record, or a list of records, is a heading for the fields in it.
        const count = field.repeating && input !== undefined ? recipes.valueAt(input, field.path) : undefined;
        rows += `<div class="cw-phone-pick-title" data-group="${esc(field.path)}">${esc(field.repeating ? t.listOf(trail(field.path), count && "each" in count ? count.each.length : undefined) : trail(field.path))}</div>`;
        continue;
      }
      const allowed = !inList || lists === "any" || [...lists].some((l) => list!.startsWith(l));
      const sample = input === undefined ? "" : show(recipes.valueAt(input, field.path));
      rows += `<button type="button" class="cw-phone-pick${field.depth > 0 ? " cw-phone-child" : ""}" data-path="${esc(field.path)}" data-name="${esc(field.name.toLowerCase())}"${allowed ? "" : " disabled"}><span class="cw-phone-pick-name">${esc(field.name)}</span><span class="cw-phone-sample">${sample}</span></button>`;
    }
    const needsTotal = lists !== "any" && lists.size === 0 && sourceFields.some((f) => recipes.listOf(f.path) !== undefined && f.path !== recipes.listOf(f.path));
    return `${head(t.chooseSourceField, t.chooseSourceFieldHint(title), "back")}<div class="cw-phone-sheet-body">
      <input class="cw-phone-search" type="search" placeholder="${esc(t.findField("source"))}" aria-label="${esc(t.findField("source"))}">
      <div class="cw-phone-picks">${rows}</div><p class="cw-phone-none" hidden></p>
      ${needsTotal ? `<p class="cw-phone-note">${esc(t.listNeedsTotal)}</p>` : ""}
    </div>`;
  }

  function operatorPicker(sheet: Extract<Sheet, { kind: "operators" }>): string {
    let rows = "";
    const operators = registry.list();
    const groups = [...registry.categories(), ...(operators.some((o) => !registry.getCategory(o.category)) ? [{ id: "", label: "" }] : [])];
    for (const category of groups) {
      const inside = operators.filter((o) => (category.id ? o.category === category.id : !registry.getCategory(o.category)));
      if (inside.length === 0) continue;
      if (category.id) rows += `<div class="cw-phone-pick-title">${esc(t.category(category))}</div>`;
      for (const operator of inside) {
        const name = host.operatorText(operator, operator.id).label;
        rows += `<button type="button" class="cw-phone-pick" data-op="${esc(operator.id)}" data-name="${esc(name.toLowerCase())}">${tile(operator.id)}<span class="cw-phone-pick-name">${esc(name)}</span></button>`;
      }
    }
    return `${head(sheet.as === "wrap" ? t.wrapStep : t.chooseOperator, undefined, "back")}<div class="cw-phone-sheet-body">
      <input class="cw-phone-search" type="search" placeholder="${esc(t.findOperator)}" aria-label="${esc(t.findOperator)}">
      <div class="cw-phone-picks">${rows}</div><p class="cw-phone-none" hidden></p>
    </div>`;
  }

  /** Narrows a picker to what matches, keeping the headings of what's left. */
  function filter(search: HTMLInputElement) {
    const query = search.value.trim().toLowerCase();
    const picks = [...layer.querySelectorAll<HTMLElement>(".cw-phone-pick")];
    for (const pick of picks) pick.hidden = query !== "" && !(pick.dataset.name ?? "").includes(query);
    for (const title of layer.querySelectorAll<HTMLElement>(".cw-phone-pick-title")) {
      let next = title.nextElementSibling;
      let any = false;
      while (next && !next.classList.contains("cw-phone-pick-title")) {
        if (next.classList.contains("cw-phone-pick") && !(next as HTMLElement).hidden) any = true;
        next = next.nextElementSibling;
      }
      title.hidden = query !== "" && !any;
    }
    const none = layer.querySelector<HTMLElement>(".cw-phone-none");
    if (none) {
      none.hidden = query === "" || picks.some((p) => !p.hidden);
      none.textContent = t.noMatch(search.value.trim());
    }
  }

  // ---- Changes ----

  const apply = (next: MapDocument | undefined, after: Sheet[] = [{ kind: "field" }]) => {
    if (!next) return toast(t.cantDoThat);
    extra.clear();
    stack = after;
    host.commit(next);
  };
  const routeOf = (el: HTMLElement | null) => (el?.dataset.route ? el.dataset.route.split(".").map(Number) : []);

  layer.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target.classList.contains("cw-phone-scrim")) return stack.length > 1 ? back() : close();
    const button = target.closest<HTMLElement>("[data-act], .cw-phone-pick");
    if (!button) return;
    const sheet = stack.at(-1)!;
    const map = host.map();
    const act = button.dataset.act;
    if (act === "done") return close();
    if (act === "back") return back();
    if (act === "root-field") return push({ kind: "fields", route: [] });
    if (act === "root-op") return push({ kind: "operators", route: [], as: "fresh" });
    if (act === "unmap") {
      const name = nameOf(open!);
      apply(recipes.unmap(map, registry, open!), []);
      open = undefined;
      paintSheets();
      return toast(t.stoppedMapping(name), () => host.undo());
    }
    if (act === "swap") return push({ kind: "fields", route: routeOf(button) });
    if (act === "more" || act === "choose") return push({ kind: "menu", route: routeOf(button), existing: act === "more" });
    if (act === "add") {
      const step = stepAt(routeOf(button));
      if (step?.kind === "node") extra.set(step.id, (extra.get(step.id) ?? 0) + 1);
      return paintSheets();
    }
    if (sheet.kind === "menu") {
      const step = stepAt(sheet.route);
      if (act === "pick-field") return (stack[stack.length - 1] = { kind: "fields", route: sheet.route }), paintSheets();
      if (act === "pick-op") return (stack[stack.length - 1] = { kind: "operators", route: sheet.route, as: step?.kind === "node" ? "replace" : "fresh" }), paintSheets();
      if (act === "wrap") return (stack[stack.length - 1] = { kind: "operators", route: sheet.route, as: "wrap" }), paintSheets();
      const slot = slotAt(sheet.route);
      if (act === "typed" && "node" in slot) return apply(recipes.type(map, registry, slot, ""));
      if (act === "take-out") return apply(recipes.clear(map, registry, slot));
      return;
    }
    if (button.classList.contains("cw-phone-pick") && !(button as HTMLButtonElement).disabled) {
      if (sheet.kind === "fields" && button.dataset.path) return apply(recipes.fill(map, registry, slotAt(sheet.route), { source: button.dataset.path }));
      if (sheet.kind === "operators" && button.dataset.op) return apply(recipes.place(map, registry, slotAt(sheet.route), button.dataset.op, sheet.as));
    }
  });
  layer.addEventListener("input", (event) => {
    const search = (event.target as Element).closest<HTMLInputElement>(".cw-phone-search");
    if (search) filter(search);
  });
  // A typed value is kept when it's finished with, not at every keystroke, so one undo takes it back.
  layer.addEventListener("change", (event) => {
    const box = (event.target as Element).closest<HTMLInputElement>("input.cw-phone-typed");
    if (!box) return;
    const slot = slotAt(routeOf(box));
    if ("node" in slot) apply(recipes.type(host.map(), registry, slot, recipes.parseConstant(box.value)));
  });
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open !== undefined) {
      event.stopPropagation();
      if (stack.length > 1) back();
      else close();
    }
  };
  float.addEventListener("keydown", onKey);

  // ---- A message at the bottom, with an undo where there's something to undo ----

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function toast(message: string, undo?: () => void) {
    lift();
    float.querySelector(".cw-phone-toast")?.remove();
    const note = document.createElement("div");
    note.className = "cw-phone-toast";
    note.setAttribute("role", "status");
    note.innerHTML = `<span>${esc(message)}</span>${undo ? `<button type="button">${esc(t.undo)}</button>` : ""}`;
    note.querySelector("button")?.addEventListener("click", () => {
      undo?.();
      note.remove();
    });
    float.append(note);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => note.remove(), 5000);
  }

  function paint() {
    renderList();
    paintSheets();
  }

  return {
    element,
    render: () => {
      paint();
      refreshValues();
    },
    destroy: () => {
      running?.abort();
      clearTimeout(timer);
      clearTimeout(toastTimer);
      float.remove();
    },
  };
}

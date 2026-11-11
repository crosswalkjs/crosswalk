import { expect, test, type Locator, type Page } from "@playwright/test";

// The editor in a real browser, driven by the pointer and keyboard as a person would.
// The fixture page exposes the editor as `window.editor`, so a test can read the map back.

const documentOf = (page: Page) => page.evaluate(() => window.editor.getDocument());

const source = (page: Page, path: string) => page.locator(`.cw-source .cw-row[data-path="${path}"]`);
const target = (page: Page, path: string) => page.locator(`.cw-target .cw-row[data-path="${path}"]`);
const node = (page: Page, id: string) => page.locator(`.cw-node[data-id="${id}"]`);
const inspector = (page: Page) => page.locator(".cw-inspector");
const tab = (page: Page, name: string) => page.locator(".cw-page-tab", { hasText: name });

async function centre(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Presses on `from`, moves in steps to `to`, and lets go. */
async function drag(page: Page, from: Locator | { x: number; y: number }, to: Locator | { x: number; y: number }) {
  const a = "boundingBox" in from ? await centre(from) : from;
  const b = "boundingBox" in to ? await centre(to) : to;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
}

/** The nearest point to `near` that's bare grid, with no operator or line under it, for a box to start from. */
async function bareGrid(page: Page, near: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    for (let r = 0; r < 120; r += 4) {
      for (const [dx, dy] of [[-r, -r], [-r, 0], [0, -r], [r, -r], [-r, r]]) {
        const element = document.elementFromPoint(x + dx!, y + dy!);
        if (element?.matches(".cw-viewport, .cw-surface, .cw-surface-size")) return { x: x + dx!, y: y + dy! };
      }
    }
    throw new Error("No bare grid near the point");
  }, near);
}

const undo = (page: Page) => page.keyboard.press("ControlOrMeta+z");

test.describe("look", () => {
  test("uses the ink theme when none is given: highlighter tiles stamped in ink", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".cw-root")).toHaveAttribute("data-cw-theme", "ink");
    const tile = page.locator(".cw-node").first();
    expect(await tile.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(255, 224, 102)");
    expect(await tile.evaluate((e) => getComputedStyle(e).boxShadow)).toContain("2px 2px 0px");
  });
});

test.describe("mapping", () => {
  test("drags a source field onto a target field to link them, and undoes it", async ({ page }) => {
    await page.goto("/?map=blank");
    await drag(page, source(page, "FirstName"), target(page, "FullName"));
    expect((await documentOf(page)).links).toEqual([{ from: { source: "FirstName" }, to: { target: "FullName" } }]);
    await expect(target(page, "FullName")).toHaveClass(/cw-linked/);

    await undo(page);
    expect((await documentOf(page)).links).toEqual([]);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect((await documentOf(page)).links).toHaveLength(1);
  });

  test("adds an operator from the toolbox, feeds it, and sends it to a target field", async ({ page }) => {
    await page.goto("/?map=blank");
    await drag(page, page.locator('.cw-toolbox .cw-chip[data-operator="text.concat"]'), page.locator(".cw-viewport"));
    const [added] = (await documentOf(page)).nodes;
    expect(added?.operator).toBe("text.concat");

    await drag(page, source(page, "FirstName"), node(page, added!.id));
    await drag(page, source(page, "LastName"), node(page, added!.id));
    await drag(page, page.locator(`[data-out="${added!.id}"]`), target(page, "FullName"));
    expect((await documentOf(page)).links).toEqual([
      { from: { source: "FirstName" }, to: { node: added!.id, input: 0 } },
      { from: { source: "LastName" }, to: { node: added!.id, input: 1 } },
      { from: { node: added!.id }, to: { target: "FullName" } },
    ]);
  });

  test("opens an operator's inspector on a click, but not when it's dragged", async ({ page }) => {
    await page.goto("/");
    const before = (await documentOf(page)).nodes.find((n) => n.id === "fullName")!.position!;
    const at = await centre(node(page, "fullName"));
    await drag(page, node(page, "fullName"), { x: at.x + 60, y: at.y + 40 });
    await expect(inspector(page)).not.toHaveClass(/cw-open/);
    const after = (await documentOf(page)).nodes.find((n) => n.id === "fullName")!.position!;
    expect(after.x).toBeGreaterThan(before.x + 40);

    await node(page, "fullName").click();
    await expect(inspector(page)).toHaveClass(/cw-open/);
    await expect(inspector(page)).toContainText("Concatenate");
  });

  test("holds the highlight still while an operator is dragged across rows", async ({ page }) => {
    await page.goto("/");
    const lines = page.locator(".cw-links");
    const at = await centre(node(page, "fullName"));
    await page.mouse.move(at.x, at.y);
    await expect(lines).toHaveClass(/cw-focus/);
    await page.mouse.down();
    // Across a source row and empty grid, and the operator's lines stay picked out.
    for (const point of [await centre(source(page, "Address")), { x: at.x + 30, y: at.y + 200 }]) {
      await page.mouse.move(point.x, point.y, { steps: 6 });
      await expect(lines).toHaveClass(/cw-focus/);
    }
    await page.mouse.up();
  });
});

test.describe("selecting", () => {
  test("draws a box round operators to select them, without opening the inspector, and deletes them", async ({ page }) => {
    await page.goto("/");
    const a = await centre(node(page, "prefix"));
    const b = await centre(node(page, "isNational"));
    const start = await bareGrid(page, { x: Math.min(a.x, b.x) - 30, y: Math.min(a.y, b.y) - 30 });
    await drag(page, start, { x: Math.max(a.x, b.x) + 30, y: Math.max(a.y, b.y) + 30 });
    await expect(node(page, "prefix")).toHaveClass(/cw-selected/);
    await expect(node(page, "isNational")).toHaveClass(/cw-selected/);
    await expect(inspector(page)).not.toHaveClass(/cw-open/);

    await page.keyboard.press("Delete");
    const ids = (await documentOf(page)).nodes.map((n) => n.id);
    expect(ids).not.toContain("prefix");
    expect(ids).not.toContain("isNational");
  });

  test("picks out a plain line without opening the inspector, and deletes it", async ({ page }) => {
    await page.goto("/");
    const before = (await documentOf(page)).links.length;
    const index = (await documentOf(page)).links.findIndex((l) => "node" in l.from && "target" in l.to);
    await page.locator(`.cw-hit[data-hit="link:${index}"]`).dispatchEvent("pointerdown", { button: 0, isPrimary: true });
    await page.mouse.up();
    await expect(page.locator(".cw-line.cw-selected")).toHaveCount(1);
    await expect(inspector(page)).not.toHaveClass(/cw-open/);
    await page.keyboard.press("Delete");
    expect((await documentOf(page)).links).toHaveLength(before - 1);
  });

  test("copies and pastes operators with new ids", async ({ page }) => {
    await page.goto("/");
    await node(page, "fullName").click();
    await page.keyboard.press("Escape");
    await node(page, "fullName").click({ modifiers: ["Shift"] });
    await page.keyboard.press("ControlOrMeta+c");
    await page.keyboard.press("ControlOrMeta+v");
    const nodes = (await documentOf(page)).nodes;
    expect(nodes.filter((n) => n.operator === "text.concat")).toHaveLength(2);
  });
});

test.describe("finding a field", () => {
  test("narrows a tree to the fields that match, with the records they're in, and Escape brings the rest back", async ({ page }) => {
    await page.goto("/?map=order");
    const rows = page.locator(".cw-source .cw-row:visible");
    const all = await rows.count();
    await page.getByRole("button", { name: "Find a source field" }).click();
    await page.keyboard.type("post");
    await expect(rows).toHaveText([/Billing/, /Postcode/, /Shipping/, /Postcode/]);
    await expect(page.locator(".cw-source .cw-match").first()).toHaveText("Post");
    // Status is left out, so the line from it to the look-up isn't drawn.
    const fromStatus = (await documentOf(page)).links.findIndex((l) => "source" in l.from && l.from.source === "Status");
    await expect(page.locator(`.cw-hit[data-hit="link:${fromStatus}"]`)).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(rows).toHaveCount(all);
    await expect(page.locator(`.cw-hit[data-hit="link:${fromStatus}"]`)).toHaveCount(1);
  });

  test("narrows everything to the paths from the fields found, laid out together", async ({ page }) => {
    await page.goto("/?map=erp&orders=8");
    const lines = page.locator(".cw-line");
    const all = await lines.count();
    await page.getByRole("button", { name: "Find a source field" }).click();
    await page.keyboard.type("ordernumber");
    // Order number feeds the external reference, and the customer PO when there's none; nothing else.
    await expect.poll(() => lines.count()).toBeLessThan(all / 4);
    await expect(page.locator('.cw-node[data-id="lookup1_1"]')).toBeHidden();
    await expect(target(page, "SalesOrder1.Header.Currency")).toBeHidden();
    // What's left sits together beside the trees, with no scrolling: the last order's too.
    for (const id of ["upper1_1", "firstOf1_1"]) await expect(page.locator(`.cw-node[data-id="${id}"]`)).toBeInViewport();
    await expect(target(page, "SalesOrder1.Header.ExternalReference")).toBeVisible();
    await expect(target(page, "SalesOrder1.Header.CustomerPO")).toBeInViewport();
    // Further down the narrowed tree, but there.
    await expect(target(page, "SalesOrder8.Header.CustomerPO")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect.poll(() => lines.count()).toBe(all);
    await expect(page.locator('.cw-node[data-id="lookup1_1"]')).toBeVisible();
    await expect(target(page, "SalesOrder1.Header.Currency")).toBeVisible();
  });

  test("finds fields inside a folded record, and says when nothing matches", async ({ page }) => {
    await page.goto("/?map=order");
    await page.locator('.cw-target .cw-row[data-path="BillTo"] .cw-twisty').click();
    await expect(target(page, "BillTo.Town")).toBeHidden();
    await page.getByRole("button", { name: "Find a target field" }).click();
    await page.keyboard.type("town");
    await expect(target(page, "BillTo.Town")).toBeVisible();
    await page.keyboard.type("zzz");
    await expect(page.locator(".cw-target .cw-no-match")).toBeVisible();
  });
});

test.describe("pages", () => {
  test("drops an operator on + to make a page, renames it, and moves between pages", async ({ page }) => {
    await page.goto("/");
    await drag(page, node(page, "age"), page.locator(".cw-page-add"));
    let map = await documentOf(page);
    expect(map.pages).toEqual([{ id: "page1", name: "Page 1" }, { id: "page2", name: "Page 2" }]);
    expect(map.nodes.find((n) => n.id === "age")?.page).toBe("page2");
    await expect(node(page, "age")).toBeVisible();
    await expect(node(page, "fullName")).toHaveCount(0);

    await tab(page, "Page 2").dblclick();
    await expect(page.locator(".cw-page-name")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Dates");
    await page.keyboard.press("Enter");
    map = await documentOf(page);
    expect(map.pages?.[1]?.name).toBe("Dates");

    await tab(page, "Page 1").click();
    await expect(node(page, "fullName")).toBeVisible();
    await expect(node(page, "age")).toHaveCount(0);
  });

  test("shows a line to an operator on another page as a stub that goes there", async ({ page }) => {
    await page.goto("/");
    await drag(page, node(page, "isNational"), page.locator(".cw-page-add"));
    // prefix, still on page 2's neighbour, feeds isNational.
    await tab(page, "Page 1").click();
    const stub = page.locator(".cw-page-stub", { hasText: "to Page 2" });
    await expect(stub.first()).toBeVisible();
    await stub.first().dispatchEvent("pointerdown", { button: 0, isPrimary: true });
    await expect(tab(page, "Page 2")).toHaveAttribute("aria-selected", "true");
  });

  test("drags a record link's label onto a tab, and only that page shows it", async ({ page }) => {
    await page.goto("/?map=order");
    await expect(page.locator(".cw-pill")).toHaveCount(2);
    await drag(page, page.locator(".cw-pill").first(), page.locator(".cw-page-add"));
    await expect(tab(page, "Page 2")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".cw-pill")).toHaveCount(1);
    await tab(page, "Page 1").click();
    await expect(page.locator(".cw-pill")).toHaveCount(1);
  });
});

test.describe("a big map split into pages", () => {
  /** True when the row is inside its tree's visible area. */
  const inView = (row: Locator) =>
    row.evaluate((element) => {
      const pane = element.closest(".cw-tree")!.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return box.top >= pane.top && box.bottom <= pane.bottom;
    });

  test("opening a page scrolls the trees to its fields, and fades the ones it doesn't use", async ({ page }) => {
    await page.goto("/?map=erp");
    await tab(page, "Items").click();
    expect(await inView(source(page, "Lines[]"))).toBe(true);
    expect(await inView(target(page, "Items[]"))).toBe(true);
    await expect(target(page, "Header.Currency")).toHaveClass(/cw-elsewhere/);
    await expect(target(page, "Items[].Material")).not.toHaveClass(/cw-elsewhere/);

    await tab(page, "Header").click();
    expect(await inView(target(page, "Header.DocumentType"))).toBe(true);
    await expect(target(page, "Header.Currency")).not.toHaveClass(/cw-elsewhere/);
  });

  test("lists every page when the tabs don't fit, and keeps the open tab in view", async ({ page }) => {
    await page.goto("/?map=erp");
    const list = page.locator(".cw-page-menu");
    // Seven tabs don't fit beside the zoom in this editor, but do in a very wide one.
    await expect(list).toBeVisible();
    await page.evaluate(() => (document.getElementById("editor")!.style.width = "2400px"));
    await expect(list).toBeHidden();
    await page.evaluate(() => (document.getElementById("editor")!.style.width = "760px"));
    await expect(list).toBeVisible();
    await page.locator(".cw-page-list").selectOption({ label: "Audit" });
    await expect(tab(page, "Audit")).toHaveAttribute("aria-selected", "true");
    const bar = (await page.locator(".cw-pages").boundingBox())!;
    const open = (await tab(page, "Audit").boundingBox())!;
    expect(open.x).toBeGreaterThanOrEqual(bar.x);
    expect(open.x + open.width).toBeLessThanOrEqual(bar.x + bar.width);
  });

  test("scrolling the grid brings the trees round to the fields of the operators in view", async ({ page }) => {
    await page.goto("/?map=erp&orders=4");
    await expect(source(page, "Order1.OrderNumber")).toBeVisible();
    // Down to the second order's operators on the Header page.
    await page.locator(".cw-viewport").evaluate((viewport) => {
      const node = viewport.querySelector<HTMLElement>('.cw-node[data-id="upper1_2"]')!;
      viewport.scrollTop = node.offsetTop - 20;
    });
    await expect.poll(() => inView(source(page, "Order2.OrderNumber"))).toBe(true);
    await expect.poll(() => inView(target(page, "SalesOrder2.Header.ExternalReference"))).toBe(true);
  });

  test("draws a line to a field scrolled out of view faded, to the tree's edge", async ({ page }) => {
    await page.goto("/?map=erp");
    await tab(page, "Items").click();
    const faded = page.locator(".cw-line.cw-offscreen");
    // Some of the page's target fields are below the fold already; scrolling its source fields away adds more.
    const before = await faded.count();
    await page.locator(".cw-source").evaluate((tree) => (tree.scrollTop = 0));
    await expect.poll(() => faded.count()).toBeGreaterThan(before + 5);
    // Drawn in full, so it never looks half-finished.
    expect(await faded.first().evaluate((line) => (line as SVGPathElement).style.strokeDasharray)).toBe("");
  });
});

test.describe("tracing a field", () => {
  const count = (page: Page, name: string) => tab(page, name).locator(".cw-page-count");

  test("clicking a target field picks out everything its value is made from, and Escape lets go", async ({ page }) => {
    await page.goto("/?map=erp");
    await tab(page, "Pricing").click();
    await target(page, "Pricing.Balanced").click();
    await expect(target(page, "Pricing.Balanced")).toHaveClass(/cw-traced/);
    await expect(page.locator(".cw-node.cw-related")).toHaveCount(8);
    await expect(source(page, "Totals.Grand")).toHaveClass(/cw-related/);
    await expect(count(page, "Pricing")).toHaveText("8");
    await expect(page.locator(".cw-links")).toHaveClass(/cw-focus/);

    await page.keyboard.press("Escape");
    await expect(page.locator(".cw-row.cw-traced")).toHaveCount(0);
    await expect(page.locator(".cw-page-count")).toHaveCount(0);
  });

  test("clicking a source field follows it onto every page it's used on", async ({ page }) => {
    await page.goto("/?map=erp");
    await tab(page, "Items").click();
    await source(page, "Lines[].UnitPrice").click();
    await expect(source(page, "Lines[].UnitPrice")).toHaveClass(/cw-traced/);
    await expect(count(page, "Items")).toBeVisible();
    await expect(count(page, "Pricing")).toBeVisible();
    await expect(count(page, "Header")).toHaveCount(0);

    // The trace carries on to the next page.
    await tab(page, "Pricing").click();
    await expect(page.locator(".cw-node.cw-related").first()).toBeVisible();
    await expect(target(page, "Pricing.AveragePrice")).toHaveClass(/cw-related/);

    // Clicking it again lets go.
    await source(page, "Lines[].UnitPrice").click();
    await expect(page.locator(".cw-row.cw-traced")).toHaveCount(0);
  });
});

test.describe("sub-maps", () => {
  test("double-clicking a record link's label opens its sub-map, even where the inspector covers it", async ({ page }) => {
    // Narrow, so the inspector opens on top of the label.
    await page.setViewportSize({ width: 820, height: 800 });
    await page.goto("/?map=order");
    await page.evaluate(() => (document.getElementById("editor")!.style.width = "800px"));
    await page.locator(".cw-pill").first().dblclick();
    await expect(page.locator(".cw-bar select")).toHaveValue("Address");
  });

  test("a single click on the label opens the record link's settings", async ({ page }) => {
    await page.goto("/?map=order");
    await page.locator(".cw-pill").first().click();
    await expect(inspector(page)).toHaveClass(/cw-open/);
    await expect(inspector(page)).toContainText("Record link");
  });
});

test.describe("in the host's words", () => {
  test("uses the labels it's given, and English for the rest", async ({ page }) => {
    await page.goto("/?labels=fr");
    await expect(page.locator(".cw-toolbox-title")).toHaveText("Opérateurs");
    await expect(page.locator(".cw-toolbox-search")).toHaveAttribute("placeholder", "Chercher un opérateur");
    await node(page, "fullName").click();
    await expect(inspector(page).locator("h3")).toContainText("Concaténer");
    await expect(inspector(page)).toContainText("Met des textes bout à bout.");
    await expect(inspector(page)).toContainText("Entrée 1");
    await expect(inspector(page).getByRole("button", { name: "Supprimer l'opérateur" })).toBeVisible();
    // Left out, so still in English.
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
  });

  test("words issues its own way", async ({ page }) => {
    await page.goto("/?map=blank&labels=fr");
    await drag(page, page.locator('.cw-toolbox .cw-chip[data-operator="text.concat"]'), page.locator(".cw-viewport"));
    await page.locator(".cw-node").first().click();
    await expect(inspector(page)).toContainText("Il manque une entrée.");
  });
});

test.describe("events", () => {
  const events = (page: Page, kind: string) => page.evaluate((kind) => window.events.filter(([k]) => k === kind).map(([, v]) => v), kind);

  test("tells the host what's selected, and when nothing is", async ({ page }) => {
    await page.goto("/");
    await node(page, "fullName").click();
    expect(await page.evaluate(() => window.editor.getSelection())).toEqual({ kind: "operator", id: "fullName" });
    await page.keyboard.press("Escape");
    // Nothing on load, then the operator, then nothing again.
    await expect.poll(() => events(page, "selection")).toEqual([{ kind: "operator", id: "fullName" }, undefined]);
    expect(await page.evaluate(() => window.editor.getSelection())).toBeUndefined();
  });

  test("tells the host the page shown, and the issues, when they change", async ({ page }) => {
    await page.goto("/?map=erp");
    expect(await events(page, "page")).toEqual([{ page: "header" }]);
    expect(await events(page, "issues")).toHaveLength(1);
    await tab(page, "Items").click();
    await expect.poll(() => events(page, "page")).toEqual([{ page: "header" }, { page: "items" }]);

    // Taking away the first input of an operator that has two leaves a gap, which is an error.
    await page.evaluate(() => {
      const map = window.editor.getDocument();
      map.links = map.links.filter((l) => !("node" in l.to && l.to.node === "firstOf1" && l.to.input === 0));
      window.editor.setDocument(map);
    });
    await expect.poll(() => events(page, "issues")).toHaveLength(2);
    expect((await events(page, "issues"))[1]).toBeGreaterThan((await events(page, "issues"))[0] as number);
  });
});

test.describe("replacing a schema", () => {
  test("makes one from a sample, as an edit undo takes back", async ({ page }) => {
    await page.goto("/?map=blank&editSchemas");
    await page.getByRole("button", { name: "Replace the source schema" }).click();
    await page.getByRole("textbox", { name: "Paste an example of the data, as JSON" }).fill('{ "Name": "Ana", "Orders": [{ "Total": 12.5 }] }');
    await page.getByRole("button", { name: "Use it" }).click();
    await expect(page.locator(".cw-source .cw-row")).toHaveText([/Name/, /Orders/, /Total/]);
    expect((await documentOf(page)).source.properties!.Orders!.items!.properties!.Total!.type).toBe("number");

    await undo(page);
    await expect(source(page, "FirstName")).toBeVisible();
  });

  test("picks one of the schemas an OpenAPI document describes", async ({ page }) => {
    await page.goto("/?map=blank&editSchemas");
    await page.getByRole("button", { name: "Replace the target schema" }).click();
    await page.getByRole("radio", { name: "OpenAPI" }).click();
    const api = {
      openapi: "3.1.0",
      paths: {},
      components: { schemas: { Customer: { type: "object", properties: { name: { type: "string" }, tier: { oneOf: [{ type: "string" }, { type: "null" }] } } } } },
    };
    await page.getByRole("textbox", { name: "Paste an OpenAPI document, as JSON" }).fill(JSON.stringify(api));
    await expect(page.getByRole("combobox", { name: "Which schema" })).toHaveValue("Customer");
    await page.getByRole("button", { name: "Use it" }).click();
    await expect(page.locator(".cw-target .cw-row")).toHaveText([/name/, /tier/]);
  });

  test("makes one from an XML sample, or picks an element an XSD declares", async ({ page }) => {
    await page.goto("/?map=blank&editSchemas");
    await page.getByRole("button", { name: "Replace the source schema" }).click();
    await page.getByRole("radio", { name: "An XML sample" }).click();
    await page.getByRole("textbox", { name: "Paste an example of the data, as XML" }).fill('<Order number="1"><Line><Sku>A</Sku></Line><Line><Sku>B</Sku></Line></Order>');
    await page.getByRole("button", { name: "Use it" }).click();
    await expect(page.locator(".cw-source .cw-row")).toHaveText([/number/, /Line/, /Sku/]);
    expect((await documentOf(page)).source.xml).toEqual({ name: "Order" });

    await page.getByRole("button", { name: "Replace the target schema" }).click();
    await page.getByRole("radio", { name: "XSD" }).click();
    const xsd = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:element name="Note" type="xs:string"/>
      <xs:element name="Invoice"><xs:complexType><xs:sequence><xs:element name="Total" type="xs:decimal"/></xs:sequence><xs:attribute name="ref" type="xs:string"/></xs:complexType></xs:element>
    </xs:schema>`;
    await page.getByRole("textbox", { name: "Paste an XSD" }).fill(xsd);
    await page.getByRole("combobox", { name: "Which schema" }).selectOption("Invoice");
    await page.getByRole("button", { name: "Use it" }).click();
    await expect(page.locator(".cw-target .cw-row")).toHaveText([/Total/, /ref/]);
  });

  test("makes one from a CSV sample, with a column for each heading", async ({ page }) => {
    await page.goto("/?map=blank&editSchemas");
    await page.getByRole("button", { name: "Replace the source schema" }).click();
    await page.getByRole("radio", { name: "A CSV sample" }).click();
    await page.getByRole("textbox", { name: "Paste a few lines of the CSV file, with its header" }).fill("sku;qty;postcode\nTEA;2;01234\nMUG;1;99999");
    await page.getByRole("button", { name: "Use it" }).click();
    await expect(page.locator(".cw-source .cw-row")).toHaveText([/rows/, /sku/, /qty/, /postcode/]);
    const rows = (await documentOf(page)).source.properties!.rows!.items!.properties!;
    expect([rows.qty!.type, rows.postcode!.type]).toEqual(["integer", "string"]);
  });

  test("says when what's pasted can't be a map's source", async ({ page }) => {
    await page.goto("/?map=blank&editSchemas");
    await page.getByRole("button", { name: "Replace the source schema" }).click();
    const box = page.getByRole("textbox", { name: "Paste an example of the data, as JSON" });
    await box.fill("[1, 2]");
    await page.getByRole("button", { name: "Use it" }).click();
    await expect(page.locator(".cw-schema-problem")).toContainText("the top level needs to be an object");
    await box.fill("{ not json");
    await page.getByRole("button", { name: "Use it" }).click();
    await expect(page.locator(".cw-schema-problem")).toContainText("That isn't JSON");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(source(page, "FirstName")).toBeVisible();
  });

  test("isn't offered unless the host turns it on", async ({ page }) => {
    await page.goto("/?map=blank");
    await expect(page.getByRole("button", { name: "Replace the source schema" })).toHaveCount(0);
  });
});

test.describe("read-only", () => {
  test("shows the map without a toolbox, and dragging moves nothing", async ({ page }) => {
    await page.goto("/?readOnly");
    await expect(page.locator(".cw-toolbox")).toHaveCount(0);
    const before = await documentOf(page);
    const at = await centre(node(page, "fullName"));
    await drag(page, node(page, "fullName"), { x: at.x + 80, y: at.y + 80 });
    expect(await documentOf(page)).toEqual(before);
    expect(await page.evaluate(() => window.changes.length)).toBe(0);
  });
});

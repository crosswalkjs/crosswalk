import { expect, test, type Page } from "@playwright/test";

// How the editor copes with a big map. The first test runs in CI with generous limits, to catch
// a redraw that's grown much slower, or quadratic. PERF_SWEEP=1 also runs the sweep, which
// prints frame and redraw times for maps of 100 to 2,000 operators (THROTTLE=4 slows the CPU down).

/** Times every animation-frame callback, which is where the editor redraws its lines. */
async function timeCallbacks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { costs: number[] };
    w.costs = [];
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      raf((t) => {
        const start = performance.now();
        callback(t);
        w.costs.push(performance.now() - start);
      });
  });
}

async function costs(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { costs: number[] };
    // The recorder's own callbacks cost nothing; leave them out.
    const real = w.costs.filter((c) => c > 0.05).sort((a, b) => a - b);
    w.costs = [];
    const pick = (q: number) => Math.round((real[Math.min(real.length - 1, Math.floor(real.length * q))] ?? 0) * 10) / 10;
    return { draws: real.length, median: pick(0.5), p95: pick(0.95), worst: pick(1) };
  });
}

async function recordFrames(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { frames_: number[]; recording: boolean };
    w.frames_ = [];
    w.recording = true;
    const tick = (t: number) => {
      w.frames_.push(t);
      if (w.recording) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopFrames(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { frames_: number[]; recording: boolean };
    w.recording = false;
    const gaps = w.frames_.slice(1).map((t, i) => t - w.frames_[i]!).sort((a, b) => a - b);
    const pick = (q: number) => Math.round(gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))] ?? 0);
    return { frames: gaps.length, median: pick(0.5), p95: pick(0.95), worst: Math.round(gaps.at(-1) ?? 0) };
  });
}

const throttle = Number(process.env.THROTTLE ?? 1);

test("stays quick to drag, hover and zoom with 1,200 operators", async ({ page }) => {
  test.setTimeout(120_000);
  await timeCallbacks(page);
  await page.goto("/?map=big&size=1200");
  await page.waitForFunction(() => window.editor !== undefined);
  await costs(page);

  const box = (await page.locator('.cw-node[data-id="op13"]').boundingBox())!;
  await page.mouse.move(box.x + 15, box.y + 15);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) await page.mouse.move(box.x + 15 + i * 4, box.y + 15 + i * 2);
  const drag = await costs(page);
  await page.mouse.up();

  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom out" }).click();
  const zoom = await costs(page);

  console.log(`1,200 operators: redraw while dragging ${drag.median} ms (worst ${drag.worst}), zooming worst ${zoom.worst} ms`);
  // About 7 and 13 ms on a recent laptop, and 30 and 57 ms on a CI runner. Before the redraw
  // measured everything first, zooming took 470 ms on the laptop.
  expect(drag.median).toBeLessThan(80);
  expect(zoom.worst).toBeLessThan(250);
});

for (const size of [100, 300, 600, 1200, 2000]) {
  test(`a map with ${size} operators`, async ({ page }) => {
    test.skip(!process.env.PERF_SWEEP, "Set PERF_SWEEP=1 to measure the sweep");
    test.setTimeout(240_000);
    if (throttle > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    }
    await timeCallbacks(page);
    await page.goto(`/?map=big&size=${size}`);
    await page.waitForFunction(() => window.editor !== undefined);
    const load = Math.round(await page.evaluate(() => window.loadTime));
    const results: Record<string, unknown> = { load };
    await costs(page);

    // Dragging an operator around.
    const op = page.locator('.cw-node[data-id="op13"]');
    const box = (await op.boundingBox())!;
    await recordFrames(page);
    await page.mouse.move(box.x + 15, box.y + 15);
    await page.mouse.down();
    for (let i = 1; i <= 60; i++) await page.mouse.move(box.x + 15 + i * 4, box.y + 15 + i * 2);
    await page.mouse.up();
    results.drag = { ...(await stopFrames(page)), cost: await costs(page) };

    // Hovering down the source tree.
    await recordFrames(page);
    const rows = page.locator(".cw-source .cw-row");
    for (let i = 0; i < 30; i++) await rows.nth(i + 1).hover();
    results.hover = { ...(await stopFrames(page)), cost: await costs(page) };

    // Scrolling the source tree, which redraws every line.
    await recordFrames(page);
    for (let i = 0; i < 30; i++) await page.locator(".cw-source").evaluate((el, y) => (el.scrollTop = y), i * 40).then(() => page.waitForTimeout(16));
    results.scroll = { ...(await stopFrames(page)), cost: await costs(page) };

    // Zooming out and in.
    await recordFrames(page);
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Zoom out" }).click();
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Zoom in" }).click();
    results.zoom = { ...(await stopFrames(page)), cost: await costs(page) };

    // An edit: every edit re-renders the editor.
    const started = Date.now();
    await page.keyboard.press("ControlOrMeta+z");
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    results.undo = Date.now() - started;

    console.log(size, JSON.stringify(results));
  });
}

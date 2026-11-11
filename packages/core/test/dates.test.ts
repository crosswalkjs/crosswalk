import { describe, expect, it } from "vitest";
import { createRegistry } from "../src/index.js";
import { setToday } from "../src/operators/dates.js";
import type { ValueOperator } from "../src/operators/types.js";

const registry = createRegistry();
const run = (id: string, ...args: unknown[]) => (registry.get(id) as ValueOperator).run(args as never);

describe("date operators", () => {
  it("give today's date in UTC, and can be fixed for tests", () => {
    expect(run("date.today")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    setToday("2026-03-04");
    expect(run("date.diff", "1978-04-04", run("date.today"), "years")).toBe(47);
    setToday(undefined);
  });

  it("agree with the platform's calendar from year 1 to 9999", () => {
    for (let days = -719162; days < 2932896; days += 997) {
      const iso = new Date(days * 86400000).toISOString().slice(0, 10);
      expect(run("date.add", "1970-01-01", days, "days")).toBe(iso);
      expect(run("date.diff", "1970-01-01", iso, "days")).toBe(days);
      expect(run("date.part", iso, "weekday")).toBe(((new Date(days * 86400000).getUTCDay() + 6) % 7) + 1);
    }
  });
});

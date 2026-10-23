import { describe, expect, it } from "vitest";
import type { Meal } from "../../domain/planDocuments";
import { mealTimes, orderMeals } from "./mealTimes";
import { protocolDocument } from "./fixtures";

const meal = (key: string): Meal => ({ key, label: key, items: [] }) as Meal;
const src = (slots: { slot: string; time: string }[]) => ({
  plans: [],
  overrides: [],
  protocolActivatedOn: null,
  slots: slots.map((s) => ({
    ...s,
    dayType: "off" as const,
    reminderEnabled: false,
  })),
});

describe("mealTimes", () => {
  it("maps each meal to its configured time and omits meals without one", () => {
    const protocol = {
      ...protocolDocument(),
      meals: [meal("m1"), meal("m2")],
    } as Parameters<typeof mealTimes>[1];
    expect(
      mealTimes(
        "2026-10-20",
        protocol,
        src([{ slot: "meal_m1", time: "08:15" }]),
      ),
    ).toEqual({ m1: "08:15" });
  });
});

describe("orderMeals", () => {
  it("orders by time when every meal has one", () => {
    const out = orderMeals([meal("a"), meal("b"), meal("c")], {
      a: "13:00",
      b: "07:30",
      c: "10:00",
    });
    expect(out.map((m) => m.key)).toEqual(["b", "c", "a"]);
  });

  it("keeps the document order when any meal has no time", () => {
    const out = orderMeals([meal("a"), meal("b"), meal("c")], {
      a: "13:00",
      c: "10:00",
    });
    expect(out.map((m) => m.key)).toEqual(["a", "b", "c"]);
  });
});

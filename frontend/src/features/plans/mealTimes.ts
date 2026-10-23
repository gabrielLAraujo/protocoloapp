import { buildDay } from "../../domain/dayPlan";
import type { Meal, ProtocolDocument } from "../../domain/planDocuments";
import { toDayPlans, type TodaySources } from "../today/todayData";

/** The configured time (HH:mm) of each meal of `protocol` on `date`, by meal key: the same schedule Hoje uses. Meals without a time are left out. */
export function mealTimes(
  date: string,
  protocol: ProtocolDocument,
  src: Pick<
    TodaySources,
    "plans" | "overrides" | "slots" | "protocolActivatedOn"
  >,
): Record<string, string> {
  const plan = buildDay(
    date,
    protocol,
    toDayPlans(src.plans),
    src.overrides,
    src.slots,
    { protocolActivatedOn: src.protocolActivatedOn },
  );
  const times: Record<string, string> = {};
  for (const target of plan.targets)
    if (target.type === "meal" && target.time) times[target.key] = target.time;
  return times;
}

/** Meals by time when every one has a time (HH:mm sorts as text, ties keep document order); otherwise the document order. */
export function orderMeals(
  meals: readonly Meal[],
  times: Readonly<Record<string, string>>,
): Meal[] {
  if (!meals.every((m) => times[m.key])) return [...meals];
  return [...meals].sort((a, b) => times[a.key]!.localeCompare(times[b.key]!));
}

import { RRule } from "rrule";
import { Temporal } from "@js-temporal/polyfill";

export const MAX_REPEAT_OCCURRENCES = 100;
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
export type RepeatEnd =
  | { type: "count"; count: number }
  | { type: "date"; date: string }
  | { type: "choose" };
export type RepeatRule = {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  weekdays?: number[];
  monthlyMode?: "date" | "weekday" | "last-weekday";
  end: RepeatEnd;
};
export type TemplateRepeatRule = Omit<RepeatRule, "end"> & {
  end: Exclude<RepeatEnd, { type: "date" }>;
};
export type EventOccurrence = { startsAt: string; endsAt?: string };

function integer(value: unknown, min: number, max: number, label: string) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

export function parseRepeatRule(
  value: unknown,
  mode: "event" | "template",
): RepeatRule | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Choose a valid repeat pattern.");
  const input = value as Record<string, unknown>;
  if (
    !["daily", "weekly", "monthly", "yearly"].includes(String(input.frequency))
  )
    throw new Error("Choose a valid repeat frequency.");
  const frequency = input.frequency as RepeatRule["frequency"];
  const interval = integer(input.interval, 1, 99, "Repeat interval");
  let weekdays: number[] | undefined;
  if (frequency === "weekly" && input.weekdays !== undefined) {
    if (
      !Array.isArray(input.weekdays) ||
      !input.weekdays.length ||
      input.weekdays.length > 7
    )
      throw new Error("Select at least one repeat weekday.");
    weekdays = [
      ...new Set(input.weekdays.map((day) => integer(day, 0, 6, "Weekday"))),
    ].sort();
  }
  const monthlyMode = input.monthlyMode ?? "date";
  if (
    frequency === "monthly" &&
    !["date", "weekday", "last-weekday"].includes(String(monthlyMode))
  )
    throw new Error("Choose a valid monthly pattern.");
  const ending = input.end as Record<string, unknown> | undefined;
  let end: RepeatEnd;
  if (ending?.type === "count") {
    end = {
      type: "count",
      count: integer(
        ending.count,
        1,
        MAX_REPEAT_OCCURRENCES,
        "Total occurrences",
      ),
    };
  } else if (ending?.type === "date" && mode === "event") {
    if (
      typeof ending.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(ending.date)
    )
      throw new Error("Choose a valid repeat end date.");
    try {
      Temporal.PlainDate.from(ending.date);
    } catch {
      throw new Error("Choose a valid repeat end date.");
    }
    end = { type: "date", date: ending.date };
  } else if (ending?.type === "choose" && mode === "template") {
    end = { type: "choose" };
  } else {
    throw new Error(
      mode === "template"
        ? "Templates can end after a count, not on a calendar date."
        : "Choose a repeat end date or total number of occurrences.",
    );
  }
  return {
    frequency,
    interval,
    ...(weekdays ? { weekdays } : {}),
    ...(frequency === "monthly"
      ? { monthlyMode: monthlyMode as RepeatRule["monthlyMode"] }
      : {}),
    end,
  };
}

export function repeatFromTemplate(
  value?: TemplateRepeatRule | null,
): RepeatRule | null {
  const rule = parseRepeatRule(value, "template");
  if (!rule) return null;
  return {
    ...rule,
    weekdays: rule.weekdays ? [...rule.weekdays] : undefined,
    end:
      rule.end.type === "choose"
        ? { type: "count", count: 10 }
        : { ...rule.end },
  };
}

export function resolveRepeatTimeZone(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 100)
    throw new Error("Choose a valid event time zone.");
  try {
    return Temporal.Now.instant().toZonedDateTimeISO(value).timeZoneId;
  } catch {
    throw new Error("Choose a valid event time zone.");
  }
}

export function expandEventOccurrences(
  schedule: EventOccurrence,
  value: unknown,
  timeZone: string,
): EventOccurrence[] {
  const rule = parseRepeatRule(value, "event");
  if (!rule) return [{ ...schedule }];
  const zone = resolveRepeatTimeZone(timeZone);
  const start = Temporal.Instant.from(schedule.startsAt).toZonedDateTimeISO(
    zone,
  );
  const localStart = start.toPlainDateTime();
  const localEnd = schedule.endsAt
    ? Temporal.Instant.from(schedule.endsAt)
        .toZonedDateTimeISO(zone)
        .toPlainDateTime()
    : null;
  if (
    schedule.endsAt &&
    Date.parse(schedule.endsAt) <= Date.parse(schedule.startsAt)
  )
    throw new Error("Event end must be after the start.");
  const duration = localEnd ? localStart.until(localEnd) : null;
  const floatingStart = new Date(
    Date.UTC(
      start.year,
      start.month - 1,
      start.day,
      start.hour,
      start.minute,
      start.second,
    ),
  );
  const weekday = start.dayOfWeek % 7;
  const byweekday =
    rule.frequency === "weekly"
      ? (rule.weekdays ?? [weekday]).map(
          (day) =>
            [
              RRule.SU,
              RRule.MO,
              RRule.TU,
              RRule.WE,
              RRule.TH,
              RRule.FR,
              RRule.SA,
            ][day],
        )
      : rule.frequency === "monthly" && rule.monthlyMode !== "date"
        ? [
            [
              RRule.SU,
              RRule.MO,
              RRule.TU,
              RRule.WE,
              RRule.TH,
              RRule.FR,
              RRule.SA,
            ][weekday].nth(
              rule.monthlyMode === "last-weekday"
                ? -1
                : Math.ceil(start.day / 7),
            ),
          ]
        : undefined;
  const until =
    rule.end.type === "date"
      ? new Date(`${rule.end.date}T23:59:59Z`)
      : undefined;
  if (until && until.getTime() < floatingStart.getTime())
    throw new Error("Repeat end date must be on or after the event date.");
  const engine = new RRule({
    freq: {
      daily: RRule.DAILY,
      weekly: RRule.WEEKLY,
      monthly: RRule.MONTHLY,
      yearly: RRule.YEARLY,
    }[rule.frequency],
    dtstart: floatingStart,
    interval: rule.interval,
    wkst: RRule.MO,
    ...(byweekday ? { byweekday } : {}),
    ...(until ? { until } : {}),
    count:
      rule.end.type === "count" ? rule.end.count : MAX_REPEAT_OCCURRENCES + 1,
  });
  const dates = engine.all();
  if (dates.length > MAX_REPEAT_OCCURRENCES)
    throw new Error(
      `Limit this series to ${MAX_REPEAT_OCCURRENCES} occurrences or choose an earlier end date.`,
    );
  if (!dates.length)
    throw new Error(
      "This repeat pattern has no dates before the selected end date.",
    );
  return dates.map((date) => {
    const local = Temporal.PlainDateTime.from(date.toISOString().slice(0, 19));
    const startsAt = local.toZonedDateTime(zone).toInstant().toString();
    const endsAt = duration
      ? local.add(duration).toZonedDateTime(zone).toInstant().toString()
      : undefined;
    if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt))
      throw new Error(
        "A daylight-saving change makes the event end precede its start. Adjust the event time.",
      );
    return { startsAt, ...(endsAt ? { endsAt } : {}) };
  });
}

export function describeRepeat(rule?: RepeatRule | null) {
  if (!rule) return "Does not repeat";
  const unit = {
    daily: "day",
    weekly: "week",
    monthly: "month",
    yearly: "year",
  }[rule.frequency];
  const days =
    rule.frequency === "weekly" && rule.weekdays?.length
      ? ` on ${rule.weekdays.map((day) => WEEKDAYS[day].slice(0, 3)).join(", ")}`
      : "";
  const ending =
    rule.end.type === "count"
      ? `, ${rule.end.count} total occurrences`
      : rule.end.type === "date"
        ? `, through ${rule.end.date}`
        : "";
  return `Every ${rule.interval === 1 ? "" : rule.interval + " "}${unit}${rule.interval === 1 ? "" : "s"}${days}${ending}`;
}

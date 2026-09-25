import assert from "node:assert/strict";
import { test } from "vitest";
import {
  expandEventOccurrences,
  parseRepeatRule,
  repeatFromTemplate,
  type EventOccurrence,
  type RepeatRule,
} from "../lib/event-recurrence";

const weekly: RepeatRule = {
  frequency: "weekly",
  interval: 1,
  end: { type: "count", count: 3 },
};
const startsAt = "2026-09-21T18:00:00Z";
const dates = (items: EventOccurrence[]) =>
  items.map((item) => item.startsAt.slice(0, 10));

test("one-off events preserve their schedule exactly", () => {
  const schedule = { startsAt, endsAt: "2026-09-21T20:00:00Z" };
  assert.deepEqual(expandEventOccurrences(schedule, null, "UTC"), [schedule]);
});

test("weekly counts include the first occurrence", () => {
  assert.deepEqual(dates(expandEventOccurrences({ startsAt }, weekly, "UTC")), [
    "2026-09-21",
    "2026-09-28",
    "2026-10-05",
  ]);
});

test("selected weekdays and every-other-week intervals follow calendar weeks", () => {
  assert.deepEqual(
    dates(
      expandEventOccurrences(
        { startsAt },
        {
          ...weekly,
          interval: 2,
          weekdays: [1, 3],
          end: { type: "count", count: 4 },
        },
        "UTC",
      ),
    ),
    ["2026-09-21", "2026-09-23", "2026-10-05", "2026-10-07"],
  );
});

test("weekday presets skip the weekend", () => {
  assert.deepEqual(
    dates(
      expandEventOccurrences(
        { startsAt: "2026-09-25T18:00:00Z" },
        { ...weekly, weekdays: [1, 2, 3, 4, 5] },
        "UTC",
      ),
    ),
    ["2026-09-25", "2026-09-28", "2026-09-29"],
  );
});

test("monthly dates skip months without that date instead of drifting", () => {
  assert.deepEqual(
    dates(
      expandEventOccurrences(
        { startsAt: "2026-01-31T18:00:00Z" },
        { ...weekly, frequency: "monthly" },
        "UTC",
      ),
    ),
    ["2026-01-31", "2026-03-31", "2026-05-31"],
  );
});

test("monthly weekday patterns support the same ordinal and last weekday", () => {
  const schedule = { startsAt: "2026-09-21T18:00:00Z" };
  assert.deepEqual(
    dates(
      expandEventOccurrences(
        schedule,
        { ...weekly, frequency: "monthly", monthlyMode: "weekday" },
        "UTC",
      ),
    ),
    ["2026-09-21", "2026-10-19", "2026-11-16"],
  );
  assert.deepEqual(
    dates(
      expandEventOccurrences(
        schedule,
        { ...weekly, frequency: "monthly", monthlyMode: "last-weekday" },
        "UTC",
      ),
    ),
    ["2026-09-28", "2026-10-26", "2026-11-30"],
  );
});

test("yearly leap-day repeats stay on leap day", () => {
  assert.deepEqual(
    dates(
      expandEventOccurrences(
        { startsAt: "2024-02-29T18:00:00Z" },
        { ...weekly, frequency: "yearly" },
        "UTC",
      ),
    ),
    ["2024-02-29", "2028-02-29", "2032-02-29"],
  );
});

test("repeat end dates are inclusive in the event time zone", () => {
  const result = expandEventOccurrences(
    { startsAt: "2026-09-22T05:00:00Z" },
    {
      ...weekly,
      frequency: "daily",
      end: { type: "date", date: "2026-09-23" },
    },
    "America/Edmonton",
  );
  assert.equal(result.length, 3);
  assert.equal(result[2].startsAt, "2026-09-24T05:00:00Z");
});

test("spring daylight saving preserves evening wall time and overnight ends", () => {
  const result = expandEventOccurrences(
    { startsAt: "2026-03-02T02:00:00Z", endsAt: "2026-03-02T08:00:00Z" },
    weekly,
    "America/Edmonton",
  );
  assert.equal(result[0].startsAt, "2026-03-02T02:00:00Z");
  assert.equal(result[1].startsAt, "2026-03-09T01:00:00Z");
  assert.equal(result[1].endsAt, "2026-03-09T07:00:00Z");
});

test("fall daylight saving preserves the selected local start and end", () => {
  const result = expandEventOccurrences(
    { startsAt: "2026-10-26T01:00:00Z", endsAt: "2026-10-26T04:00:00Z" },
    weekly,
    "America/Edmonton",
  );
  assert.equal(result[1].startsAt, "2026-11-02T02:00:00Z");
  assert.equal(result[1].endsAt, "2026-11-02T05:00:00Z");
});

test("nonexistent spring clock times shift forward without shifting later weeks", () => {
  const result = expandEventOccurrences(
    { startsAt: "2026-03-01T09:30:00Z" },
    weekly,
    "America/Edmonton",
  );
  assert.equal(result[1].startsAt, "2026-03-08T09:30:00Z");
  assert.equal(result[2].startsAt, "2026-03-15T08:30:00Z");
});

test("templates reject dates and can defer the ending choice", () => {
  assert.throws(
    () =>
      parseRepeatRule(
        { ...weekly, end: { type: "date", date: "2026-12-01" } },
        "template",
      ),
    /Templates/,
  );
  const template: RepeatRule = {
    ...weekly,
    weekdays: [1, 3],
    end: { type: "choose" },
  };
  const applied = repeatFromTemplate(
    parseRepeatRule(
      template,
      "template",
    ) as import("../lib/event-recurrence").TemplateRepeatRule,
  );
  assert.deepEqual(applied!.end, { type: "count", count: 10 });
  applied!.weekdays!.push(5);
  assert.deepEqual(template.weekdays, [1, 3]);
  assert.deepEqual(template.end, { type: "choose" });
  assert.equal(repeatFromTemplate(null), null);
});

test("templates retain an explicit occurrence count when applied", () => {
  assert.deepEqual(
    repeatFromTemplate(
      weekly as import("../lib/event-recurrence").TemplateRepeatRule,
    )!.end,
    weekly.end,
  );
});

test("invalid repeat input fails rather than silently truncating", () => {
  for (const invalid of [
    { ...weekly, interval: 0 },
    { ...weekly, weekdays: [] },
    { ...weekly, weekdays: [7] },
    { ...weekly, end: { type: "count", count: 101 } },
    { ...weekly, end: { type: "count", count: 1.5 } },
    { ...weekly, end: { type: "date", date: "2026-02-30" } },
    { ...weekly, end: { type: "choose" } },
  ])
    assert.throws(() => expandEventOccurrences({ startsAt }, invalid, "UTC"));
  assert.throws(
    () => expandEventOccurrences({ startsAt }, weekly, "Invalid/Zone"),
    /time zone/,
  );
  assert.throws(
    () =>
      expandEventOccurrences(
        { startsAt },
        { ...weekly, end: { type: "date", date: "2026-09-20" } },
        "UTC",
      ),
    /end date/,
  );
  assert.throws(
    () =>
      expandEventOccurrences(
        { startsAt },
        {
          ...weekly,
          frequency: "daily",
          end: { type: "date", date: "2027-09-21" },
        },
        "UTC",
      ),
    /100 occurrences/,
  );
});

test("empty date ranges fail and the maximum count succeeds", () => {
  assert.throws(
    () =>
      expandEventOccurrences(
        { startsAt },
        { ...weekly, weekdays: [2], end: { type: "date", date: "2026-09-21" } },
        "UTC",
      ),
    /no dates/,
  );
  assert.equal(
    expandEventOccurrences(
      { startsAt },
      { ...weekly, end: { type: "count", count: 100 } },
      "UTC",
    ).length,
    100,
  );
});

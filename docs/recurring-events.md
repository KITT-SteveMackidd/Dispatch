# Repeating Events

Implemented locally in the mobile scheduling branch and the existing web checkout.
This data shape needs no Firestore rule changes or existing-event migration.
The changed apps still need a normal release before production users receive it.

## Creation

- Both drawers offer daily, weekdays, weekly, every two weeks, monthly, yearly,
  and custom intervals. Weekly rules can select several weekdays.
- Monthly rules support the starting day number, its ordinal weekday, or the last
  matching weekday. Missing dates are skipped, not rolled into the following month.
- Templates store `defaultRecurrence` only, with either a total occurrence count
  or an ending to choose when creating an event. Calendar end dates are rejected.
- Create Event copies the template rule without modifying it, uses the chosen
  start date, and accepts either an inclusive end date or a count.
- Counts include the first generated occurrence. A selected weekday pattern can
  move the first occurrence later than the start date; the date preview shows it.
- At most 100 events are materialized per submission. There is no infinite-series
  scheduler. Oversized date ranges fail validation instead of being truncated.
- Events in a series have independent roles, deadlines, assignments and completion
  state, plus `seriesId`, `seriesIndex`, `seriesCount`, `recurrence`, and `timeZone`.
- Existing edit/delete actions affect only the selected occurrence.

## Time and Persistence

`rrule` expands calendar dates; the Temporal polyfill resolves those local dates
in the creating device/browser's IANA time zone. Local clock times and optional
overnight end times stay consistent across DST. A nonexistent spring-forward time
shifts forward by the gap; a repeated fall-back time uses the earlier offset.

Event documents are saved atomically. Reminder-email requests are queued separately
to stay below Firestore security-rule document-lookup limits. The web returns a
creation warning if reminders fail, rather than asking the user to recreate events.
Templates never create event documents or queue reminders by themselves.

## References

- [Apple Calendar repeating events](https://support.apple.com/guide/calendar/set-up-all-day-multiday-or-repeating-events-icl1018/mac)
- [Google Calendar repeating events](https://support.google.com/calendar/answer/37115?hl=en)
- [rrule](https://github.com/jkbrzt/rrule)
- [Temporal time zones](https://tc39.es/proposal-temporal/docs/zoneddatetime.html)

## Local Verification

Mobile: `npm run typecheck`, `npm test`, `node --test tests/event-series.node.mjs`.
Web: `node --test tests/event-template-scheduling.test.mjs`, targeted ESLint,
and `npm run build`. UI checks use temporary isolated form fixtures, never live
Firestore writes. Physical-device keyboard and date-picker checks remain manual.

import * as Calendar from 'expo-calendar';

import { DispatchEvent } from '@/types/dispatch';

const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;

export async function addDispatchEventToCalendar(event: DispatchEvent) {
  const permission = await Calendar.requestCalendarPermissionsAsync();
  if (permission.status !== 'granted') {
    throw new Error('Calendar permission was not granted.');
  }

  const calendar = await Calendar.getDefaultCalendarAsync();
  if (!calendar?.id) {
    throw new Error('No writable default calendar was found.');
  }

  const startDate = new Date(event.startsAt);
  if (Number.isNaN(startDate.getTime())) {
    throw new Error('This event does not have a valid start time.');
  }

  const parsedEndDate = event.endsAt ? new Date(event.endsAt) : null;
  const endDate = parsedEndDate && !Number.isNaN(parsedEndDate.getTime())
    ? parsedEndDate
    : new Date(startDate.getTime() + DEFAULT_EVENT_DURATION_MS);

  await Calendar.createEventAsync(calendar.id, {
    title: event.name,
    location: event.location,
    notes: 'Added from Dispatch.',
    startDate,
    endDate,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

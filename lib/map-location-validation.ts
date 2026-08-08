export function getMapLocationValidationError(location: string, placeId?: string | null) {
  if (!location.trim()) return 'This event does not have a location yet.';
  if (!placeId?.trim()) return 'This location was not confirmed with Google Places. Edit the event and choose a location from the suggestions before opening Maps.';
  return null;
}

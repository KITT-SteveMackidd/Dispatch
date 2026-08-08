import { describe, expect, it } from 'vitest';
import { getMapLocationValidationError } from '../lib/map-location-validation';

describe('map location validation', () => {
  it('requires a confirmed Google Places selection', () => {
    expect(getMapLocationValidationError('Steve', null)).toMatch(/not confirmed/i);
    expect(getMapLocationValidationError('Calgary Tower, Calgary, AB', 'place-123')).toBeNull();
  });

  it('explains when no event location exists', () => {
    expect(getMapLocationValidationError('', 'place-123')).toMatch(/does not have a location/i);
  });
});

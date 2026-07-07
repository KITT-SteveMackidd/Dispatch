export type PlaceAutocompleteSuggestion = {
  id: string;
  label: string;
  secondaryLabel?: string;
};

type AutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
};

const PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;

export async function fetchPlaceAutocomplete(input: string, signal?: AbortSignal): Promise<PlaceAutocompleteSuggestion[]> {
  const query = input.trim();
  if (!PLACES_API_KEY || query.length < 3) return [];

  const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': PLACES_API_KEY,
    },
    body: JSON.stringify({
      input: query,
      includedPrimaryTypes: ['street_address', 'premise', 'establishment', 'geocode'],
    }),
  });

  if (!response.ok) {
    throw new Error('Unable to load location suggestions.');
  }

  const data = await response.json() as AutocompleteResponse;
  const suggestions: PlaceAutocompleteSuggestion[] = [];

  for (const suggestion of data.suggestions || []) {
      const prediction = suggestion.placePrediction;
      const label = prediction?.text?.text || prediction?.structuredFormat?.mainText?.text || '';
    if (!prediction?.placeId || !label.trim()) continue;

    const secondaryLabel = prediction.structuredFormat?.secondaryText?.text?.trim();
    suggestions.push({
      id: prediction.placeId,
      label: label.trim(),
      ...(secondaryLabel ? { secondaryLabel } : {}),
    });
  }

  return suggestions.slice(0, 5);
}

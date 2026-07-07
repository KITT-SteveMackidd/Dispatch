import { Alert, Linking, Platform } from 'react-native';

type MapOption = {
  label: string;
  url: string;
  supported?: boolean;
};

const encodeLocation = (location: string) => encodeURIComponent(location.trim());

export async function openMapAppPicker(location: string) {
  const trimmedLocation = location.trim();

  if (!trimmedLocation) {
    Alert.alert('Location unavailable', 'This event does not have a location yet.');
    return;
  }

  const encodedLocation = encodeLocation(trimmedLocation);
  const options: MapOption[] = [
    {
      label: 'Apple Maps',
      url: `http://maps.apple.com/?q=${encodedLocation}`,
      supported: Platform.OS === 'ios',
    },
    {
      label: 'Google Maps',
      url: Platform.OS === 'ios'
        ? `comgooglemaps://?q=${encodedLocation}`
        : `geo:0,0?q=${encodedLocation}`,
    },
    {
      label: 'Waze',
      url: `waze://?q=${encodedLocation}`,
    },
    {
      label: 'Browser Maps',
      url: `https://www.google.com/maps/search/?api=1&query=${encodedLocation}`,
      supported: true,
    },
  ];

  const availableOptions = (
    await Promise.all(
      options.map(async (option) => ({
        ...option,
        supported: option.supported ?? await Linking.canOpenURL(option.url).catch(() => false),
      }))
    )
  ).filter((option) => option.supported);

  if (!availableOptions.length) {
    Alert.alert('No map apps found', 'No compatible mapping apps were found on this device.');
    return;
  }

  Alert.alert(
    'Open location',
    trimmedLocation,
    [
      ...availableOptions.map((option) => ({
        text: option.label,
        onPress: () => Linking.openURL(option.url).catch(() => {
          Alert.alert('Unable to open map', `Could not open ${option.label}.`);
        }),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]
  );
}

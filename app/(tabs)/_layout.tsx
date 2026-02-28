import { FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { useSession } from '@/context/session';

export default function TabLayout() {
  const router = useRouter();
  const { signOut } = useSession();

  const switchProfile = async () => {
    await signOut();
    router.replace('/(auth)/setup');
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#3559ff',
        headerStyle: { backgroundColor: '#0b1020' },
        headerTintColor: 'white',
        tabBarStyle: { backgroundColor: '#0f1730', borderTopColor: '#1f2b52' },
        headerRight: () => (
          <Pressable onPress={switchProfile} style={{ marginRight: 12, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#22305d' }}>
            <Text style={{ color: 'white', fontWeight: '700', fontSize: 12 }}>Switch Profile</Text>
          </Pressable>
        ),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Upcoming',
          tabBarIcon: ({ color }) => <FontAwesome5 name="calendar-alt" size={18} color={color} />,
        }}
      />
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="clipboard-check-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="teams"
        options={{
          title: 'Teams & Chat',
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="account-group-outline" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}

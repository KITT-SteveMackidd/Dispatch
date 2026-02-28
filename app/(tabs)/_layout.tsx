import { Feather, FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { useSession } from '@/context/session';

export default function TabLayout() {
  const router = useRouter();
  const { signOut } = useSession();

  const switchProfile = async () => {
    await signOut();
    router.replace('/(auth)/signin');
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: '#64748b',
        headerStyle: { backgroundColor: '#f8fafc' },
        headerTintColor: '#0f172a',
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: '#ffffff', borderTopColor: '#e2e8f0' },
        sceneStyle: { backgroundColor: '#eef2ff' },
      }}>
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
          tabBarIcon: ({ color }) => <Feather name="clock" size={18} color={color} />,
          headerRight: () => (
            <Pressable style={{ marginRight: 14 }}>
              <Feather name="bell" size={18} color="#334155" />
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dispatches',
          tabBarIcon: ({ color }) => <FontAwesome5 name="clipboard-list" size={16} color={color} />,
          headerRight: () => (
            <Pressable style={{ marginRight: 14, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: '#475569', fontSize: 12, fontWeight: '600' }}>Filter</Text>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="teams"
        options={{
          title: 'Team',
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="account-group-outline" size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Feather name="user" size={18} color={color} />,
          headerRight: () => (
            <Pressable onPress={switchProfile} style={{ marginRight: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#e2e8f0' }}>
              <Text style={{ color: '#334155', fontWeight: '700', fontSize: 12 }}>Sign out</Text>
            </Pressable>
          ),
        }}
      />
    </Tabs>
  );
}

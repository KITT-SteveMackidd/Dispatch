import { Feather, FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { useSession } from '@/context/session';
import { watchUserTeamUnreadCounts } from '@/services/dispatch';
import { useThemeMode } from '@/context/theme';

export default function TabLayout() {
  const router = useRouter();
  const { profile, signOut } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const [teamUnreadTotal, setTeamUnreadTotal] = useState(0);

  useEffect(() => {
    if (!profile) {
      setTeamUnreadTotal(0);
      return;
    }

    return watchUserTeamUnreadCounts(profile.uid, (items) => {
      const total = items.reduce((sum, item) => sum + item.unreadCount, 0);
      setTeamUnreadTotal(total);
    });
  }, [profile]);

  const teamTabBadge = useMemo(() => (teamUnreadTotal > 0 ? teamUnreadTotal : undefined), [teamUnreadTotal]);

  const switchProfile = async () => {
    await signOut();
    router.replace('/(auth)/signin');
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: isDarkMode ? '#94a3b8' : '#64748b',
        headerStyle: { backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc' },
        headerTintColor: isDarkMode ? '#f8fafc' : '#0f172a',
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: isDarkMode ? '#0f172a' : '#ffffff', borderTopColor: isDarkMode ? '#1e293b' : '#e2e8f0' },
        sceneStyle: { backgroundColor: isDarkMode ? '#020617' : '#eef2ff' },
      }}>
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
          tabBarIcon: ({ color }) => <Feather name="clock" size={18} color={color} />,
          headerRight: () => (
            <Pressable style={{ marginRight: 14 }}>
              <Feather name="bell" size={18} color={isDarkMode ? '#cbd5e1' : '#334155'} />
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Events',
          tabBarIcon: ({ color }) => <FontAwesome5 name="clipboard-list" size={16} color={color} />,
          headerRight: () => (
            <Pressable
              style={{
                marginRight: 14,
                borderWidth: 1,
                borderColor: isDarkMode ? '#334155' : '#cbd5e1',
                backgroundColor: isDarkMode ? '#111827' : '#ffffff',
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}>
              <Text style={{ color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, fontWeight: '600' }}>Filter</Text>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="teams"
        options={{
          title: 'Teams',
          tabBarBadge: teamTabBadge,
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="account-group-outline" size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Feather name="user" size={18} color={color} />,
          headerRight: () => (
            <Pressable
              onPress={switchProfile}
              style={{
                marginRight: 12,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: isDarkMode ? '#1e293b' : '#e2e8f0',
              }}>
              <Text style={{ color: isDarkMode ? '#e2e8f0' : '#334155', fontWeight: '700', fontSize: 12 }}>Sign out</Text>
            </Pressable>
          ),
        }}
      />
    </Tabs>
  );
}

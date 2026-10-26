import { Feather, FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSession } from '@/context/session';
import { watchUserTeamUnreadCounts, watchUserUnreadNotificationCount } from '@/services/dispatch';
import { useThemeMode } from '@/context/theme';
import { initializeOrganizationBilling, watchOrganizationBilling } from '@/services/billing';
import { isCustomerBeta } from '@/config/beta-mode';

export default function TabLayout() {
  const router = useRouter();
  const { profile, signOut } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const customerBeta = isCustomerBeta();
  const [teamUnreadTotal, setTeamUnreadTotal] = useState(0);
  const [profileUnreadTotal, setProfileUnreadTotal] = useState(0);
  const [organizationReadOnly, setOrganizationReadOnly] = useState(false);
  const workerInvitePromptShownRef = useRef<string | null>(null);
  const managerOrganisationPromptShownRef = useRef<string | null>(null);

  useEffect(() => {
    if (profile?.role !== 'worker' || profile.organizationId) return;
    if (workerInvitePromptShownRef.current === profile.uid) return;

    workerInvitePromptShownRef.current = profile.uid;
    Alert.alert(
      'No invitation yet',
      'If you received a Dispatch invitation email, open the invitation link in that email to join the organization that invited you.'
    );
  }, [profile?.uid, profile?.role, profile?.organizationId]);

  useEffect(() => {
    if (profile?.role !== 'manager' || profile.organizationId) return;
    if (managerOrganisationPromptShownRef.current === profile.uid) return;

    managerOrganisationPromptShownRef.current = profile.uid;
    router.replace('/(tabs)/profile');
  }, [profile?.uid, profile?.role, profile?.organizationId, router]);

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

  useEffect(() => {
    setOrganizationReadOnly(false);
    if (customerBeta || !profile?.organizationId) {
      return;
    }
    let active = true;
    void initializeOrganizationBilling()
      .then((billing) => {
        if (active) setOrganizationReadOnly(billing.accessMode === 'read_only');
      })
      .catch(() => {
        if (active) setOrganizationReadOnly(true);
      });
    const unsubscribe = watchOrganizationBilling(
      profile.organizationId,
      (billing) => { if (active) setOrganizationReadOnly(billing.accessMode === 'read_only'); },
      () => { if (active) setOrganizationReadOnly(true); }
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [customerBeta, profile?.organizationId]);

  useEffect(() => {
    if (!profile) {
      setProfileUnreadTotal(0);
      return;
    }

    return watchUserUnreadNotificationCount(profile.uid, setProfileUnreadTotal);
  }, [profile]);

  const teamTabBadge = useMemo(() => (teamUnreadTotal > 0 ? teamUnreadTotal : undefined), [teamUnreadTotal]);
  const profileTabBadge = useMemo(() => (profileUnreadTotal > 0 ? profileUnreadTotal : undefined), [profileUnreadTotal]);

  const switchProfile = async () => {
    await signOut();
    router.replace('/(auth)/signin');
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    {!customerBeta && organizationReadOnly ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Organization is read-only. Open billing."
        onPress={() => router.push('/billing')}
        style={{
          alignItems: 'center',
          backgroundColor: isDarkMode ? '#411A24' : '#FEF2F2',
          borderBottomColor: isDarkMode ? '#8B2C3D' : '#FCA5A5',
          borderBottomWidth: 1,
          flexDirection: 'row',
          gap: 8,
          justifyContent: 'center',
          paddingHorizontal: 14,
          paddingVertical: 9,
        }}>
        <Feather name="lock" size={15} color={isDarkMode ? '#FECACA' : '#991B1B'} />
        <Text style={{ color: isDarkMode ? '#FECACA' : '#991B1B', fontSize: 12, fontWeight: '800' }}>
          Organization is read-only · View billing
        </Text>
      </Pressable>
    ) : null}
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#F98D2F',
        tabBarInactiveTintColor: isDarkMode ? '#F4F8FF' : '#94a3b8',
        headerStyle: { backgroundColor: isDarkMode ? '#1A2540' : '#f8fafc' },
        headerTintColor: isDarkMode ? '#F4F8FF' : '#1A2540',
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: isDarkMode ? '#1A2540' : '#ffffff', borderTopColor: isDarkMode ? '#001A4D' : '#e2e8f0' },
        sceneStyle: { backgroundColor: isDarkMode ? '#101A2F' : '#eef2ff' },
      }}>
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
          headerShown: false,
          tabBarIcon: ({ color }) => <Feather name="clock" size={18} color={typeof color === 'string' ? color : undefined} />,
          headerRight: () => (
            <Pressable style={{ marginRight: 14 }}>
              <Feather name="bell" size={18} color={isDarkMode ? '#F4F8FF' : '#334155'} />
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Events',
          headerShown: false,
          tabBarIcon: ({ color }) => <FontAwesome5 name="clipboard-list" size={16} color={color} />,
        }}
      />
      <Tabs.Screen
        name="teams"
        options={{
          title: 'Teams',
          headerShown: false,
          tabBarBadge: teamTabBadge,
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="account-group-outline" size={21} color={typeof color === 'string' ? color : undefined} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          headerShown: false,
          tabBarBadge: profileTabBadge,
          tabBarIcon: ({ color }) => <Feather name="user" size={18} color={typeof color === 'string' ? color : undefined} />,
          headerRight: () => (
            <Pressable
              onPress={switchProfile}
              style={{
                marginRight: 12,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: isDarkMode ? '#001A4D' : '#e2e8f0',
              }}>
              <Text style={{ color: isDarkMode ? '#F4F8FF' : '#334155', fontWeight: '700', fontSize: 12 }}>Sign out</Text>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="two"
        options={{
          href: null,
        }}
      />
    </Tabs>
    </GestureHandlerRootView>
  );
}

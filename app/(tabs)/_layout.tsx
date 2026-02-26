import { FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#3559ff', headerStyle: { backgroundColor: '#0b1020' }, headerTintColor: 'white', tabBarStyle: { backgroundColor: '#0f1730', borderTopColor: '#1f2b52' } }}>
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

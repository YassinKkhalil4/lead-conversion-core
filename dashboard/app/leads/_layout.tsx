import { View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { LeadListSkeleton } from '@/design/Skeleton';
import { color, layout } from '@/design/tokens';

export default function LeadsLayout() {
  const { status } = useAuth();

  if (status === 'restoring') {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, paddingTop: layout.queueHeader }}>
        <LeadListSkeleton rows={6} />
      </View>
    );
  }

  if (status === 'anonymous') return <Redirect href="/login" />;

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper } }} />;
}

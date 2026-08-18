import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { homeFor } from '@/nav/routes';
import { LeadListSkeleton } from '@/design/Skeleton';
import { color } from '@/design/tokens';

export default function Index() {
  const { status, user } = useAuth();

  if (status === 'restoring') {
    // The shape of the inbox, so the first paint does not jump.
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, paddingTop: 88 }}>
        <LeadListSkeleton rows={6} />
      </View>
    );
  }

  if (status !== 'authenticated' || !user) return <Redirect href="/login" />;
  return <Redirect href={homeFor(user.role)} />;
}

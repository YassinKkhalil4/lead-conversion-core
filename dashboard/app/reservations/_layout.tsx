import { View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { LeadListSkeleton } from '@/design/Skeleton';
import { color, layout } from '@/design/tokens';
import { useProfile } from '@/profile/ProfileProvider';

/**
 * Reservations exist for hospitality tenants. The link is hidden for others, and
 * this guard is the control: a real-estate user who types the address lands home.
 */
export default function ReservationsLayout() {
  const { status } = useAuth();
  const profile = useProfile();

  if (status === 'restoring') {
    return (
      <View style={{ flex: 1, backgroundColor: color.tint, paddingTop: layout.queueHeader }}>
        <LeadListSkeleton rows={6} />
      </View>
    );
  }
  if (status === 'anonymous') return <Redirect href="/login" />;
  if (!profile.features.reservations) return <Redirect href="/" />;

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.tint } }} />;
}

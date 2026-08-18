import { Stack } from 'expo-router';
import { color } from '@/design/tokens';
import { RequireRole } from '@/nav/RequireRole';

export default function ManageLayout() {
  return (
    <RequireRole allowed={['manager', 'admin']}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper } }} />
    </RequireRole>
  );
}

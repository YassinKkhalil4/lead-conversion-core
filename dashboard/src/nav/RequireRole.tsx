import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import type { Role } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { PageSkeleton } from '@/design/Skeleton';
import { color } from '@/design/tokens';
import { canAccess, homeFor } from './routes';

/**
 * The control, not the decoration. Navigation hides links a role cannot use,
 * but a typed URL or a stale tab reaches the route directly, so every guarded
 * surface asserts the role itself and sends the wrong one to its own home.
 *
 * The server enforces this independently — these endpoints are role-checked in
 * SQL — so this guard is about not showing a screen that would only fail.
 */
export function RequireRole({ allowed, children }: { allowed: Role[]; children: ReactNode }) {
  const { status, user } = useAuth();

  if (status === 'restoring') {
    return (
      <View style={{ flex: 1, backgroundColor: color.tint }}>
        <PageSkeleton />
      </View>
    );
  }

  if (status === 'anonymous' || !user) return <Redirect href="/login" />;
  if (!canAccess(user.role, allowed)) return <Redirect href={homeFor(user.role)} />;

  return <>{children}</>;
}

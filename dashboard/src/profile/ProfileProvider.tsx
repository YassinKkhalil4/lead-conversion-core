import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { realEstate, resolveProfile, type TenantProfile } from './index';

const ProfileContext = createContext<TenantProfile>(realEstate);

/**
 * A preview build can switch vertical with `?vertical=hospitality`, so both
 * views can be reviewed against the same fixture data without a second tenant.
 * The switch exists only in a build made with EXPO_PUBLIC_ALLOW_PROFILE_OVERRIDE=1;
 * a production build ignores the parameter.
 */
function previewOverride(): string | null {
  if (process.env.EXPO_PUBLIC_ALLOW_PROFILE_OVERRIDE !== '1') return null;
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('vertical');
    if (fromUrl) window.sessionStorage.setItem('kadensio.vertical', fromUrl);
    return fromUrl ?? window.sessionStorage.getItem('kadensio.vertical');
  } catch {
    return null;
  }
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const profile = useMemo(
    () => resolveProfile(user ? { clientKey: user.clientKey, vertical: user.vertical } : null, previewOverride()),
    [user],
  );
  return <ProfileContext.Provider value={profile}>{children}</ProfileContext.Provider>;
}

/** The tenant profile for the signed-in user. Real estate when nobody is signed in. */
export function useProfile(): TenantProfile {
  return useContext(ProfileContext);
}

import { useState, type ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Role } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Mark } from '@/design/Mark';
import { Text } from '@/design/Text';
import { color, hitSlop, radius, space } from '@/design/tokens';
import { useIsDesk } from '@/desk/Page';
import { navFor } from './routes';

/**
 * The shell adapts to the user, not just the width.
 *
 * A salesperson works one-handed on a phone, so their surfaces sit behind a
 * bottom tab bar. Managers and admins are doing desk work, so their surfaces
 * sit behind a persistent side rail on a wide screen and a drawer on a narrow
 * one — a bottom bar cannot hold six destinations without shrinking each to a
 * guess.
 */
export function Shell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isDesk = useIsDesk();

  if (!user) return <>{children}</>;

  const items = navFor(user.role);
  if (items.length <= 1) return <>{children}</>;

  if (user.role === 'salesperson') {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper }}>
        <View style={{ flex: 1 }}>{children}</View>
        <BottomTabs role={user.role} />
      </View>
    );
  }

  if (isDesk) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: color.paper }}>
        <SideRail role={user.role} />
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    );
  }

  return <DrawerShell role={user.role}>{children}</DrawerShell>;
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/manage') return pathname === '/manage';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SideRail({ role }: { role: Role }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        width: 232,
        borderEndWidth: 1,
        borderEndColor: color.hairline,
        backgroundColor: color.surface,
        paddingTop: insets.top + space.xxl,
        paddingBottom: insets.bottom + space.xl,
        paddingHorizontal: space.lg,
        gap: space.xs,
      }}
    >
      <View style={{ paddingHorizontal: space.md, paddingBottom: space.xl, gap: 2 }}>
        {/* Mark alone beside the name set in the app's own type. The brand's
            clear space is half the mark's height on every side; the rail's
            horizontal padding and the block's bottom padding both clear it. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Mark size={26} />
          <Text size="large" weight="bold">
            Kadensio
          </Text>
        </View>
        <Text size="micro" tone="faint" numberOfLines={1}>
          {user?.companyName ?? ''}
        </Text>
      </View>

      {navFor(role).map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Pressable
            key={`${item.href}-${item.label}`}
            accessibilityRole="link"
            accessibilityState={{ selected: active }}
            onPress={() => router.push(item.href)}
            style={({ pressed }) => ({
              paddingHorizontal: space.md,
              paddingVertical: space.lg,
              borderRadius: radius.md,
              backgroundColor: active ? color.surfaceSunken : pressed ? color.surfacePressed : 'transparent',
            })}
          >
            <Text size="small" weight={active ? 'semibold' : 'regular'} tone={active ? 'default' : 'muted'}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}

      <View style={{ flex: 1 }} />
      <Pressable onPress={() => void signOut()} hitSlop={hitSlop} style={{ paddingHorizontal: space.md }}>
        <Text size="micro" tone="faint" numberOfLines={1}>
          {user?.name ?? ''} · sign out
        </Text>
      </Pressable>
    </View>
  );
}

function DrawerShell({ role, children }: { role: Role; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();

  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: space.md,
          paddingHorizontal: space.xl,
          backgroundColor: color.surface,
          borderBottomWidth: 1,
          borderBottomColor: color.hairline,
        }}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Open navigation" onPress={() => setOpen(true)} hitSlop={hitSlop}>
          <Text size="large" weight="semibold">
            ☰
          </Text>
        </Pressable>
        <Mark size={24} />
        <Text size="small" weight="semibold" style={{ flex: 1 }} numberOfLines={1}>
          {user?.companyName ?? 'Kadensio'}
        </Text>
      </View>

      <View style={{ flex: 1 }}>{children}</View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: color.scrim }}>
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              width: 264,
              height: '100%',
              backgroundColor: color.surface,
              paddingTop: insets.top + space.xxl,
              paddingBottom: insets.bottom + space.xl,
              paddingHorizontal: space.lg,
              gap: space.xs,
            }}
          >
            {navFor(role).map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Pressable
                  key={`${item.href}-${item.label}`}
                  accessibilityRole="link"
                  onPress={() => {
                    setOpen(false);
                    router.push(item.href);
                  }}
                  style={({ pressed }) => ({
                    paddingHorizontal: space.md,
                    paddingVertical: space.lg,
                    borderRadius: radius.md,
                    backgroundColor: active ? color.surfaceSunken : pressed ? color.surfacePressed : 'transparent',
                  })}
                >
                  <Text size="body" weight={active ? 'semibold' : 'regular'} tone={active ? 'default' : 'muted'}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => void signOut()} style={{ paddingHorizontal: space.md, paddingVertical: space.lg }}>
              <Text size="small" tone="faint">
                Sign out
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function BottomTabs({ role }: { role: Role }) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: color.hairline,
        backgroundColor: color.surface,
        paddingBottom: insets.bottom,
      }}
    >
      {navFor(role).map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Pressable
            key={`${item.href}-${item.label}`}
            accessibilityRole="link"
            accessibilityState={{ selected: active }}
            onPress={() => router.push(item.href)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 48,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? color.surfacePressed : 'transparent',
              borderTopWidth: 2,
              borderTopColor: active ? color.ink : 'transparent',
            })}
          >
            <Text size="small" weight={active ? 'semibold' : 'regular'} tone={active ? 'default' : 'muted'}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

import { type ReactNode } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/design/Text';
import { color, layout, radius, space } from '@/design/tokens';

/** Below this the side navigation collapses into a drawer. */
export const DESK_BREAKPOINT = 900;

export function useIsDesk(): boolean {
  const { width } = useWindowDimensions();
  return width >= DESK_BREAKPOINT;
}

/**
 * The management surfaces are read at a desk, so they get a wide measure and
 * generous spacing rather than the phone-first density of the queue. The tokens
 * and type scale are shared, which is what keeps them one product.
 */
export function Page({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const isDesk = useIsDesk();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.paper }}
      contentContainerStyle={{
        padding: isDesk ? layout.pageDesk : layout.pagePhone,
        paddingTop: (isDesk ? layout.pageDesk : layout.pagePhone) + (isDesk ? 0 : insets.top),
        paddingBottom: insets.bottom + space.huge,
        gap: layout.sectionGap,
        maxWidth: 1280,
        width: '100%',
        // Centred, so an ultrawide window does not pin the page to the left
        // edge with the measure's worth of dead space beside it.
        alignSelf: 'center',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: space.lg,
        }}
      >
        <View style={{ flexGrow: 1, flexBasis: 260, gap: layout.stack }}>
          <Text size="title" weight="bold">
            {title}
          </Text>
          {subtitle ? (
            <Text size="small" tone="muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {actions ? <View style={{ flexDirection: 'row', gap: layout.inline }}>{actions}</View> : null}
      </View>

      {children}
    </ScrollView>
  );
}

export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: layout.rowY }}>
      <View style={{ gap: 2 }}>
        <Text size="large" weight="semibold">
          {title}
        </Text>
        {note ? (
          <Text size="small" tone="muted">
            {note}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function Panel({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        padding: layout.panel,
        gap: layout.panel,
        borderWidth: 1,
        borderColor: color.hairline,
        borderRadius: radius.sm,
        backgroundColor: color.surface,
      }}
    >
      {children}
    </View>
  );
}

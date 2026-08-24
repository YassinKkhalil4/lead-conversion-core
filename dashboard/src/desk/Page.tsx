import { type ReactNode } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/design/Text';
import { color, layout, radius, space, tracking } from '@/design/tokens';

/** Below this the side navigation collapses into a drawer. */
export const DESK_BREAKPOINT = 900;

/** The landing page's `--wrap`. */
const WRAP = 1120;

export function useIsDesk(): boolean {
  const { width } = useWindowDimensions();
  return width >= DESK_BREAKPOINT;
}

/**
 * A page on the landing page's tinted section ground, with its content held to
 * the same `--wrap` measure the site uses.
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
  const pad = isDesk ? layout.pageDesk : layout.pagePhone;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.tint }}
      contentContainerStyle={{
        padding: pad,
        paddingTop: pad + (isDesk ? 0 : insets.top),
        paddingBottom: insets.bottom + space.huge,
        gap: layout.sectionGap,
        maxWidth: WRAP,
        width: '100%',
        alignSelf: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: space.lg }}>
        <View style={{ flexGrow: 1, flexBasis: 260, gap: layout.stack }}>
          <Text size="headline" weight="semibold">
            {title}
          </Text>
          {subtitle ? (
            <Text size="body" tone="muted">
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
      <View style={{ gap: layout.stack }}>
        <Text size="title" weight="semibold">
          {title}
        </Text>
        {note ? (
          <Text size="small" tone="faint">
            {note}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/**
 * The landing page's `.panel`: paper ground, one hairline, 4px corners.
 * `head` renders its `.panel-head` — mono, uppercase, opened up, ink-3.
 */
export function Panel({ head, children }: { head?: string; children: ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: radius.md,
        overflow: 'hidden',
      }}
    >
      {head ? <PanelHead>{head}</PanelHead> : null}
      <View style={{ padding: layout.panel, gap: layout.panel }}>{children}</View>
    </View>
  );
}

export function PanelHead({ children }: { children: string }) {
  return (
    <View
      style={{
        paddingHorizontal: layout.rowX,
        paddingVertical: layout.headerY,
        borderBottomWidth: 1,
        borderBottomColor: color.line2,
      }}
    >
      <Text size="micro" tone="faint" numeric style={{ textTransform: 'uppercase', letterSpacing: tracking.label }}>
        {children}
      </Text>
    </View>
  );
}

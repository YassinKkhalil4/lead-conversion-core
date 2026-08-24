import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/design/Text';
import { color, space } from '@/design/tokens';

/**
 * Everything below the fold starts closed. The screen is read in the ten
 * seconds before dialling, so reference material has to be reachable without
 * being in the way.
 */
export function Collapsible({
  title,
  note,
  children,
  initiallyOpen = false,
}: {
  title: string;
  note?: string;
  children: ReactNode;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: color.line2, backgroundColor: color.paper }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.lg,
          paddingHorizontal: space.xl,
          paddingVertical: space.lg,
          backgroundColor: pressed ? color.line2 : 'transparent',
        })}
      >
        <View style={{ flex: 1, gap: 1 }}>
          <Text size="small" weight="semibold">
            {title}
          </Text>
          {note ? (
            <Text size="micro" tone="faint" numeric>
              {note}
            </Text>
          ) : null}
        </View>
        <Text size="small" tone="faint">
          {open ? '−' : '+'}
        </Text>
      </Pressable>
      {open ? <View style={{ borderTopWidth: 1, borderTopColor: color.line2 }}>{children}</View> : null}
    </View>
  );
}

import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { color, layout, radius, rowHeight, space } from './tokens';

/** A shape placeholder, sized to the content that will replace it. */
export function Skeleton({
  width,
  height = 12,
  style,
}: {
  width: number | `${number}%`;
  height?: number;
  style?: object;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius.sm,
          backgroundColor: pulse.interpolate({
            inputRange: [0, 1],
            outputRange: [color.surfaceSunken, color.hairline],
          }),
        },
        style,
      ]}
    />
  );
}

/**
 * The queue row, in shapes.
 *
 * It draws two lines because the row it stands in for draws two — name and
 * clock, then summary and temperature. It drew three before, so the list
 * reflowed the moment real data arrived.
 */
export function LeadRowSkeleton({ urgent = false }: { urgent?: boolean }) {
  return (
    <View
      style={{
        height: urgent ? rowHeight.urgent : rowHeight.standard,
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: color.hairline,
      }}
    >
      {/* The urgency edge marker occupies its width even before we know a row
          is urgent, so acknowledging one does not shift the column. */}
      <View style={{ width: urgent ? layout.edgeMarker : 0 }} />
      <View
        style={{
          flex: 1,
          paddingLeft: urgent ? layout.rowX - layout.edgeMarker : layout.rowX,
          paddingRight: layout.rowX,
          justifyContent: 'center',
          gap: layout.stack + 2,
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Skeleton width={urgent ? 176 : 148} height={urgent ? 18 : 15} />
          <Skeleton width={urgent ? 62 : 40} height={urgent ? 16 : 13} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Skeleton width={124} height={12} />
          <Skeleton width={68} height={16} />
        </View>
      </View>
    </View>
  );
}

/**
 * The first rows are drawn urgent because the queue sorts urgent first, so the
 * placeholder has the same silhouette as the list that replaces it.
 */
export function LeadListSkeleton({ rows = 8, urgent = 2 }: { rows?: number; urgent?: number }) {
  return (
    <View>
      {Array.from({ length: rows }, (_, index) => (
        <LeadRowSkeleton key={index} urgent={index < urgent} />
      ))}
    </View>
  );
}

/**
 * A desk page before its role is known: title, the stat strip, and a table.
 *
 * The management surfaces used to fall back to `DetailSkeleton`, which is the
 * shape of a lead detail — so the first frame of a cold load was six grey bars
 * that resembled nothing the page was about to draw.
 */
export function PageSkeleton() {
  return (
    <View style={{ padding: layout.pageDesk, gap: layout.sectionGap, maxWidth: 1280, width: '100%', alignSelf: 'center' }}>
      <View style={{ gap: layout.stack }}>
        <Skeleton width={180} height={22} />
        <Skeleton width={240} height={13} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            style={{
              flexGrow: index === 0 ? 2 : 1,
              flexBasis: index === 0 ? 280 : 180,
              padding: layout.panel,
              borderWidth: 1,
              borderColor: color.hairline,
              borderRadius: radius.sm,
              backgroundColor: color.surface,
              gap: space.md,
            }}
          >
            <Skeleton width={index === 0 ? 150 : 90} height={11} />
            <Skeleton width={index === 0 ? 110 : 64} height={index === 0 ? 56 : 28} />
            <Skeleton width={110} height={11} />
          </View>
        ))}
      </View>

      <View style={{ gap: layout.rowY }}>
        <Skeleton width={140} height={17} />
        <View style={{ borderWidth: 1, borderColor: color.hairline, borderRadius: radius.sm, backgroundColor: color.surface, overflow: 'hidden' }}>
          <View style={{ backgroundColor: color.surfaceSunken, paddingHorizontal: layout.rowX, paddingVertical: layout.headerY }}>
            <Skeleton width={90} height={11} />
          </View>
          {[0, 1, 2, 3].map((index) => (
            <View
              key={index}
              style={{
                paddingHorizontal: layout.rowX,
                paddingVertical: layout.rowY,
                minHeight: layout.tableRow,
                justifyContent: 'center',
                borderBottomWidth: index === 3 ? 0 : 1,
                borderBottomColor: color.hairline,
              }}
            >
              <Skeleton width={`${58 - index * 6}%`} height={13} />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

export function DetailSkeleton() {
  return (
    <View style={{ padding: space.xl, gap: space.lg }}>
      <Skeleton width="60%" height={20} />
      <Skeleton width="40%" height={13} />
      <View style={{ height: space.lg }} />
      <Skeleton width="90%" height={13} />
      <Skeleton width="75%" height={13} />
      <Skeleton width="85%" height={13} />
    </View>
  );
}

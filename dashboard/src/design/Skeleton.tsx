import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { color, radius, rowHeight, space } from './tokens';

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

/** Matches the real lead row: name line, meta line, and the right-hand column. */
export function LeadRowSkeleton() {
  return (
    <View
      style={{
        height: rowHeight.lead,
        paddingHorizontal: space.xl,
        paddingVertical: space.lg,
        borderBottomWidth: 1,
        borderBottomColor: color.hairline,
        justifyContent: 'space-between',
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Skeleton width={150} height={14} />
        <Skeleton width={54} height={14} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Skeleton width={110} height={11} />
        <Skeleton width={38} height={11} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Skeleton width={88} height={11} />
        <Skeleton width={62} height={11} />
      </View>
    </View>
  );
}

export function LeadListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <View>
      {Array.from({ length: rows }, (_, index) => (
        <LeadRowSkeleton key={index} />
      ))}
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

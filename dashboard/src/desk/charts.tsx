import { View } from 'react-native';
import { Text } from '@/design/Text';
import { color, layout, radius, space, tracking } from '@/design/tokens';
import { duration } from '@/time/format';

/**
 * Charts are plain Views rather than a charting library.
 *
 * Every mark these screens need is a rectangle — horizontal bars and a
 * min/median/p90/max range. A library compatible with react-native-web would
 * add a dependency and an SVG layer to draw rectangles, and would need explicit
 * handling to mirror under RTL. Flexbox rows mirror for free, inherit the type
 * scale, and stay legible when a value is missing.
 */
export function BarChart({
  rows,
  colorFor,
  emptyLabel,
}: {
  rows: { label: string; value: number }[];
  colorFor?: (label: string) => string;
  emptyLabel: string;
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  if (rows.length === 0 || total === 0) {
    return (
      <Text size="small" tone="faint">
        {emptyLabel}
      </Text>
    );
  }

  return (
    <View style={{ gap: space.lg }}>
      {rows.map((row) => (
        <View key={row.label} style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md }}>
            <Text size="small" style={{ flex: 1 }} numberOfLines={1}>
              {row.label}
            </Text>
            <Text size="small" weight="semibold" numeric>
              {row.value}
            </Text>
            <Text size="micro" tone="faint" numeric style={{ width: 44, textAlign: 'right' }}>
              {Math.round((row.value / total) * 100)}%
            </Text>
          </View>
          <View style={{ height: 8, backgroundColor: color.surfaceSunken, borderRadius: radius.sm }}>
            <View
              style={{
                height: 8,
                width: `${Math.max(2, (row.value / max) * 100)}%`,
                backgroundColor: colorFor?.(row.label) ?? color.ink,
                borderRadius: radius.sm,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Median, p90 and worst on one axis.
 *
 * A single average is the wrong representation for response time: it hides the
 * lead that waited four hours, and that lead is the reason this product exists.
 * The bar runs to p90 and the worst case is marked beyond it, so the tail is
 * visible rather than averaged away.
 */
export function DistributionBar({
  label,
  median,
  p90,
  worst,
}: {
  label: string;
  median: number | null;
  p90: number | null;
  worst: number | null;
}) {
  const scale = Math.max(worst ?? 0, p90 ?? 0, median ?? 0, 1);
  const position = (value: number | null): number =>
    value === null ? 0 : Math.min(100, Math.max(1.5, (value / scale) * 100));

  if (median === null && p90 === null && worst === null) {
    return (
      <View style={{ gap: space.sm }}>
        <Text size="small" weight="semibold">
          {label}
        </Text>
        <Text size="small" tone="faint">
          Nothing measured yet.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: space.md }}>
      <Text size="small" weight="semibold">
        {label}
      </Text>

      <View style={{ height: 22, justifyContent: 'center' }}>
        <View style={{ height: 10, backgroundColor: color.surfaceSunken, borderRadius: radius.sm }} />
        <View
          style={{
            position: 'absolute',
            height: 10,
            width: `${position(p90)}%`,
            backgroundColor: color.hairlineStrong,
            borderRadius: radius.sm,
          }}
        />
        <View
          style={{
            position: 'absolute',
            height: 10,
            width: `${position(median)}%`,
            backgroundColor: color.ink,
            borderRadius: radius.sm,
          }}
        />
        {worst === null ? null : (
          <View
            style={{
              position: 'absolute',
              start: `${position(worst)}%`,
              width: 2,
              height: 22,
              marginStart: -1,
              backgroundColor: color.alert,
            }}
          />
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: space.xl }}>
        <Reading label="median" value={median} />
        <Reading label="p90" value={p90} tone="muted" />
        <Reading label="worst" value={worst} tone="alert" />
      </View>
    </View>
  );
}

function Reading({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number | null;
  tone?: 'default' | 'muted' | 'alert';
}) {
  return (
    <View style={{ gap: 1 }}>
      <Text size="micro" tone="faint" style={{ textTransform: 'uppercase', letterSpacing: tracking.label }}>
        {label}
      </Text>
      <Text
        size="body"
        weight="semibold"
        numeric
        style={tone === 'alert' ? { color: color.alert } : tone === 'muted' ? { color: color.inkMuted } : undefined}
      >
        {duration(value)}
      </Text>
    </View>
  );
}

/** A headline figure with its direction against the period before it. */
export function StatTile({
  label,
  value,
  previous,
  format = (input) => String(input),
  lowerIsBetter = false,
  hint,
  primary = false,
  overdue = false,
}: {
  label: string;
  value: number | null;
  previous: number | null;
  format?: (value: number) => string;
  lowerIsBetter?: boolean;
  hint?: string;
  /**
   * Gives the tile the strip's first fixation: wider, and a display-weight
   * figure. One tile per strip, for the one figure a reader would act on.
   */
  primary?: boolean;
  /**
   * Colours the figure when it is non-zero. Only legitimate on a tile that
   * measures lateness — that is one of the two things colour means here, and
   * the tile must not reach for it to mean anything else.
   */
  overdue?: boolean;
}) {
  const delta = value !== null && previous !== null && previous !== 0 ? value - previous : null;
  const better = delta === null ? null : lowerIsBetter ? delta < 0 : delta > 0;
  const unchanged = delta === 0;

  const late = overdue && value !== null && value > 0;

  return (
    <View
      style={{
        flexGrow: primary ? 2 : 1,
        flexBasis: primary ? 280 : 180,
        gap: space.sm,
        padding: layout.panel,
        borderWidth: 1,
        borderColor: color.hairline,
        backgroundColor: color.surface,
      }}
    >
      <Text size="micro" tone="muted" style={{ textTransform: 'uppercase', letterSpacing: tracking.label }}>
        {label}
      </Text>
      <Text
        size={primary ? 'display' : 'headline'}
        weight="bold"
        numeric
        style={late ? { color: color.alert } : undefined}
      >
        {value === null ? '—' : format(value)}
      </Text>
      {delta === null ? (
        <Text size="micro" tone="faint">
          {previous === null ? 'no earlier period' : 'nothing in the previous period'}
        </Text>
      ) : (
        <Text
          size="micro"
          numeric
          style={{ color: unchanged ? color.inkFaint : better ? color.ink : color.alert }}
        >
          {unchanged ? 'level with' : `${delta > 0 ? '+' : ''}${format(delta)} vs`} previous
        </Text>
      )}
      {hint ? (
        <Text size="micro" tone="faint">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

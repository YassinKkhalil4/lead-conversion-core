import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { EmptyState } from '@/design/StateBlock';
import { Text } from '@/design/Text';
import { color, space } from '@/design/tokens';

export interface Column<T> {
  key: string;
  header: string;
  width: number;
  /** Right-aligned by convention for numbers, which are tabular. */
  numeric?: boolean;
  /** Returning null makes the column unsortable. */
  sortValue?: (row: T) => string | number | null;
  render: (row: T) => ReactNode;
}

type Direction = 'asc' | 'desc';

/**
 * A desk-width table. The salesperson queue is a list of rows because it is read
 * one-handed on a phone; this is read at a desk, where columns and sorting are
 * what make a team comparable.
 *
 * It scrolls horizontally rather than collapsing, so a narrow window hides no
 * column and the reader keeps the same mental model at every width.
 */
export function DataTable<T>({
  rows,
  columns,
  keyOf,
  onRowPress,
  emptyTitle,
  emptyDetail,
  initialSort,
}: {
  rows: T[];
  columns: Column<T>[];
  keyOf: (row: T) => string;
  /**
   * Makes the whole row a control. Do not combine it with a pressable inside
   * a cell: nested pressables make the click target ambiguous on web. Give
   * the table an actions column instead.
   */
  onRowPress?: (row: T) => void;
  emptyTitle: string;
  emptyDetail: string;
  initialSort?: { key: string; direction: Direction };
}) {
  const [sort, setSort] = useState<{ key: string; direction: Direction } | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((entry) => entry.key === sort.key);
    if (!column?.sortValue) return rows;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = column.sortValue!(a);
      const right = column.sortValue!(b);
      // Rows with no value sort last in either direction: a blank is not a zero.
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor;
      return String(left).localeCompare(String(right)) * factor;
    });
  }, [rows, columns, sort]);

  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);

  if (rows.length === 0) {
    return (
      <View style={{ borderWidth: 1, borderColor: color.hairline, borderRadius: 4, backgroundColor: color.surface }}>
        <EmptyState title={emptyTitle} detail={emptyDetail} />
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator style={{ flexGrow: 0 }}>
      <View style={{ minWidth: totalWidth, borderWidth: 1, borderColor: color.hairline, backgroundColor: color.surface }}>
        <View style={{ flexDirection: 'row', backgroundColor: color.surfaceSunken }}>
          {columns.map((column) => {
            const sortable = Boolean(column.sortValue);
            const active = sort?.key === column.key;
            return (
              <Pressable
                key={column.key}
                accessibilityRole={sortable ? 'button' : undefined}
                disabled={!sortable}
                onPress={() =>
                  setSort((current) =>
                    current?.key === column.key
                      ? { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
                      : { key: column.key, direction: column.numeric ? 'desc' : 'asc' },
                  )
                }
                style={{
                  width: column.width,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.lg,
                  borderBottomWidth: 1,
                  borderBottomColor: color.hairlineStrong,
                  alignItems: column.numeric ? 'flex-end' : 'flex-start',
                }}
              >
                <Text size="micro" weight="bold" tone={active ? 'default' : 'muted'} style={{ letterSpacing: 0.5 }}>
                  {column.header.toUpperCase()}
                  {active ? (sort?.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {sorted.map((row, index) => {
          const cells = columns.map((column) => (
            <View
              key={column.key}
              style={{
                width: column.width,
                paddingHorizontal: space.lg,
                paddingVertical: space.lg,
                alignItems: column.numeric ? 'flex-end' : 'flex-start',
                justifyContent: 'center',
              }}
            >
              {column.render(row)}
            </View>
          ));

          const border = {
            borderBottomWidth: index === sorted.length - 1 ? 0 : 1,
            borderBottomColor: color.hairline,
          } as const;

          // A table without a row action renders plain Views, so a cell may
          // hold its own control without nesting inside an outer pressable.
          if (!onRowPress) {
            return (
              <View
                key={keyOf(row)}
                style={{ flexDirection: 'row', backgroundColor: color.surface, ...border }}
              >
                {cells}
              </View>
            );
          }

          return (
            <Pressable
              key={keyOf(row)}
              accessibilityRole="button"
              onPress={() => onRowPress(row)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                backgroundColor: pressed ? color.surfacePressed : color.surface,
                ...border,
              })}
            >
              {cells}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

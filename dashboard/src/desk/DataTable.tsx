import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Skeleton } from '@/design/Skeleton';
import { EmptyState } from '@/design/StateBlock';
import { Text } from '@/design/Text';
import { color, layout, radius, tracking } from '@/design/tokens';

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
  loading = false,
  emptyActionLabel,
  onEmptyAction,
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
  /**
   * True while the first page is in flight.
   *
   * Without this a table renders its empty state during the initial fetch, so a
   * new account is told its data does not exist for as long as the request
   * takes. Callers pass the query's `isLoading`, not `isFetching`: a background
   * refetch has rows on screen already and must not replace them.
   */
  loading?: boolean;
  /** Offered inside the empty state, where the reader can act from here. */
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
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

  if (loading) {
    return (
      <Frame>
        <HeaderRow columns={columns} sort={null} onSort={undefined} />
        {[0, 1, 2, 3, 4].map((index) => (
          <View
            key={index}
            style={{
              flexDirection: 'row',
              borderBottomWidth: index === 4 ? 0 : 1,
              borderBottomColor: color.line2,
            }}
          >
            {columns.map((column) => (
              <View
                key={column.key}
                style={{
                  width: column.width,
                  paddingHorizontal: layout.rowX,
                  paddingVertical: layout.rowY,
                  alignItems: column.numeric ? 'flex-end' : 'flex-start',
                  justifyContent: 'center',
                }}
              >
                {/* Sized to the cell it stands in, so the grid does not shift
                    when the real values arrive. */}
                <Skeleton width={Math.round((column.width - layout.rowX * 2) * (column.numeric ? 0.5 : 0.8))} height={13} />
              </View>
            ))}
          </View>
        ))}
      </Frame>
    );
  }

  if (rows.length === 0) {
    return (
      <Frame>
        <EmptyState
          title={emptyTitle}
          detail={emptyDetail}
          actionLabel={emptyActionLabel}
          onAction={onEmptyAction}
        />
      </Frame>
    );
  }

  return (
    <Frame minWidth={totalWidth}>
      <HeaderRow columns={columns} sort={sort} onSort={setSort} />

        {sorted.map((row, index) => {
          const cells = columns.map((column) => (
            <View
              key={column.key}
              style={{
                width: column.width,
                paddingHorizontal: layout.rowX,
                paddingVertical: layout.rowY,
                minHeight: layout.tableRow,
                alignItems: column.numeric ? 'flex-end' : 'flex-start',
                justifyContent: 'center',
              }}
            >
              {column.render(row)}
            </View>
          ));

          const border = {
            borderBottomWidth: index === sorted.length - 1 ? 0 : 1,
            borderBottomColor: color.line2,
          } as const;

          // A table without a row action renders plain Views, so a cell may
          // hold its own control without nesting inside an outer pressable.
          if (!onRowPress) {
            return (
              <View
                key={keyOf(row)}
                style={{ flexDirection: 'row', backgroundColor: color.paper, ...border }}
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
                backgroundColor: pressed ? color.tint : color.paper,
                ...border,
              })}
            >
              {cells}
            </Pressable>
          );
        })}
    </Frame>
  );
}

/**
 * The table's outer shell. Loading, empty and populated all render inside it,
 * so a table cannot change shape as it resolves — only its contents change.
 */
function Frame({ children, minWidth }: { children: ReactNode; minWidth?: number }) {
  return (
    // `flexGrow` on the content container lets the frame fill the measure when
    // there is room, while `minWidth` still forces a scroll when there is not.
    // Column widths stay fixed either way.
    <ScrollView horizontal showsHorizontalScrollIndicator style={{ flexGrow: 0 }} contentContainerStyle={{ flexGrow: 1 }}>
      <View
        style={{
          flex: 1,
          minWidth,
          borderWidth: 1,
          borderColor: color.line,
          borderRadius: radius.md,
          overflow: 'hidden',
          backgroundColor: color.paper,
        }}
      >
        {children}
      </View>
    </ScrollView>
  );
}

function HeaderRow<T>({
  columns,
  sort,
  onSort,
}: {
  columns: Column<T>[];
  sort: { key: string; direction: Direction } | null;
  onSort?: (update: (current: { key: string; direction: Direction } | null) => { key: string; direction: Direction }) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: color.paper }}>
      {columns.map((column) => {
        const sortable = Boolean(column.sortValue) && Boolean(onSort);
        const active = sort?.key === column.key;
        return (
          <Pressable
            key={column.key}
            accessibilityRole={sortable ? 'button' : undefined}
            disabled={!sortable}
            onPress={() =>
              onSort?.((current) =>
                current?.key === column.key
                  ? { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
                  : { key: column.key, direction: column.numeric ? 'desc' : 'asc' },
              )
            }
            style={{
              width: column.width,
              paddingHorizontal: layout.rowX,
              // Tighter than a row, so the header reads as one rather than as
              // a first row that happens to be shouting.
              paddingVertical: layout.headerY,
              borderBottomWidth: 1,
              borderBottomColor: color.line,
              backgroundColor: color.paper,
              alignItems: column.numeric ? 'flex-end' : 'flex-start',
            }}
          >
            <Text size="micro" weight="medium" numeric tone={active ? 'default' : 'faint'} style={{ letterSpacing: tracking.label }}>
              {column.header.toUpperCase()}
              {active ? (sort?.direction === 'asc' ? ' ↑' : ' ↓') : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

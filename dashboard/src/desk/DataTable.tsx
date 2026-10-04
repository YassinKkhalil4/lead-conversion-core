import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Skeleton } from '@/design/Skeleton';
import { EmptyState } from '@/design/StateBlock';
import { Text } from '@/design/Text';
import { color, layout, radius } from '@/design/tokens';
import { DESK_BREAKPOINT } from '@/desk/Page';
import { Icon } from '@/design/Icon';
import { isHovered, surfaceTransition } from '@/design/motion';

export interface Column<T> {
  key: string;
  header: string;
  width: number;
  /** Right-aligned by convention for numbers, which are tabular. */
  numeric?: boolean;
  /** Returning null makes the column unsortable. */
  sortValue?: (row: T) => string | number | null;
  /**
   * Lower-value columns the table may drop, right to left, when the full set
   * does not fit the window. The table says which it dropped, and the same
   * values stay reachable in the row's own form.
   */
  optional?: boolean;
  render: (row: T) => ReactNode;
}

/** The side rail's width, which wide screens spend before the table sees any. */
const RAIL = 232;

/** Drops optional columns, last first, until the rest fit `available`. */
export function fitColumns<T>(columns: Column<T>[], available: number): { shown: Column<T>[]; hidden: Column<T>[] } {
  const shown = [...columns];
  const hidden: Column<T>[] = [];
  const total = () => shown.reduce((sum, column) => sum + column.width, 0);
  while (total() > available) {
    const index = [...shown].reverse().findIndex((column) => column.optional);
    if (index === -1) break;
    const at = shown.length - 1 - index;
    hidden.unshift(...shown.splice(at, 1));
  }
  return { shown, hidden };
}

type Direction = 'asc' | 'desc';

/**
 * A desk-width table. The salesperson queue is a list of rows because it is read
 * one-handed on a phone; this is read at a desk, where columns and sorting are
 * what make a team comparable.
 *
 * Columns keep fixed minimum widths and the table scrolls sideways when they
 * do not fit. The exception is a column marked `optional`: those drop out,
 * last first, only when the window cannot hold the full set, and a footnote
 * names whatever was dropped so nothing disappears without a word.
 */
export function DataTable<T>({
  rows,
  columns: allColumns,
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
  const { width: windowWidth } = useWindowDimensions();
  const desk = windowWidth >= DESK_BREAKPOINT;
  const available = windowWidth - (desk ? RAIL + layout.pageDesk * 2 : layout.pagePhone * 2) - 2;
  const { shown: columns, hidden } = useMemo(() => fitColumns(allColumns, available), [allColumns, available]);

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
                  ...cellBox(column.width),
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
                ...cellBox(column.width),
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
              style={(state) => ({
                flexDirection: 'row',
                backgroundColor: state.pressed || isHovered(state) ? color.tint : color.paper,
                ...border,
                ...surfaceTransition(),
              })}
            >
              {cells}
            </Pressable>
          );
        })}
      {hidden.length > 0 ? (
        <View style={{ paddingHorizontal: layout.rowX, paddingVertical: layout.rowY - 2, borderTopWidth: 1, borderTopColor: color.line2 }}>
          <Text size="micro" tone="faint">
            {hidden.length === 1 ? '1 column is' : `${hidden.length} columns are`} hidden at this width: {hidden.map((column) => column.header).join(', ')}.
          </Text>
        </View>
      ) : null}
    </Frame>
  );
}

/**
 * A column's box: it never shrinks below its width, and any spare width in the
 * frame is shared equally, so the grid fills the measure instead of leaving a
 * ragged gap on the right. Header, body and skeleton cells use the same box, so
 * their edges always line up.
 */
function cellBox(width: number) {
  return { flexBasis: width, minWidth: width, flexGrow: 1, flexShrink: 0 } as const;
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
          borderRadius: radius.lg,
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
    <View style={{ flexDirection: 'row', backgroundColor: color.paper, borderBottomWidth: 1, borderBottomColor: color.line }}>
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
              ...cellBox(column.width),
              paddingHorizontal: layout.rowX,
              // Tighter than a row, so the header reads as one rather than as
              // a first row that happens to be shouting.
              paddingVertical: layout.headerY,
              backgroundColor: color.paper,
              alignItems: column.numeric ? 'flex-end' : 'flex-start',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text size="small" weight="medium" tone={active ? 'default' : 'faint'}>
                {column.header}
              </Text>
              {active ? <Icon name={sort?.direction === 'asc' ? 'arrowUp' : 'arrowDown'} size={12} color={color.ink} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

import { useState, type ReactNode } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { ApiError } from '@/api/client';
import { Text } from '@/design/Text';
import { color, fontFamily, fontSize, hitSlop, radius, space, tracking } from '@/design/tokens';

/**
 * Field-level errors from the API's `issues` array, keyed by the field they
 * name. A server rejection should land on the field that caused it rather than
 * as a banner the reader has to map back themselves.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const issues = error.details.issues;
  if (!Array.isArray(issues)) return {};
  const mapped: Record<string, string> = {};
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') continue;
    const path = (issue as { path?: unknown[] }).path;
    const message = (issue as { message?: unknown }).message;
    const field = Array.isArray(path) ? path.map(String).join('.') : '';
    if (field && typeof message === 'string' && !mapped[field]) mapped[field] = message;
  }
  return mapped;
}

export function Field({
  label,
  hint,
  error,
  children,
  width,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
  width?: number | `${number}%`;
}) {
  return (
    <View style={{ gap: space.sm, flexGrow: 1, flexBasis: width ?? 240 }}>
      <Text size="micro" weight="semibold" tone="muted" style={{ textTransform: 'uppercase', letterSpacing: tracking.label }}>
        {label}
      </Text>
      {children}
      {hint && !error ? (
        <Text size="micro" tone="faint">
          {hint}
        </Text>
      ) : null}
      {error ? (
        <Text size="micro" style={{ color: color.warn }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  invalid = false,
  keyboardType,
  autoCapitalize = 'sentences',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric';
  autoCapitalize?: 'none' | 'sentences' | 'words';
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder ?? ''}
      placeholderTextColor={color.ink3}
      keyboardType={keyboardType ?? 'default'}
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      style={{
        fontFamily,
        fontSize: fontSize.body,
        color: color.ink,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: invalid ? color.warn : color.line,
        borderRadius: radius.md,
        paddingHorizontal: space.lg,
        minHeight: 42,
      }}
    />
  );
}

const groupDigits = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Prices are read and typed with thousands separators. The grouping is applied
 * as the reader types and stripped before the value leaves, so the form state
 * is always a number and the display is always readable.
 */
export function MoneyField({
  value,
  onChange,
  invalid = false,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  invalid?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : groupDigits(String(value)));

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <TextInput
        value={text}
        onChangeText={(next) => {
          const digits = next.replace(/[^\d]/g, '');
          setText(digits ? groupDigits(digits) : '');
          onChange(digits ? Number(digits) : null);
        }}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={color.ink3}
        style={{
          flex: 1,
          fontFamily,
          fontSize: fontSize.body,
          fontVariant: ['tabular-nums'],
          color: color.ink,
          backgroundColor: color.paper,
          borderWidth: 1,
          borderColor: invalid ? color.warn : color.line,
          borderRadius: radius.md,
          paddingHorizontal: space.lg,
          minHeight: 42,
        }}
      />
      <Text size="small" tone="faint">
        EGP
      </Text>
    </View>
  );
}

export function NumberField({
  value,
  onChange,
  invalid = false,
}: {
  value: number;
  onChange: (value: number) => void;
  invalid?: boolean;
}) {
  return (
    <TextInput
      value={String(value)}
      onChangeText={(next) => {
        const digits = next.replace(/[^\d]/g, '');
        onChange(digits ? Number(digits) : 0);
      }}
      keyboardType="numeric"
      style={{
        fontFamily,
        fontSize: fontSize.body,
        fontVariant: ['tabular-nums'],
        color: color.ink,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: invalid ? color.warn : color.line,
        borderRadius: radius.md,
        paddingHorizontal: space.lg,
        minHeight: 42,
        maxWidth: 140,
      }}
    />
  );
}

/**
 * Multi-value entry as discrete tags. A comma-separated text field looks
 * simpler and then silently disagrees with the reader about whether a trailing
 * space or an empty segment counts.
 */
export function TagInput({
  values,
  onChange,
  placeholder,
  suggestions = [],
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const value = raw.trim();
    if (!value || values.includes(value)) {
      setDraft('');
      return;
    }
    onChange([...values, value]);
    setDraft('');
  };

  const unused = suggestions.filter((entry) => !values.includes(entry));

  return (
    <View style={{ gap: space.md }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: space.sm,
          borderWidth: 1,
          borderColor: color.line,
          borderRadius: radius.md,
          padding: space.md,
          backgroundColor: color.paper,
          minHeight: 42,
        }}
      >
        {values.map((value) => (
          <View
            key={value}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              backgroundColor: color.tint,
              borderRadius: radius.sm,
              paddingStart: space.md,
              paddingEnd: space.sm,
              paddingVertical: 3,
            }}
          >
            <Text size="small">{value}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${value}`}
              hitSlop={hitSlop}
              onPress={() => onChange(values.filter((entry) => entry !== value))}
            >
              <Text size="small" tone="faint">
                ×
              </Text>
            </Pressable>
          </View>
        ))}
        <TextInput
          value={draft}
          onChangeText={(next) => (next.endsWith(',') ? add(next.slice(0, -1)) : setDraft(next))}
          onSubmitEditing={() => add(draft)}
          onBlur={() => add(draft)}
          blurOnSubmit={false}
          placeholder={values.length === 0 ? (placeholder ?? 'Type and press enter') : ''}
          placeholderTextColor={color.ink3}
          autoCapitalize="words"
          autoCorrect={false}
          style={{
            flexGrow: 1,
            minWidth: 120,
            fontFamily,
            fontSize: fontSize.body,
            color: color.ink,
            paddingVertical: space.xs,
          }}
        />
      </View>

      {unused.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {unused.map((entry) => (
            <Pressable
              key={entry}
              accessibilityRole="button"
              onPress={() => add(entry)}
              style={({ pressed }) => ({
                borderWidth: 1,
                borderColor: color.line2,
                borderRadius: radius.sm,
                paddingHorizontal: space.md,
                paddingVertical: 2,
                backgroundColor: pressed ? color.line2 : 'transparent',
              })}
            >
              <Text size="micro" tone="muted">
                + {entry}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function Toggle({
  value,
  onChange,
  labels,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  labels: [string, string];
}) {
  return (
    <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: color.line, borderRadius: radius.md, overflow: 'hidden', alignSelf: 'flex-start' }}>
      {[true, false].map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={String(option)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={({ pressed }) => ({
              minHeight: 42,
              justifyContent: 'center',
              paddingHorizontal: space.xl,
              backgroundColor: selected ? color.accent : pressed ? color.tint : color.paper,
            })}
          >
            <Text size="small" weight="semibold" style={{ color: selected ? color.onAccent : color.ink2 }}>
              {option ? labels[0] : labels[1]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A desk form lays fields out in rows that wrap, not one per line. */
export function FormRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xl }}>{children}</View>;
}

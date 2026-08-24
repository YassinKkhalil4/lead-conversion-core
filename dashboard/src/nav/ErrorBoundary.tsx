import { Component, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { Button } from '@/design/Button';
import { Text } from '@/design/Text';
import { color, radius, space } from '@/design/tokens';

interface Props {
  children: ReactNode;
  /** Clears anything that could have caused a bad render, such as a stale cache. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * A render error in one screen should cost that screen, not the session.
 *
 * Without this, a single unguarded property read unmounts the whole tree and
 * leaves a blank page with no way back — which is what a missing field in a
 * cached response did to the manager overview.
 */
export class ScreenErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    // eslint-disable-next-line no-console
    console.error('Screen render failed', error);
  }

  private reset = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: color.tint }}
        contentContainerStyle={{ padding: space.xxl, gap: space.lg }}
      >
        <Text size="title" weight="bold">
          This screen could not be drawn
        </Text>
        <Text size="small" tone="muted">
          The rest of the app is still working — use the navigation to move somewhere else, or try
          this screen again. If it keeps happening, clearing the saved data below usually fixes it,
          because the most common cause is information saved on this device from an older version.
        </Text>

        <View
          style={{
            backgroundColor: color.tint,
            borderRadius: radius.md,
            padding: space.lg,
            borderStartWidth: 3,
            borderStartColor: color.warn,
          }}
        >
          <Text size="micro" tone="muted" numeric>
            {error.message}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Button label="Try this screen again" variant="primary" onPress={this.reset} />
        </View>
      </ScrollView>
    );
  }
}

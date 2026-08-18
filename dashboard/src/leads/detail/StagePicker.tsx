import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/design/Text';
import { color, hitSlop, radius, space } from '@/design/tokens';
import { PIPELINE_STAGES, stageLabel } from '@/leads/labels';

/**
 * Where the lead sits in the pipeline, and a way to move it.
 *
 * Deliberately quiet: it is one line of text beside the current stage, not a
 * row of buttons. The dominant action on this screen is acknowledging or
 * calling, and six stage buttons would drown it.
 */
export function StagePicker({
  stage,
  busy,
  onChange,
}: {
  stage: string;
  busy: boolean;
  onChange: (stage: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingTop: space.lg,
      }}
    >
      <Text size="micro" tone="faint" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Stage
      </Text>
      <Text size="small" weight="semibold" style={{ flex: 1 }}>
        {stageLabel(stage)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Change stage, currently ${stageLabel(stage)}`}
        onPress={() => setOpen(true)}
        disabled={busy}
        hitSlop={hitSlop}
      >
        <Text
          size="small"
          weight="semibold"
          tone="muted"
          style={{ textDecorationLine: 'underline', opacity: busy ? 0.4 : 1 }}
        >
          {busy ? 'Saving…' : 'Change'}
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(12,11,9,0.4)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              backgroundColor: color.surface,
              borderTopLeftRadius: radius.md,
              borderTopRightRadius: radius.md,
              paddingTop: space.xl,
              paddingBottom: insets.bottom + space.xl,
            }}
          >
            <Text size="body" weight="semibold" style={{ paddingHorizontal: space.xl, paddingBottom: space.lg }}>
              Move this lead to
            </Text>
            {PIPELINE_STAGES.map((option) => {
              const selected = option === stage;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setOpen(false);
                    if (!selected) onChange(option);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.lg,
                    paddingHorizontal: space.xl,
                    paddingVertical: space.lg,
                    borderTopWidth: 1,
                    borderTopColor: color.hairline,
                    backgroundColor: pressed ? color.surfacePressed : 'transparent',
                  })}
                >
                  <Text size="body" weight={selected ? 'semibold' : 'regular'} style={{ flex: 1 }}>
                    {stageLabel(option)}
                  </Text>
                  {selected ? (
                    <Text size="micro" tone="faint" style={{ letterSpacing: 0.4 }}>
                      CURRENT
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

import { useCallback, useState } from 'react';
import { words } from '@/profile/words';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Label, Text } from '@/design/Text';
import { color, hitSlop, radius, space, tracking } from '@/design/tokens';
import { PIPELINE_STAGES, stageLabel } from '@/leads/labels';
import { useProfile } from '@/profile/ProfileProvider';
import { enter, exit, useDismiss, useReducedMotion } from '@/design/motion';

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
  stage: string | null | undefined;
  busy: boolean;
  onChange: (stage: string) => void;
}) {
  const profile = useProfile();
  const w = (s: string) => words(s, profile.terms);
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const closeNow = useCallback(() => setOpen(false), []);
  const { closing, dismiss } = useDismiss(closeNow, reduced);
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
      <Label>Stage</Label>
      <Text size="small" weight="semibold" style={{ flex: 1 }}>
        {stageLabel(stage, profile)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Change stage, currently ${stageLabel(stage, profile)}`}
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

      <Modal visible={open} transparent animationType="fade" onRequestClose={dismiss}>
        <Pressable
          onPress={dismiss}
          style={[{ flex: 1, backgroundColor: color.scrim, justifyContent: 'flex-end' }, closing ? exit('scrim') : null]}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={[{
              backgroundColor: color.paper,
              borderTopLeftRadius: radius.md,
              borderTopRightRadius: radius.md,
              paddingTop: space.xl,
              paddingBottom: insets.bottom + space.xl,
            }, closing ? exit('sheet') : enter('sheet', reduced)]}
          >
            <Text size="body" weight="semibold" style={{ paddingHorizontal: space.xl, paddingBottom: space.lg }}>
              {w('Move this {lead} to')}
            </Text>
            {PIPELINE_STAGES.map((option) => {
              const selected = option === stage;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    dismiss();
                    if (!selected) onChange(option);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.lg,
                    paddingHorizontal: space.xl,
                    paddingVertical: space.lg,
                    borderTopWidth: 1,
                    borderTopColor: color.line2,
                    backgroundColor: pressed ? color.line2 : 'transparent',
                  })}
                >
                  <Text size="body" weight={selected ? 'semibold' : 'regular'} style={{ flex: 1 }}>
                    {stageLabel(option, profile)}
                  </Text>
                  {selected ? (
                    <Text size="micro" tone="faint" style={{ letterSpacing: tracking.label }}>
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

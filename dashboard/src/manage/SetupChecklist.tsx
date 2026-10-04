import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/design/Button';
import { Text } from '@/design/Text';
import { color, layout, radius, space } from '@/design/tokens';
import { useProjects, useSalespeople, useUsers } from '@/manage/hooks';
import { setupProgress, type SetupStep } from '@/manage/setup';
import { Icon } from '@/design/Icon';

const DISMISSED_KEY = 'kadensio.setup.dismissed';

/**
 * First-run guide on the manager overview. It lists what routing needs before
 * a qualified lead can reach anyone, links each step to the screen that does
 * it, and disappears once everything is in place. It can be hidden early; the
 * choice is remembered on this device.
 */
export function SetupChecklist() {
  const router = useRouter();
  const { user } = useAuth();
  const role = user?.role ?? 'manager';
  const projects = useProjects();
  const salespeople = useSalespeople();
  const users = useUsers(role === 'admin');
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(DISMISSED_KEY)
      .then((stored) => {
        if (active) setDismissed(stored === '1');
      })
      .catch(() => {
        if (active) setDismissed(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const progress = setupProgress({
    role,
    projects: projects.data?.projects,
    salespeople: salespeople.data?.salespeople,
    users: users.data?.users,
  });

  if (dismissed !== false || !progress || progress.complete) return null;

  const hide = () => {
    setDismissed(true);
    void AsyncStorage.setItem(DISMISSED_KEY, '1').catch(() => undefined);
  };

  return (
    <View
      accessibilityRole="summary"
      style={{
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: radius.md,
        backgroundColor: color.paper,
        padding: layout.panel,
        gap: space.lg,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.lg }}>
        <View style={{ flexShrink: 1, gap: space.xs }}>
          <Text size="title" weight="semibold">
            Get routing ready
          </Text>
          <Text size="small" tone="muted">
            {`${progress.doneCount} of ${progress.steps.length} done. Until these are in place, every qualified lead escalates to your manager.`}
          </Text>
        </View>
        <Button label="Hide" variant="text" onPress={hide} />
      </View>
      <View style={{ gap: space.xs }}>
        {progress.steps.map((step, index) => (
          <StepRow key={step.key} step={step} number={index + 1} onOpen={(href) => router.push(href)} />
        ))}
      </View>
    </View>
  );
}

function StepRow({ step, number, onOpen }: { step: SetupStep; number: number; onOpen: (href: string) => void }) {
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.lg, paddingVertical: space.md }}>
      <View
        style={{
          width: 22,
          height: 22,
          marginTop: 1,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: step.done ? color.accent : color.paper,
          borderWidth: step.done ? 0 : 1,
          borderColor: color.lineStrong,
        }}
      >
        {step.done ? (
          <Icon name="check" size={12} color={color.onAccent} />
        ) : (
          <Text size="micro" weight="semibold" style={{ color: color.ink2 }}>
            {String(number)}
          </Text>
        )}
      </View>
      <View style={{ flex: 1, gap: space.hair }}>
        <Text
          size="label"
          weight="semibold"
          tone={step.done ? 'muted' : 'default'}
          style={step.done ? { textDecorationLine: 'line-through' } : undefined}
        >
          {step.title}
        </Text>
        {!step.done ? (
          <Text size="small" tone="muted">
            {step.detail}
          </Text>
        ) : null}
      </View>
      {!step.done && step.action ? (
        <Text size="small" weight="semibold" style={{ color: color.accent }}>
          {step.action}
        </Text>
      ) : null}
    </View>
  );
  if (step.done || !step.href) return content;
  const href = step.href;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${step.title}. ${step.action ?? ''}`}
      onPress={() => onOpen(href)}
      style={({ pressed }) => ({ borderRadius: radius.sm, backgroundColor: pressed ? color.tint : 'transparent' })}
    >
      {content}
    </Pressable>
  );
}

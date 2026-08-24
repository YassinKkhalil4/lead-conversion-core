import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { zodResolver } from '@hookform/resolvers/zod';
import { Redirect } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';
import { explain } from '@/api/errors';
import { useAuth } from '@/auth/AuthProvider';
import { homeFor } from '@/nav/routes';
import { Button } from '@/design/Button';
import { Mark } from '@/design/Mark';
import { ErrorState } from '@/design/StateBlock';
import { Text } from '@/design/Text';
import { color, fontFamily, fontSize, radius, space, tracking } from '@/design/tokens';

const schema = z.object({
  email: z.string().min(1, 'Enter your email address').email('That is not a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

type FormValues = z.infer<typeof schema>;

export default function Login() {
  const { status, user, signIn } = useAuth();
  const [failure, setFailure] = useState<unknown>(null);
  const insets = useSafeAreaInsets();

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
    mode: 'onBlur',
  });

  if (status === 'authenticated' && user) return <Redirect href={homeFor(user.role)} />;

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      await signIn(values);
    } catch (error) {
      setFailure(error);
    }
  });

  const explained = failure ? explain(failure, 'Sign-in') : null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + space.xxxl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ paddingHorizontal: space.xl, gap: space.lg }}>
          <Mark size={40} />
          <View style={{ gap: space.xs }}>
            <Text size="title" weight="bold">
              Kadensio
            </Text>
            <Text size="small" tone="muted">
              Lead inbox for WhatsApp qualification.
            </Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: space.xl, paddingTop: space.xxxl, gap: space.xl }}>
          <Field
            control={control}
            name="email"
            label="Email"
            error={errors.email?.message}
            inputProps={{
              autoCapitalize: 'none',
              autoComplete: 'email',
              autoCorrect: false,
              inputMode: 'email',
              keyboardType: 'email-address',
              textContentType: 'username',
              returnKeyType: 'next',
            }}
          />
          <Field
            control={control}
            name="password"
            label="Password"
            error={errors.password?.message}
            inputProps={{
              autoCapitalize: 'none',
              autoComplete: 'current-password',
              secureTextEntry: true,
              textContentType: 'password',
              returnKeyType: 'go',
              onSubmitEditing: () => void onSubmit(),
            }}
          />
        </View>

        {explained ? (
          <ErrorState title={explained.title} detail={explained.detail} />
        ) : null}

        <View style={{ flex: 1 }} />

        <View style={{ paddingHorizontal: space.xl, paddingBottom: space.lg }}>
          <Text size="micro" tone="faint">
            Accounts are created by your admin. There is no self-service sign-up.
          </Text>
        </View>
      </ScrollView>

      {/* Primary action sits at the bottom, inside thumb reach. */}
      <View
        style={{
          paddingHorizontal: space.xl,
          paddingTop: space.lg,
          paddingBottom: insets.bottom + space.lg,
          borderTopWidth: 1,
          borderTopColor: color.hairline,
          backgroundColor: color.surface,
        }}
      >
        <Button label={isSubmitting ? 'Signing in…' : 'Sign in'} variant="primary" grow busy={isSubmitting} onPress={() => void onSubmit()} />
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({
  control,
  name,
  label,
  error,
  inputProps,
}: {
  control: ReturnType<typeof useForm<FormValues>>['control'];
  name: keyof FormValues;
  label: string;
  error?: string;
  inputProps?: React.ComponentProps<typeof TextInput>;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <Text size="micro" weight="semibold" tone="muted" style={{ letterSpacing: tracking.label, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Controller
        control={control}
        name={name}
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            {...inputProps}
            accessibilityLabel={label}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholderTextColor={color.inkPlaceholder}
            style={{
              fontFamily,
              fontSize: fontSize.body,
              color: color.ink,
              backgroundColor: color.surface,
              borderWidth: 1,
              borderColor: error ? color.alert : color.hairlineStrong,
              borderRadius: radius.md,
              paddingHorizontal: space.lg,
              minHeight: 46,
            }}
          />
        )}
      />
      {error ? (
        <Text size="micro" style={{ color: color.alert }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

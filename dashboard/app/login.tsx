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
import { Lockup } from '@/design/Mark';
import { ErrorState } from '@/design/StateBlock';
import { Text } from '@/design/Text';
import { color, fontFamily, fontSize, layout, radius, space, tracking } from '@/design/tokens';
import { useIsDesk } from '@/desk/Page';

const schema = z.object({
  email: z.string().min(1, 'Enter your email address').email('That is not a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

type FormValues = z.infer<typeof schema>;

export default function Login() {
  const { status, user, signIn } = useAuth();
  const [failure, setFailure] = useState<unknown>(null);
  const insets = useSafeAreaInsets();
  const isDesk = useIsDesk();

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

  const fields = (
    <>
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
    </>
  );

  const submitLabel = isSubmitting ? 'Signing in…' : 'Sign in';

  /**
   * At desk width the same form spanned the whole window — a 1250-point field
   * for a 40-character address. It becomes a measured column instead. The phone
   * layout below is unchanged: full-bleed fields and a button pinned in thumb
   * reach is already right for a phone, and a card would only shrink both.
   */
  if (isDesk) {
    return (
      <View style={{ flex: 1, backgroundColor: color.tint }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: layout.pageDesk }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ width: '100%', maxWidth: 400, gap: layout.sectionGap }}>
            <View style={{ gap: layout.rowY }}>
              <Lockup height={30} />
              <Text size="body" tone="muted">
                Lead inbox for WhatsApp qualification.
              </Text>
            </View>

            <View
              style={{
                padding: layout.panel,
                gap: layout.panel,
                borderWidth: 1,
                borderColor: color.line2,
                borderRadius: radius.md,
                backgroundColor: color.paper,
              }}
            >
              {fields}
              {explained ? (
                <View style={{ gap: space.xs }}>
                  <Text size="small" weight="semibold" style={{ color: color.warn }}>
                    {explained.title}
                  </Text>
                  <Text size="small" tone="muted">
                    {explained.detail}
                  </Text>
                </View>
              ) : null}
              <Button label={submitLabel} variant="primary" grow busy={isSubmitting} onPress={() => void onSubmit()} />
            </View>

            <Text size="micro" tone="faint">
              Accounts are created by your admin. There is no self-service sign-up.
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.tint }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + space.xxxl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ paddingHorizontal: space.xl, gap: space.lg }}>
          <Lockup height={28} />
          <Text size="body" tone="muted">
            Lead inbox for WhatsApp qualification.
          </Text>
        </View>

        <View style={{ paddingHorizontal: space.xl, paddingTop: space.xxxl, gap: space.xl }}>
          {fields}
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
          borderTopColor: color.line2,
          backgroundColor: color.paper,
        }}
      >
        <Button label={submitLabel} variant="primary" grow busy={isSubmitting} onPress={() => void onSubmit()} />
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
            placeholderTextColor={color.ink3}
            style={{
              fontFamily,
              fontSize: fontSize.body,
              color: color.ink,
              backgroundColor: color.paper,
              borderWidth: 1,
              borderColor: error ? color.warn : color.line,
              borderRadius: radius.md,
              paddingHorizontal: space.lg,
              minHeight: 46,
            }}
          />
        )}
      />
      {error ? (
        <Text size="micro" style={{ color: color.warn }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

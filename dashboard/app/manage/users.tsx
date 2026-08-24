import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { explain } from '@/api/errors';
import type { ManagedUser, Role, Salesperson } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/design/Button';
import { ErrorState } from '@/design/StateBlock';
import { Text } from '@/design/Text';
import { colWidth, color, radius, space } from '@/design/tokens';
import { type Column, DataTable } from '@/desk/DataTable';
import { Field, FormRow, TextField, fieldErrors } from '@/desk/form';
import { Page, Section } from '@/desk/Page';
import { countLabel } from '@/desk/safe';
import { RequireRole } from '@/nav/RequireRole';
import { useCreateUser, useSalespeople, useUpdateUser, useUsers } from '@/manage/hooks';
import { timestamp } from '@/time/format';

const ROLES: Role[] = ['admin', 'manager', 'salesperson'];

/**
 * A password the admin can hand over once. The backend has no email delivery,
 * so this mirrors what the CLI does: generate, show once, never store.
 */
function generatePassword(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = globalThis.crypto.getRandomValues(new Uint32Array(20));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

export default function UsersScreen() {
  return (
    <RequireRole allowed={['admin']}>
      <UsersInner />
    </RequireRole>
  );
}

function UsersInner() {
  const { user: currentUser } = useAuth();
  const users = useUsers();
  const salespeople = useSalespeople();
  const create = useCreateUser();
  const update = useUpdateUser();

  const [inviting, setInviting] = useState(false);
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const byId = new Map((salespeople.data?.salespeople ?? []).map((person) => [person.salespersonId, person]));

  const columns: Column<ManagedUser>[] = [
    {
      key: 'name',
      header: 'Name',
      width: colWidth.name,
      sortValue: (row) => row.name,
      render: (row) => (
        <View style={{ gap: 1 }}>
          <Text size="small" weight="semibold" numberOfLines={1}>
            {row.name}
          </Text>
          {row.userId === currentUser?.userId ? (
            <Text size="micro" tone="faint">
              you
            </Text>
          ) : null}
        </View>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      width: colWidth.wide,
      sortValue: (row) => row.email,
      render: (row) => (
        <Text size="small" tone="muted" numberOfLines={1}>
          {row.email}
        </Text>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      width: colWidth.short,
      sortValue: (row) => row.role,
      render: (row) => <Text size="small">{row.role}</Text>,
    },
    {
      key: 'salesperson',
      header: 'Salesperson record',
      width: colWidth.name,
      sortValue: (row) => (row.salespersonId ? (byId.get(row.salespersonId)?.name ?? 'unknown') : null),
      render: (row) => (
        <Text size="small" tone={row.salespersonId ? 'muted' : 'faint'} numberOfLines={1}>
          {row.salespersonId ? (byId.get(row.salespersonId)?.name ?? 'Unknown record') : '—'}
        </Text>
      ),
    },
    {
      key: 'lastLogin',
      header: 'Last login',
      width: colWidth.medium,
      numeric: true,
      sortValue: (row) => (row.lastLoginAt ? Date.parse(row.lastLoginAt) : null),
      render: (row) => (
        <Text size="small" numeric tone={row.lastLoginAt ? 'muted' : 'faint'}>
          {row.lastLoginAt ? timestamp(row.lastLoginAt) : 'never'}
        </Text>
      ),
    },
    {
      key: 'active',
      header: 'Status',
      width: colWidth.medium,
      sortValue: (row) => (row.active ? 1 : 0),
      render: (row) => {
        const isSelf = row.userId === currentUser?.userId;
        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Text size="small" tone={row.active ? 'default' : 'faint'}>
              {row.active ? 'Active' : 'Inactive'}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={isSelf || update.isPending}
              onPress={() => {
                setActionError(null);
                update
                  .mutateAsync({ userId: row.userId, values: { active: !row.active } })
                  .catch(setActionError);
              }}
            >
              <Text
                size="micro"
                tone={isSelf ? 'faint' : 'muted'}
                style={{ textDecorationLine: isSelf ? 'none' : 'underline' }}
              >
                {isSelf ? 'cannot change own' : row.active ? 'Deactivate' : 'Reactivate'}
              </Text>
            </Pressable>
          </View>
        );
      },
    },
  ];

  return (
    <Page
      title="Users"
      subtitle="Who can sign in to this dashboard. Accounts are never deleted, only deactivated."
      actions={<Button label="Invite user" variant="primary" onPress={() => setInviting(true)} />}
    >
      {actionError ? (
        <ErrorState
          title={explain(actionError, 'That change').title}
          detail={explain(actionError, 'That change').detail}
        />
      ) : null}

      {users.isError ? (
        <ErrorState
          title="Could not load users"
          detail={explain(users.error, 'Loading users').detail}
          onRetry={() => void users.refetch()}
        />
      ) : (
        <Section title={`${countLabel(users.data?.users?.length)} accounts`}>
          <DataTable
            rows={users.data?.users ?? []}
            loading={users.isLoading}
            emptyActionLabel="Invite user"
            onEmptyAction={() => setInviting(true)}
            keyOf={(row) => row.userId}
            initialSort={{ key: 'name', direction: 'asc' }}
            emptyTitle="No users yet"
            emptyDetail="Every person who signs in needs an account here. Salespeople need one too — a salesperson record on its own receives WhatsApp notifications but cannot open the dashboard."
            columns={columns}
          />
        </Section>
      )}

      {inviting ? (
        <InviteForm
          salespeople={salespeople.data?.salespeople ?? []}
          busy={create.isPending}
          error={create.error}
          onCancel={() => {
            create.reset();
            setInviting(false);
          }}
          onSubmit={async (values) => {
            const password = generatePassword();
            await create.mutateAsync({ ...values, password });
            setInviting(false);
            setIssued({ email: values.email, password });
          }}
        />
      ) : null}

      {issued ? <PasswordIssued issued={issued} onClose={() => setIssued(null)} /> : null}
    </Page>
  );
}

function InviteForm({
  salespeople,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  salespeople: Salesperson[];
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onSubmit: (values: { email: string; name: string; role: Role; salespersonId: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('salesperson');
  const [salespersonId, setSalespersonId] = useState<string | null>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const serverErrors = fieldErrors(error);
  const errors = { ...serverErrors, ...localErrors };
  const explained = error && Object.keys(serverErrors).length === 0 ? explain(error, 'Creating the user') : null;

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'A name is required.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (role === 'salesperson' && !salespersonId) {
      next.salespersonId = 'A salesperson account must map to a salesperson record.';
    }
    setLocalErrors(next);
    if (Object.keys(next).length > 0) return;
    await onSubmit({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role,
      salespersonId: role === 'salesperson' ? salespersonId : null,
    });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable onPress={onCancel} style={{ flex: 1, backgroundColor: color.scrim, padding: space.xl, justifyContent: 'center' }}>
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{ backgroundColor: color.paper, borderRadius: radius.md, maxWidth: 640, width: '100%', alignSelf: 'center', maxHeight: '90%' }}
        >
          <ScrollView contentContainerStyle={{ padding: space.xxl, gap: space.xl }}>
            <View style={{ gap: space.xs }}>
              <Text size="title" weight="bold">
                Invite user
              </Text>
              <Text size="small" tone="muted">
                There is no email delivery, so a password is generated and shown once when the account is created. Copy it and send it yourself.
              </Text>
            </View>

            <FormRow>
              <Field label="Name" error={errors.name}>
                <TextField value={name} onChange={setName} invalid={Boolean(errors.name)} autoCapitalize="words" />
              </Field>
              <Field label="Email" error={errors.email}>
                <TextField value={email} onChange={setEmail} invalid={Boolean(errors.email)} keyboardType="email-address" autoCapitalize="none" />
              </Field>
            </FormRow>

            <Field label="Role" hint="Salespeople see only their own leads. Managers see the whole client. Admins add user management.">
              <View style={{ flexDirection: 'row', gap: space.md, flexWrap: 'wrap' }}>
                {ROLES.map((option) => {
                  const selected = option === role;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setRole(option)}
                      style={({ pressed }) => ({
                        minHeight: 42,
                        justifyContent: 'center',
                        paddingHorizontal: space.xl,
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: selected ? color.accent : color.line,
                        backgroundColor: selected ? color.accent : pressed ? color.tint : color.paper,
                      })}
                    >
                      <Text size="small" weight="semibold" style={{ color: selected ? color.onAccent : color.ink2 }}>
                        {option}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>

            {role === 'salesperson' ? (
              <Field
                label="Salesperson record"
                hint="Which record this login represents. It decides which leads they see."
                error={errors.salespersonId}
              >
                {salespeople.length === 0 ? (
                  <Text size="small" tone="faint">
                    No salespeople exist yet. Add one under Salespeople first.
                  </Text>
                ) : (
                  <View style={{ gap: space.sm }}>
                    {salespeople.map((person) => {
                      const selected = person.salespersonId === salespersonId;
                      return (
                        <Pressable
                          key={person.salespersonId}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          onPress={() => setSalespersonId(person.salespersonId)}
                          style={({ pressed }) => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: space.md,
                            padding: space.md,
                            borderRadius: radius.sm,
                            borderWidth: 1,
                            borderColor: selected ? color.accent : color.line2,
                            backgroundColor: pressed ? color.line2 : color.paper,
                          })}
                        >
                          <Text size="small" weight={selected ? 'semibold' : 'regular'} style={{ flex: 1 }}>
                            {person.name}
                          </Text>
                          <Text size="micro" tone="faint" numeric>
                            {person.phoneE164}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </Field>
            ) : null}

            {explained ? <ErrorState title={explained.title} detail={explained.detail} /> : null}

            <View style={{ flexDirection: 'row', gap: space.md, justifyContent: 'flex-end' }}>
              <Button label="Cancel" variant="outline" onPress={onCancel} />
              <Button label="Create account" variant="primary" busy={busy} onPress={() => void submit()} />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PasswordIssued({
  issued,
  onClose,
}: {
  issued: { email: string; password: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: color.scrim, padding: space.xl, justifyContent: 'center' }}>
        <View
          style={{
            backgroundColor: color.paper,
            borderRadius: radius.md,
            maxWidth: 560,
            width: '100%',
            alignSelf: 'center',
            padding: space.xxl,
            gap: space.lg,
          }}
        >
          <Text size="title" weight="bold">
            Account created
          </Text>
          <Text size="small" tone="muted">
            This password is shown once and is not recoverable. Copy it now and send it to {issued.email} yourself — there is no email delivery.
          </Text>

          <View style={{ backgroundColor: color.tint, borderRadius: radius.md, padding: space.lg }}>
            <Text size="large" weight="semibold" numeric selectable>
              {issued.password}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', gap: space.md, justifyContent: 'flex-end' }}>
            <Button
              label={copied ? 'Copied' : 'Copy password'}
              variant="outline"
              onPress={() => {
                void Clipboard.setStringAsync(issued.password);
                setCopied(true);
              }}
            />
            <Button label="Done" variant="primary" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

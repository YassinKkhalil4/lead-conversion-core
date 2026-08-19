import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import type { SalespersonInput } from '@/api/endpoints';
import { explain } from '@/api/errors';
import type { Salesperson } from '@/api/types';
import { Button } from '@/design/Button';
import { ErrorState } from '@/design/StateBlock';
import { Text } from '@/design/Text';
import { color, radius, space } from '@/design/tokens';
import { type Column, DataTable } from '@/desk/DataTable';
import { Field, FormRow, NumberField, TagInput, TextField, Toggle, fieldErrors } from '@/desk/form';
import { Page, Section } from '@/desk/Page';
import { atLeast, countLabel, optionalNumber, ratioLabel } from '@/desk/safe';
import { useSalespeople, useSaveSalesperson } from '@/manage/hooks';
import { duration } from '@/time/format';

const UNIT_SUGGESTIONS = ['Apartment', 'Villa', 'Townhouse', 'Duplex', 'Studio', 'Chalet', 'Commercial'];
const LANGUAGE_SUGGESTIONS = ['Arabic', 'English'];

const BLANK: SalespersonInput = {
  name: '',
  phoneE164: '',
  email: '',
  unitSpecialties: [],
  locations: [],
  languages: [],
  priorityRank: 100,
  capacityLimit: 10,
  active: true,
};

export default function SalespeopleScreen() {
  const query = useSalespeople();
  const save = useSaveSalesperson();
  const [editing, setEditing] = useState<{ salespersonId?: string; values: SalespersonInput } | null>(null);

  const open = (person?: Salesperson) =>
    setEditing(
      person
        ? {
            salespersonId: person.salespersonId,
            values: {
              name: person.name,
              phoneE164: person.phoneE164,
              email: person.email,
              unitSpecialties: person.unitSpecialties,
              locations: person.locations,
              languages: person.languages,
              priorityRank: optionalNumber(person.priorityRank) ?? BLANK.priorityRank,
              capacityLimit: optionalNumber(person.capacityLimit) ?? BLANK.capacityLimit,
              active: person.active,
            },
          }
        : { values: { ...BLANK } },
    );

  return (
    <Page
      title="Salespeople"
      subtitle="Routing only ever assigns leads to someone listed here."
      actions={<Button label="Add salesperson" variant="primary" onPress={() => open()} />}
    >
      {query.isError ? (
        <ErrorState
          title="Could not load salespeople"
          detail={explain(query.error, 'Loading salespeople').detail}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <Section title={`${query.data?.salespeople?.length ?? 0} on the team`}>
          <DataTable
            rows={query.data?.salespeople ?? []}
            keyOf={(person) => person.salespersonId}
            onRowPress={open}
            initialSort={{ key: 'priority', direction: 'asc' }}
            emptyTitle="No salespeople yet"
            emptyDetail="Add one to begin. Until at least one exists with a phone number, routing has nobody to assign a qualified lead to and every lead will escalate to the manager."
            columns={columns}
          />
        </Section>
      )}

      {editing ? (
        <SalespersonForm
          initial={editing}
          busy={save.isPending}
          error={save.error}
          onCancel={() => {
            save.reset();
            setEditing(null);
          }}
          onSubmit={async (values) => {
            await save.mutateAsync({ ...(editing.salespersonId ? { salespersonId: editing.salespersonId } : {}), values });
            setEditing(null);
          }}
        />
      ) : null}
    </Page>
  );
}

const columns: Column<Salesperson>[] = [
  {
    key: 'name',
    header: 'Name',
    width: 190,
    sortValue: (person) => person.name,
    render: (person) => (
      <View style={{ gap: 1 }}>
        <Text size="small" weight="semibold" numberOfLines={1}>
          {person.name}
        </Text>
        <Text size="micro" tone="faint" numeric numberOfLines={1}>
          {person.phoneE164}
        </Text>
      </View>
    ),
  },
  {
    key: 'email',
    header: 'Email',
    width: 210,
    sortValue: (person) => person.email,
    render: (person) => (
      <Text size="small" tone={person.email ? 'muted' : 'faint'} numberOfLines={1}>
        {person.email || '—'}
      </Text>
    ),
  },
  {
    key: 'active',
    header: 'Status',
    width: 100,
    sortValue: (person) => (person.active ? 1 : 0),
    render: (person) => (
      <Text size="small" tone={person.active ? 'default' : 'faint'}>
        {person.active ? 'Active' : 'Inactive'}
      </Text>
    ),
  },
  {
    key: 'specialties',
    header: 'Unit types',
    width: 190,
    render: (person) => <Tags values={person.unitSpecialties} />,
  },
  {
    key: 'locations',
    header: 'Locations',
    width: 190,
    render: (person) => <Tags values={person.locations} />,
  },
  {
    key: 'languages',
    header: 'Languages',
    width: 150,
    render: (person) => <Tags values={person.languages} />,
  },
  {
    key: 'priority',
    header: 'Priority',
    width: 100,
    numeric: true,
    sortValue: (person) => optionalNumber(person.priorityRank),
    render: (person) => (
      <Text size="small" numeric>
        {countLabel(person.priorityRank)}
      </Text>
    ),
  },
  {
    key: 'load',
    header: 'Active / capacity',
    width: 150,
    numeric: true,
    sortValue: (person) => optionalNumber(person.activeAssignmentCount),
    render: (person) => (
      <Text
        size="small"
        numeric
        weight="semibold"
        style={atLeast(person.activeAssignmentCount, person.capacityLimit) ? { color: color.warning } : undefined}
      >
        {ratioLabel(person.activeAssignmentCount, person.capacityLimit)}
      </Text>
    ),
  },
  {
    key: 'avgAck',
    header: 'Avg to ack',
    width: 120,
    numeric: true,
    sortValue: (person) => optionalNumber(person.avgAcknowledgementSeconds),
    render: (person) => (
      <Text size="small" numeric tone={optionalNumber(person.avgAcknowledgementSeconds) === null ? 'faint' : 'default'}>
        {optionalNumber(person.avgAcknowledgementSeconds) === null
          ? '—'
          : duration(person.avgAcknowledgementSeconds)}
      </Text>
    ),
  },
];

function Tags({ values }: { values: string[] }) {
  if (values.length === 0) {
    return (
      <Text size="small" tone="faint">
        —
      </Text>
    );
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
      {values.map((value) => (
        <View
          key={value}
          style={{
            backgroundColor: color.surfaceSunken,
            borderRadius: radius.sm,
            paddingHorizontal: space.sm,
            paddingVertical: 1,
          }}
        >
          <Text size="micro" tone="muted">
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function SalespersonForm({
  initial,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  initial: { salespersonId?: string; values: SalespersonInput };
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onSubmit: (values: SalespersonInput) => Promise<void>;
}) {
  const [values, setValues] = useState<SalespersonInput>(initial.values);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const isNew = !initial.salespersonId;
  const serverErrors = fieldErrors(error);
  const errors = { ...serverErrors, ...localErrors };
  const explained = error && Object.keys(serverErrors).length === 0 ? explain(error, 'Saving') : null;

  const set = <K extends keyof SalespersonInput>(key: K, value: SalespersonInput[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!values.name.trim()) next.name = 'A name is required.';
    if (isNew && !/^\+\d{7,}$/.test(values.phoneE164.trim())) {
      next.phoneE164 = 'Enter the number in international form, for example +201001234567.';
    }
    setLocalErrors(next);
    if (Object.keys(next).length > 0) return;
    await onSubmit({ ...values, name: values.name.trim(), phoneE164: values.phoneE164.trim() });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable onPress={onCancel} style={{ flex: 1, backgroundColor: 'rgba(12,11,9,0.4)', padding: space.xl, justifyContent: 'center' }}>
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: color.surface,
            borderRadius: radius.md,
            maxWidth: 760,
            width: '100%',
            alignSelf: 'center',
            maxHeight: '90%',
          }}
        >
          <ScrollView contentContainerStyle={{ padding: space.xxl, gap: space.xl }}>
            <Text size="title" weight="bold">
              {isNew ? 'Add salesperson' : values.name}
            </Text>

            <FormRow>
              <Field label="Name" error={errors.name}>
                <TextField value={values.name} onChange={(next) => set('name', next)} invalid={Boolean(errors.name)} autoCapitalize="words" />
              </Field>
              <Field
                label="Phone"
                hint={isNew ? 'International form. This is what WhatsApp notifies.' : 'Phone cannot be changed after creation.'}
                error={errors.phoneE164}
              >
                <TextField
                  value={values.phoneE164}
                  onChange={(next) => set('phoneE164', next)}
                  invalid={Boolean(errors.phoneE164)}
                  keyboardType="phone-pad"
                  placeholder="+201001234567"
                />
              </Field>
              <Field label="Email" error={errors.email}>
                <TextField value={values.email} onChange={(next) => set('email', next)} keyboardType="email-address" autoCapitalize="none" />
              </Field>
            </FormRow>

            <Field label="Unit types" hint="Routing scores a match against the lead's answer.">
              <TagInput
                values={values.unitSpecialties}
                onChange={(next) => set('unitSpecialties', next)}
                suggestions={UNIT_SUGGESTIONS}
                placeholder="Add a unit type"
              />
            </Field>

            <Field label="Locations" hint="Areas this person covers, matched against the lead's stated location.">
              <TagInput values={values.locations} onChange={(next) => set('locations', next)} placeholder="Add a location" />
            </Field>

            <Field label="Languages" hint="Matched against the language the lead chose in the conversation.">
              <TagInput
                values={values.languages}
                onChange={(next) => set('languages', next)}
                suggestions={LANGUAGE_SUGGESTIONS}
                placeholder="Add a language"
              />
            </Field>

            <FormRow>
              <Field
                label="Priority rank"
                hint="Lower wins. A rank of 1 is considered before a rank of 50 when two people match equally."
                error={errors.priorityRank}
                width={260}
              >
                <NumberField value={values.priorityRank} onChange={(next) => set('priorityRank', next)} />
              </Field>
              <Field
                label="Capacity limit"
                hint="Routing stops sending new leads once this many are open. If everyone is full the least loaded still receives it."
                error={errors.capacityLimit}
                width={260}
              >
                <NumberField value={values.capacityLimit} onChange={(next) => set('capacityLimit', next)} />
              </Field>
              <Field
                label="Status"
                hint="Deactivating keeps history and stops new assignments. Salespeople are never deleted."
                width={260}
              >
                <Toggle value={values.active} onChange={(next) => set('active', next)} labels={['Active', 'Inactive']} />
              </Field>
            </FormRow>

            {explained ? <ErrorState title={explained.title} detail={explained.detail} /> : null}

            <View style={{ flexDirection: 'row', gap: space.md, justifyContent: 'flex-end' }}>
              <Button label="Cancel" variant="outline" onPress={onCancel} />
              <Button label={isNew ? 'Add salesperson' : 'Save changes'} variant="primary" busy={busy} onPress={() => void submit()} />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

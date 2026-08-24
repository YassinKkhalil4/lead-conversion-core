import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import type { ProjectInput } from '@/api/endpoints';
import { explain } from '@/api/errors';
import type { Project, Salesperson } from '@/api/types';
import { Button } from '@/design/Button';
import { ErrorState, InlineNotice } from '@/design/StateBlock';
import { Text } from '@/design/Text';
import { color, hitSlop, radius, space } from '@/design/tokens';
import { type Column, DataTable } from '@/desk/DataTable';
import { Field, FormRow, MoneyField, TagInput, TextField, Toggle, fieldErrors } from '@/desk/form';
import { Page, Section } from '@/desk/Page';
import { useProjects, useSalespeople, useSaveProject, useSetProjectSalespeople } from '@/manage/hooks';

const UNIT_SUGGESTIONS = ['Apartment', 'Villa', 'Townhouse', 'Duplex', 'Studio', 'Chalet', 'Commercial'];

const BLANK: ProjectInput = {
  projectName: '',
  active: true,
  startingPrice: null,
  maxPrice: null,
  unitTypes: [],
  location: '',
  mapsUrl: '',
};

function money(value: number | null): string {
  if (value === null) return '—';
  return value.toLocaleString('en-US');
}

export default function ProjectsScreen() {
  const projects = useProjects();
  const salespeople = useSalespeople();
  const save = useSaveProject();
  const assign = useSetProjectSalespeople();

  const [editing, setEditing] = useState<{ projectId?: string; values: ProjectInput } | null>(null);
  const [assigning, setAssigning] = useState<Project | null>(null);

  const byId = new Map((salespeople.data?.salespeople ?? []).map((person) => [person.salespersonId, person]));
  const unassigned = (projects.data?.projects ?? []).filter(
    (project) => project.active && (project.salespersonIds ?? []).length === 0,
  ).length;

  const open = (project?: Project) =>
    setEditing(
      project
        ? {
            projectId: project.projectId,
            values: {
              projectName: project.projectName,
              active: project.active,
              startingPrice: project.startingPrice,
              maxPrice: project.maxPrice,
              unitTypes: project.unitTypes,
              location: project.location,
              mapsUrl: project.mapsUrl,
            },
          }
        : { values: { ...BLANK } },
    );

  const columns: Column<Project>[] = [
    {
      key: 'name',
      header: 'Project',
      width: 220,
      sortValue: (project) => project.projectName,
      render: (project) => (
        <Text size="small" weight="semibold" autoDirection numberOfLines={1}>
          {project.projectName}
        </Text>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      width: 180,
      sortValue: (project) => project.location,
      render: (project) => (
        <Text size="small" tone={project.location ? 'muted' : 'faint'} autoDirection numberOfLines={1}>
          {project.location || '—'}
        </Text>
      ),
    },
    {
      key: 'active',
      header: 'Status',
      width: 100,
      sortValue: (project) => (project.active ? 1 : 0),
      render: (project) => (
        <Text size="small" tone={project.active ? 'default' : 'faint'}>
          {project.active ? 'Active' : 'Inactive'}
        </Text>
      ),
    },
    {
      key: 'starting',
      header: 'From',
      width: 140,
      numeric: true,
      sortValue: (project) => project.startingPrice,
      render: (project) => (
        <Text size="small" numeric tone={project.startingPrice === null ? 'faint' : 'default'}>
          {money(project.startingPrice)}
        </Text>
      ),
    },
    {
      key: 'max',
      header: 'To',
      width: 140,
      numeric: true,
      sortValue: (project) => project.maxPrice,
      render: (project) => (
        <Text size="small" numeric tone={project.maxPrice === null ? 'faint' : 'default'}>
          {money(project.maxPrice)}
        </Text>
      ),
    },
    {
      key: 'units',
      header: 'Unit types',
      width: 200,
      render: (project) =>
        project.unitTypes.length === 0 ? (
          <Text size="small" tone="faint">
            —
          </Text>
        ) : (
          <Text size="small" tone="muted" numberOfLines={1}>
            {project.unitTypes.join(', ')}
          </Text>
        ),
    },
    {
      key: 'salespeople',
      header: 'Salespeople',
      width: 230,
      sortValue: (project) => (project.salespersonIds ?? []).length,
      render: (project) =>
        (project.salespersonIds ?? []).length === 0 ? (
          <Text size="small" style={{ color: color.warning }}>
            None — cannot be routed
          </Text>
        ) : (
          <Text size="small" numberOfLines={1}>
            {(project.salespersonIds ?? []).map((id) => byId.get(id)?.name ?? 'Unknown').join(', ')}
          </Text>
        ),
    },
    {
      // Both actions live here as separate controls. Nesting a pressable cell
      // inside a pressable row makes the target ambiguous on web, so the row
      // itself is not pressable on this table.
      key: 'actions',
      header: 'Actions',
      width: 150,
      render: (project) => (
        <View style={{ flexDirection: 'row', gap: space.lg }}>
          <Pressable accessibilityRole="button" onPress={() => open(project)} hitSlop={hitSlop}>
            <Text size="small" weight="semibold" style={{ textDecorationLine: 'underline' }}>
              Edit
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setAssigning(project)} hitSlop={hitSlop}>
            <Text size="small" weight="semibold" style={{ textDecorationLine: 'underline' }}>
              Assign
            </Text>
          </Pressable>
        </View>
      ),
    },
  ];

  return (
    <Page
      title="Projects"
      subtitle="A lead is matched to a project, and routing then picks from the salespeople assigned to it."
      actions={<Button label="Add project" variant="primary" onPress={() => open()} />}
    >
      {unassigned > 0 ? (
        <InlineNotice
          variant="warning"
          text={`${unassigned} active project${unassigned === 1 ? '' : 's'} with nobody assigned. Routing cannot place a lead on those, and every one will escalate to the manager instead.`}
        />
      ) : null}

      {projects.isError ? (
        <ErrorState
          title="Could not load projects"
          detail={explain(projects.error, 'Loading projects').detail}
          onRetry={() => void projects.refetch()}
        />
      ) : (
        <Section title={`${projects.data?.projects?.length ?? 0} projects`}>
          <DataTable
            rows={projects.data?.projects ?? []}
            keyOf={(project) => project.projectId}
            initialSort={{ key: 'name', direction: 'asc' }}
            emptyTitle="No projects yet"
            emptyDetail="Add the developments this brokerage sells. Leads are matched to a project by budget and unit type, and routing then chooses among the salespeople assigned to it."
            columns={columns}
          />
        </Section>
      )}

      {editing ? (
        <ProjectForm
          initial={editing}
          busy={save.isPending}
          error={save.error}
          onCancel={() => {
            save.reset();
            setEditing(null);
          }}
          onSubmit={async (values) => {
            await save.mutateAsync({ ...(editing.projectId ? { projectId: editing.projectId } : {}), values });
            setEditing(null);
          }}
        />
      ) : null}

      {assigning ? (
        <AssignSheet
          project={assigning}
          salespeople={salespeople.data?.salespeople ?? []}
          busy={assign.isPending}
          error={assign.error}
          onCancel={() => {
            assign.reset();
            setAssigning(null);
          }}
          onSave={async (salespersonIds) => {
            await assign.mutateAsync({ projectId: assigning.projectId, salespersonIds });
            setAssigning(null);
          }}
        />
      ) : null}
    </Page>
  );
}

function ProjectForm({
  initial,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  initial: { projectId?: string; values: ProjectInput };
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onSubmit: (values: ProjectInput) => Promise<void>;
}) {
  const [values, setValues] = useState<ProjectInput>(initial.values);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const isNew = !initial.projectId;
  const serverErrors = fieldErrors(error);
  const errors = { ...serverErrors, ...localErrors };
  const explained = error && Object.keys(serverErrors).length === 0 ? explain(error, 'Saving') : null;

  const set = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!values.projectName.trim()) next.projectName = 'A project name is required.';
    if (values.startingPrice !== null && values.maxPrice !== null && values.maxPrice < values.startingPrice) {
      next.maxPrice = 'The top of the range cannot be below the bottom.';
    }
    setLocalErrors(next);
    if (Object.keys(next).length > 0) return;
    await onSubmit({ ...values, projectName: values.projectName.trim() });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable onPress={onCancel} style={{ flex: 1, backgroundColor: color.scrim, padding: space.xl, justifyContent: 'center' }}>
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{ backgroundColor: color.surface, borderRadius: radius.md, maxWidth: 720, width: '100%', alignSelf: 'center', maxHeight: '90%' }}
        >
          <ScrollView contentContainerStyle={{ padding: space.xxl, gap: space.xl }}>
            <Text size="title" weight="bold">
              {isNew ? 'Add project' : values.projectName}
            </Text>

            <FormRow>
              <Field label="Project name" error={errors.projectName}>
                <TextField value={values.projectName} onChange={(next) => set('projectName', next)} invalid={Boolean(errors.projectName)} autoCapitalize="words" />
              </Field>
              <Field label="Location" hint="Matched against the location a lead gives.">
                <TextField value={values.location} onChange={(next) => set('location', next)} autoCapitalize="words" />
              </Field>
            </FormRow>

            <FormRow>
              <Field label="Price from" error={errors.startingPrice} width={220}>
                <MoneyField value={values.startingPrice} onChange={(next) => set('startingPrice', next)} />
              </Field>
              <Field label="Price to" error={errors.maxPrice} width={220}>
                <MoneyField value={values.maxPrice} onChange={(next) => set('maxPrice', next)} invalid={Boolean(errors.maxPrice)} />
              </Field>
              <Field label="Status" hint="Inactive projects stop receiving new leads." width={220}>
                <Toggle value={values.active} onChange={(next) => set('active', next)} labels={['Active', 'Inactive']} />
              </Field>
            </FormRow>

            <Field label="Unit types" hint="What this project sells, matched against the lead's answer.">
              <TagInput values={values.unitTypes} onChange={(next) => set('unitTypes', next)} suggestions={UNIT_SUGGESTIONS} placeholder="Add a unit type" />
            </Field>

            <Field label="Maps link" hint="Sent to the lead when a site visit is arranged.">
              <TextField value={values.mapsUrl} onChange={(next) => set('mapsUrl', next)} autoCapitalize="none" placeholder="https://maps.app.goo.gl/…" />
            </Field>

            {explained ? <ErrorState title={explained.title} detail={explained.detail} /> : null}

            <View style={{ flexDirection: 'row', gap: space.md, justifyContent: 'flex-end' }}>
              <Button label="Cancel" variant="outline" onPress={onCancel} />
              <Button label={isNew ? 'Add project' : 'Save changes'} variant="primary" busy={busy} onPress={() => void submit()} />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * The assignment set is edited as a whole and saved once, matching the endpoint,
 * which replaces the set inside one transaction.
 */
function AssignSheet({
  project,
  salespeople,
  busy,
  error,
  onCancel,
  onSave,
}: {
  project: Project;
  salespeople: Salesperson[];
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onSave: (salespersonIds: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>(project.salespersonIds ?? []);
  const explained = error ? explain(error, 'Saving the assignment') : null;

  const toggle = (salespersonId: string) =>
    setSelected((current) =>
      current.includes(salespersonId)
        ? current.filter((entry) => entry !== salespersonId)
        : [...current, salespersonId],
    );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable onPress={onCancel} style={{ flex: 1, backgroundColor: color.scrim, padding: space.xl, justifyContent: 'center' }}>
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{ backgroundColor: color.surface, borderRadius: radius.md, maxWidth: 560, width: '100%', alignSelf: 'center', maxHeight: '85%' }}
        >
          <ScrollView contentContainerStyle={{ padding: space.xxl, gap: space.lg }}>
            <View style={{ gap: space.xs }}>
              <Text size="title" weight="bold">
                Who can sell {project.projectName}
              </Text>
              <Text size="small" tone="muted">
                Routing chooses among these people when a lead is matched to this project. With nobody selected the lead escalates to the manager instead.
              </Text>
            </View>

            {salespeople.length === 0 ? (
              <Text size="small" tone="faint">
                No salespeople exist yet. Add one under Salespeople first.
              </Text>
            ) : (
              salespeople.map((person) => {
                const checked = selected.includes(person.salespersonId);
                return (
                  <Pressable
                    key={person.salespersonId}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    onPress={() => toggle(person.salespersonId)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.lg,
                      paddingVertical: space.lg,
                      paddingHorizontal: space.md,
                      borderRadius: radius.sm,
                      backgroundColor: pressed ? color.surfacePressed : 'transparent',
                      borderBottomWidth: 1,
                      borderBottomColor: color.hairline,
                    })}
                  >
                    <View
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 3,
                        borderWidth: 1,
                        borderColor: checked ? color.ink : color.hairlineStrong,
                        backgroundColor: checked ? color.ink : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {checked ? (
                        <Text size="micro" weight="bold" tone="inverse">
                          ✓
                        </Text>
                      ) : null}
                    </View>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text size="small" weight={checked ? 'semibold' : 'regular'}>
                        {person.name}
                      </Text>
                      <Text size="micro" tone="faint">
                        {person.active ? '' : 'inactive · '}
                        {person.unitSpecialties.join(', ') || 'no unit types'} ·{' '}
                        {person.locations.join(', ') || 'no locations'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            )}

            {explained ? <ErrorState title={explained.title} detail={explained.detail} /> : null}

            <View style={{ flexDirection: 'row', gap: space.md, justifyContent: 'flex-end' }}>
              <Button label="Cancel" variant="outline" onPress={onCancel} />
              <Button label="Save" variant="primary" busy={busy} onPress={() => void onSave(selected)} />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

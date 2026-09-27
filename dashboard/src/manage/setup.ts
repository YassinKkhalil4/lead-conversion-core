// Relative, not '@/': the root test suite imports this file directly.
import type { ManagedUser, Project, Role, Salesperson } from '../api/types';

export type SetupStepKey = 'account' | 'projects' | 'salespeople' | 'coverage' | 'logins';

export interface SetupStep {
  key: SetupStepKey;
  title: string;
  detail: string;
  /** Where the step is done. Absent for the step that is done for them. */
  href?: string;
  action?: string;
  done: boolean;
}

export interface SetupProgress {
  steps: SetupStep[];
  doneCount: number;
  complete: boolean;
}

/**
 * What a brokerage has to set up before routing can hand a qualified lead to
 * anyone. Routing needs an active project, a salesperson on that project with a
 * WhatsApp number for the assignment alert, and — for the salesperson to see
 * the lead here — a login linked to them.
 *
 * The account step is already done when anyone can see this. It is listed so
 * the checklist opens with progress rather than at zero.
 *
 * Returns null until every list it depends on has loaded, so a half-loaded
 * screen never flashes a step as undone.
 */
export function setupProgress(input: {
  role: Role;
  projects: Project[] | undefined;
  salespeople: Salesperson[] | undefined;
  users: ManagedUser[] | undefined;
}): SetupProgress | null {
  const canManageUsers = input.role === 'admin';
  if (!input.projects || !input.salespeople) return null;
  if (canManageUsers && !input.users) return null;

  const activeProjects = input.projects.filter((project) => project.active);
  const steps: SetupStep[] = [
    {
      key: 'account',
      title: 'Your brokerage account',
      detail: 'Created with your WhatsApp number when Kadensio was set up.',
      done: true,
    },
    {
      key: 'projects',
      title: 'Add the projects you sell',
      detail: 'Each lead is matched to a project by budget, unit type and location.',
      href: '/manage/projects',
      action: 'Add a project',
      done: activeProjects.length > 0,
    },
    {
      key: 'salespeople',
      title: 'Add your salespeople',
      detail: 'Each one needs a WhatsApp number, which is where assignment alerts go.',
      href: '/manage/salespeople',
      action: 'Add a salesperson',
      done: input.salespeople.some((person) => person.active && person.phoneE164.trim() !== ''),
    },
    {
      key: 'coverage',
      title: 'Put salespeople on projects',
      detail: 'Routing only assigns a lead to someone on its project.',
      href: '/manage/projects',
      action: 'Staff a project',
      done: activeProjects.some((project) => project.salespersonIds.length > 0),
    },
  ];
  if (canManageUsers) {
    steps.push({
      key: 'logins',
      title: 'Give salespeople a login',
      detail: 'So each one opens their own queue here, sorted by score.',
      href: '/manage/users',
      action: 'Invite a salesperson',
      done: (input.users ?? []).some((user) => user.active && user.role === 'salesperson'),
    });
  }

  const doneCount = steps.filter((step) => step.done).length;
  return { steps, doneCount, complete: doneCount === steps.length };
}

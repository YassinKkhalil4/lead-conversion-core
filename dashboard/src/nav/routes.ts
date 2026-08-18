import type { Role } from '@/api/types';

export interface NavItem {
  href: string;
  label: string;
  roles: Role[];
}

/**
 * One declaration of who may see what. The navigation renders from this and the
 * route guard reads the same list, so a link and its guard cannot disagree.
 *
 * Hiding a link is presentation. The guard is the control.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/leads', label: 'Queue', roles: ['salesperson'] },
  { href: '/manage', label: 'Overview', roles: ['manager', 'admin'] },
  { href: '/leads', label: 'Leads', roles: ['manager', 'admin'] },
  { href: '/manage/salespeople', label: 'Salespeople', roles: ['manager', 'admin'] },
  { href: '/manage/projects', label: 'Projects', roles: ['manager', 'admin'] },
  { href: '/manage/users', label: 'Users', roles: ['admin'] },
  { href: '/notifications', label: 'Notifications', roles: ['salesperson', 'manager', 'admin'] },
];

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

/** Where each role lands after signing in. */
export function homeFor(role: Role): string {
  return role === 'salesperson' ? '/leads' : '/manage';
}

export function canAccess(role: Role, allowed: Role[]): boolean {
  return allowed.includes(role);
}

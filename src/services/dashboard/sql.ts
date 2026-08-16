import type { DashboardScope } from './types.js';

/**
 * Collects bind values for a dynamically assembled statement so that every
 * caller-supplied value stays a `$n` placeholder. Only identifiers the code
 * itself controls (table aliases, column names from fixed allow-lists) are ever
 * concatenated into SQL text.
 */
export class QueryParams {
  private readonly bound: unknown[] = [];

  bind(value: unknown): string {
    this.bound.push(value);
    return `$${this.bound.length}`;
  }

  list(): unknown[] {
    return [...this.bound];
  }

  get length(): number {
    return this.bound.length;
  }
}

/**
 * The single source of truth for "which leads may this session see".
 *
 * Managers and admins see every lead in their client. A salesperson sees leads
 * they hold or have held an assignment for, plus leads with no active
 * assignment. The predicate is always ANDed into the WHERE clause so that no
 * row for another client can ever be materialised and filtered afterwards.
 */
export function leadVisibilitySql(alias: string, scope: DashboardScope, params: QueryParams): string {
  const clientParam = params.bind(scope.clientId);
  if (!scope.restrictToOwnLeads) {
    return `${alias}.client_id = ${clientParam}::uuid`;
  }
  const salespersonParam = params.bind(scope.salespersonId);
  return `${alias}.client_id = ${clientParam}::uuid AND (
    EXISTS (
      SELECT 1 FROM app.lead_assignments scope_la
      WHERE scope_la.lead_id = ${alias}.lead_id
        AND scope_la.salesperson_id = ${salespersonParam}::uuid
    )
    OR NOT EXISTS (
      SELECT 1 FROM app.lead_assignments scope_active
      WHERE scope_active.lead_id = ${alias}.lead_id
        AND scope_active.status = 'assigned'
    )
  )`;
}

export function pickSort(requested: string, allowed: Record<string, string>, fallback: string): string {
  return allowed[requested] ?? allowed[fallback] ?? fallback;
}

import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { AuditRepository, RuntimeOutboxRepository, sha256Hex, stableJson } from '../infrastructure/runtime.js';
import { REAL_ESTATE_ROUTING_VERSION, routeRealEstateLead } from '../domain/lead-routing.js';
import { FollowupSchedulerService } from './followup-scheduler-service.js';

type Db = typeof pool | PoolClient;

interface RouteLeadResult {
  routingRunId: string;
  outcome: 'assigned' | 'no_eligible_salesperson';
  selectedSalespersonId: string;
  inserted: boolean;
}

export class LeadRoutingService {
  constructor(
    private readonly outbox = new RuntimeOutboxRepository(),
    private readonly audit = new AuditRepository(),
    private readonly followups = new FollowupSchedulerService(),
  ) {}

  async routeLead(client: Db, input: {
    leadId: string;
    scoreRunId?: string;
    actorType?: 'worker' | 'system' | 'migration';
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<RouteLeadResult> {
    const lead = await client.query<{
      lead_id: string;
      client_id: string;
      contact_id: string;
      project_id: string | null;
      status: string;
      current_stage: string;
      lead_score: number | null;
      temperature: string;
      stop_follow_up: boolean;
      closed_status: string;
      preferred_language: string | null;
      unit_type: string | null;
      location: string | null;
      company_name: string;
      manager_phone_e164: string;
      contact_name: string;
      phone_e164: string;
      project_name: string | null;
    }>(
      `SELECT
         l.lead_id, l.client_id, l.contact_id, l.project_id, l.status, l.current_stage,
         l.lead_score, l.temperature, l.stop_follow_up, l.closed_status,
         c.company_name, c.manager_phone_e164,
         ct.name AS contact_name, ct.phone_e164,
         p.project_name,
         conv.preferred_language,
         conv.state_json #>> '{answers,q_unit_type}' AS unit_type,
         conv.state_json #>> '{answers,q_location}' AS location
       FROM app.leads l
       JOIN app.clients c USING (client_id)
       JOIN app.contacts ct USING (contact_id)
       LEFT JOIN app.projects p ON p.project_id=l.project_id
       LEFT JOIN app.conversations conv ON conv.lead_id=l.lead_id
       WHERE l.lead_id=$1
       FOR UPDATE OF l`,
      [input.leadId],
    );
    const leadRow = lead.rows[0];
    if (!leadRow) throw new Error(`lead_not_found_for_routing:${input.leadId}`);

    const scoreRun = input.scoreRunId
      ? await client.query<{ score_run_id: string; input_hash: string; score: number; temperature: string }>(
          'SELECT score_run_id, input_hash, score, temperature FROM app.score_runs WHERE score_run_id=$1 AND lead_id=$2',
          [input.scoreRunId, input.leadId],
        )
      : await client.query<{ score_run_id: string; input_hash: string; score: number; temperature: string }>(
          `SELECT score_run_id, input_hash, score, temperature
           FROM app.score_runs
           WHERE lead_id=$1
           ORDER BY created_at DESC, score_run_id DESC
           LIMIT 1`,
          [input.leadId],
        );
    const scoreRow = scoreRun.rows[0];
    if (!scoreRow) throw new Error(`score_run_not_found_for_routing:${input.leadId}`);

    const activeAssignment = await client.query<{
      lead_assignment_id: string;
      salesperson_id: string;
      routing_run_id: string | null;
    }>(
      `SELECT lead_assignment_id, salesperson_id, routing_run_id
       FROM app.lead_assignments
       WHERE lead_id=$1 AND status='assigned'
       FOR UPDATE`,
      [input.leadId],
    );
    const activeAssignmentRow = activeAssignment.rows[0];
    if (activeAssignmentRow?.routing_run_id) {
      return {
        routingRunId: activeAssignmentRow.routing_run_id,
        outcome: 'assigned',
        selectedSalespersonId: activeAssignmentRow.salesperson_id,
        inserted: false,
      };
    }

    const suppressReason = this.suppressionReason(leadRow);
    const candidates = suppressReason
      ? { rows: [] }
      : await client.query<{
          salesperson_id: string;
          name: string;
          phone_e164: string;
          priority_rank: number;
          active_assignment_count: string;
          unit_match: boolean;
          location_match: boolean;
          language_match: boolean;
        }>(
          `SELECT
             sp.salesperson_id, sp.name, sp.phone_e164, sp.priority_rank,
             (
               SELECT count(*)::text
               FROM app.lead_assignments la
               WHERE la.salesperson_id=sp.salesperson_id
                 AND la.status='assigned'
             ) AS active_assignment_count,
             COALESCE($3 = ANY(sp.unit_specialties), false) AS unit_match,
             COALESCE($4 = ANY(sp.locations), false) AS location_match,
             COALESCE($5 = ANY(sp.languages), false) AS language_match
           FROM app.salespeople sp
           WHERE sp.client_id=$1
             AND sp.active=true
             AND sp.phone_e164 <> ''
             AND (
               $2::uuid IS NULL
               OR EXISTS (
                 SELECT 1
                 FROM app.salesperson_projects spp
                 WHERE spp.salesperson_id=sp.salesperson_id
                   AND spp.project_id=$2
               )
             )
           ORDER BY sp.priority_rank, sp.name, sp.salesperson_id
           FOR UPDATE OF sp`,
          [
            leadRow.client_id,
            leadRow.project_id,
            leadRow.unit_type || '',
            leadRow.location || '',
            leadRow.preferred_language || '',
          ],
        );

    const decision = suppressReason
      ? {
          routingVersion: REAL_ESTATE_ROUTING_VERSION,
          outcome: 'no_eligible_salesperson' as const,
          candidates: [],
          reasons: { reason: suppressReason },
        }
      : routeRealEstateLead(candidates.rows.map((row) => ({
          salespersonId: row.salesperson_id,
          name: row.name,
          phoneE164: row.phone_e164,
          priorityRank: row.priority_rank,
          activeAssignmentCount: Number(row.active_assignment_count),
          unitMatch: row.unit_match,
          locationMatch: row.location_match,
          languageMatch: row.language_match,
        })));
    const inputHash = sha256Hex(stableJson({
      routingVersion: REAL_ESTATE_ROUTING_VERSION,
      leadId: input.leadId,
      scoreRunId: scoreRow.score_run_id,
      scoreInputHash: scoreRow.input_hash,
      score: scoreRow.score,
      temperature: scoreRow.temperature,
      projectId: leadRow.project_id || '',
      candidateIds: decision.candidates.map((candidate) => candidate.salespersonId),
      suppressReason: suppressReason || '',
    }));

    const inserted = await client.query<{ routing_run_id: string }>(
      `INSERT INTO app.routing_runs
        (lead_id, score_run_id, routing_version, input_hash, outcome,
         selected_salesperson_id, candidates_json, reasons_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
       ON CONFLICT (lead_id, routing_version, input_hash) DO NOTHING
       RETURNING routing_run_id`,
      [
        input.leadId,
        scoreRow.score_run_id,
        decision.routingVersion,
        inputHash,
        decision.outcome,
        decision.selected?.salespersonId || null,
        JSON.stringify(decision.candidates),
        JSON.stringify(decision.reasons),
      ],
    );
    let routingRunId = inserted.rows[0]?.routing_run_id || '';
    const wasInserted = Boolean(routingRunId);
    if (!routingRunId) {
      const existing = await client.query<{ routing_run_id: string }>(
        `SELECT routing_run_id
         FROM app.routing_runs
         WHERE lead_id=$1 AND routing_version=$2 AND input_hash=$3
         LIMIT 1`,
        [input.leadId, decision.routingVersion, inputHash],
      );
      routingRunId = existing.rows[0]?.routing_run_id || '';
    }
    if (!routingRunId) throw new Error('routing_run_not_created');

    let assignmentId = '';
    let outboxCommandId = '';
    let assignmentCreated = false;
    if (decision.selected) {
      const existingAssignment = await client.query<{ lead_assignment_id: string; salesperson_id: string }>(
        `SELECT lead_assignment_id, salesperson_id
         FROM app.lead_assignments
         WHERE lead_id=$1 AND status='assigned'
         FOR UPDATE`,
        [input.leadId],
      );
      const existing = existingAssignment.rows[0];
      if (existing) {
        assignmentId = existing.lead_assignment_id;
        if (existing.salesperson_id !== decision.selected.salespersonId) {
          throw new Error(`lead_already_assigned_to_different_salesperson:${input.leadId}`);
        }
      } else {
        const idempotencyKey = `lead_assignment:${input.leadId}:${decision.routingVersion}:${decision.selected.salespersonId}:${inputHash.slice(0, 24)}`;
        const assignment = await client.query<{ lead_assignment_id: string }>(
          `INSERT INTO app.lead_assignments
            (lead_id, salesperson_id, routing_version, routing_run_id, idempotency_key)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING lead_assignment_id`,
          [input.leadId, decision.selected.salespersonId, decision.routingVersion, routingRunId, idempotencyKey],
        );
        assignmentId = assignment.rows[0]?.lead_assignment_id || '';
        assignmentCreated = true;
        if (!assignmentId) throw new Error('lead_assignment_not_created');
        outboxCommandId = await this.outbox.enqueue(client, {
          commandType: 'salesperson.lead_assignment_notification',
          destination: decision.selected.phoneE164,
          idempotencyKey: `salesperson.notify:${assignmentId}`,
          aggregateKey: input.leadId,
          payload: {
            leadId: input.leadId,
            routingRunId,
            assignmentId,
            salespersonId: decision.selected.salespersonId,
            clientId: leadRow.client_id,
            contactId: leadRow.contact_id,
            contactName: leadRow.contact_name,
            contactPhoneE164: leadRow.phone_e164,
            projectName: leadRow.project_name || '',
            leadScore: scoreRow.score,
            temperature: scoreRow.temperature,
          },
        });
        await this.followups.cancelForLead(client, {
          leadId: input.leadId,
          reason: 'lead_assigned',
          actorId: input.actorId || 'lead-routing-service',
          ...(input.correlationId ? { correlationId: input.correlationId } : {}),
          causationId: routingRunId,
        });
      }
    } else if (wasInserted && leadRow.manager_phone_e164) {
      outboxCommandId = await this.outbox.enqueue(client, {
        commandType: 'operator.routing_attention_required',
        destination: leadRow.manager_phone_e164,
        idempotencyKey: `routing.no_eligible:${routingRunId}`,
        aggregateKey: input.leadId,
        payload: {
          leadId: input.leadId,
          routingRunId,
          clientId: leadRow.client_id,
          companyName: leadRow.company_name,
          reason: decision.reasons.reason || 'no_eligible_salesperson',
        },
      });
    }

    if (wasInserted || assignmentCreated || outboxCommandId) {
      await this.audit.record(client, {
        eventType: decision.selected ? 'lead.routed' : 'lead.routing_no_eligible',
        actorType: input.actorType || 'worker',
        actorId: input.actorId || 'lead-routing-service',
        aggregateType: 'lead',
        aggregateId: input.leadId,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        causationId: input.causationId || routingRunId,
        payload: {
          routingVersion: decision.routingVersion,
          routingRunId,
          scoreRunId: scoreRow.score_run_id,
          assignmentId,
          outboxCommandId,
          selectedSalespersonId: decision.selected?.salespersonId || '',
          candidateCount: decision.candidates.length,
          reasons: decision.reasons,
        },
        after: {
          outcome: decision.outcome,
          selectedSalespersonId: decision.selected?.salespersonId || '',
        },
      });
    }

    return {
      routingRunId,
      outcome: decision.outcome,
      selectedSalespersonId: decision.selected?.salespersonId || '',
      inserted: wasInserted,
    };
  }

  private suppressionReason(lead: {
    status: string;
    current_stage: string;
    stop_follow_up: boolean;
    closed_status: string;
  }): string {
    const status = lead.status.toLocaleLowerCase();
    const stage = lead.current_stage.toLocaleLowerCase();
    const closed = lead.closed_status.toLocaleLowerCase();
    if (lead.stop_follow_up) return 'stop_follow_up_true';
    if (stage === 'stopped' || status === 'not_interested') return 'not_interested';
    if (status === 'lost' || status.includes('closed_lost') || closed === 'lost') return 'closed_lost';
    if (status === 'won' || status.includes('closed_won') || closed === 'won') return 'closed_won';
    return '';
  }
}

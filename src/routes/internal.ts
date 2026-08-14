import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { ConfigRepository } from '../repositories/config-repository.js';
import { LeadIntakeService, leadIntakeSchema } from '../services/lead-intake-service.js';
import { MessageRequestService } from '../services/message-request-service.js';
import { requireInternalSecret } from './auth.js';

const bootstrapSchema = z.object({
  clientRecordId: z.string().min(1),
  clientId: z.string().optional().default(''),
  phoneNormalized: z.string().min(5),
  leadRecordId: z.string().min(1),
  leadId: z.string().optional().default(''),
  leadName: z.string().optional().default(''),
  companyName: z.string().optional().default(''),
  projectName: z.string().optional().default(''),
  projectRecordId: z.string().optional().default(''),
  currentStage: z.string().optional().default(''),
  currentQuestionKey: z.string().optional().default(''),
  preferredLanguage: z.enum(['Arabic', 'English', '']).optional().default(''),
  answers: z.record(z.string()).optional().default({}),
  retryCount: z.number().int().min(0).optional().default(0),
  status: z.string().optional().default(''),
  humanTakeover: z.boolean().optional().default(false),
  stopFollowUp: z.boolean().optional().default(false),
  closedStatus: z.string().optional().default(''),
  appointmentStatus: z.string().optional().default(''),
  assignedSalespersonRecordId: z.string().optional().default(''),
  assignedSalespersonPhone: z.string().optional().default(''),
  lastInboundAt: z.string().datetime().optional(),
  migrateConfig: z.boolean().optional().default(false),
});
const controlSchema = z.object({
  clientRecordId: z.string().min(1),
  phoneNormalized: z.string().min(5),
  leadRecordId: z.string().optional().default(''),
  status: z.string().optional(),
  humanTakeover: z.boolean().optional(),
  stopFollowUp: z.boolean().optional(),
  closedStatus: z.string().optional(),
  appointmentStatus: z.string().optional(),
  currentStage: z.string().optional(),
  assignedSalespersonRecordId: z.string().optional(),
  assignedSalespersonPhone: z.string().optional(),
  source: z.string().optional().default('dashboard'),
  sourceEventId: z.string().optional().default(''),
});
const channelSchema = z.object({
  phoneNumberId: z.string().min(1),
  clientRecordId: z.string().min(1),
  clientId: z.string().optional().default(''),
  companyName: z.string().optional().default(''),
  active: z.boolean().optional().default(true),
  directSendEnabled: z.boolean().optional().default(false),
});
const consumerReceiptSchema = z.object({
  consumerName: z.string().min(1).max(100),
  idempotencyKey: z.string().min(1).max(500),
  leaseSeconds: z.number().int().min(10).max(900).optional().default(120),
});
const consumerCompleteSchema = z.object({
  consumerName: z.string().min(1).max(100),
  idempotencyKey: z.string().min(1).max(500),
  result: z.record(z.unknown()).optional().default({}),
});
const consumerFailSchema = z.object({
  consumerName: z.string().min(1).max(100),
  idempotencyKey: z.string().min(1).max(500),
  error: z.string().max(4000).optional().default('projection_failed'),
});
const messageOptionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
});
const messagePayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal('buttons'),
    text: z.string().min(1),
    options: z.array(messageOptionSchema).min(1).max(3),
  }),
  z.object({
    kind: z.literal('list'),
    text: z.string().min(1),
    buttonText: z.string().min(1),
    options: z.array(messageOptionSchema).min(1).max(10),
  }),
  z.object({
    kind: z.literal('template'),
    templateName: z.string().min(1),
    languageCode: z.string().min(2),
    components: z.array(z.record(z.unknown())).optional().default([]),
  }),
]);
const whatsappSendSchema = z.object({
  clientId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  requestKey: z.string().min(1),
  phoneNumberId: z.string().optional().default(''),
  toE164: z.string().min(5),
  payload: messagePayloadSchema,
  conversationWindowExpiresAt: z.string().datetime().optional(),
  actorId: z.string().optional().default('internal-api'),
});


export async function internalRoutes(app: FastifyInstance): Promise<void> {
  const configs = new ConfigRepository();
  const messageRequests = new MessageRequestService();
  const leadIntake = new LeadIntakeService();


  app.get('/internal/config/active', async (request: FastifyRequest, reply: FastifyReply) => {
    requireInternalSecret(request);
    const query = z.object({ clientRecordId: z.string().optional().default('') }).safeParse(request.query);
    if (!query.success) {
      reply.code(400);
      return { ok: false, issues: query.error.issues };
    }
    const config = await configs.getActive(query.data.clientRecordId);
    return { ok: true, config };
  });


  app.post('/internal/channels/upsert', async (request: FastifyRequest, reply: FastifyReply) => {
    requireInternalSecret(request);
    const parsed = channelSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, issues: parsed.error.issues };
    }
    const body = parsed.data;
    const config = await configs.getActiveSnapshot(body.clientRecordId);
    const result = await pool.query(
      `INSERT INTO edge_client_channels (
         phone_number_id,client_record_id,client_id,company_name,active,
         config_version,direct_send_enabled,graph_phone_number_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$1)
       ON CONFLICT (phone_number_id) DO UPDATE SET
         client_record_id=EXCLUDED.client_record_id,
         client_id=EXCLUDED.client_id,
         company_name=EXCLUDED.company_name,
         active=EXCLUDED.active,
         config_version=EXCLUDED.config_version,
         direct_send_enabled=EXCLUDED.direct_send_enabled,
         graph_phone_number_id=EXCLUDED.graph_phone_number_id,
         updated_at=now()
       RETURNING *`,
      [body.phoneNumberId,body.clientRecordId,body.clientId,body.companyName,
       body.active,config.versionKey,body.directSendEnabled],
    );
    return { ok: true, channel: result.rows[0] };
  });


  app.post('/internal/consumer/claim', async (request: FastifyRequest, reply: FastifyReply) => {
    requireInternalSecret(request);
    const parsed = consumerReceiptSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, issues: parsed.error.issues };
    }
    const body = parsed.data;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO edge_consumer_receipts
          (consumer_name,idempotency_key,status,lease_until)
         VALUES ($1,$2,'processing',now()+make_interval(secs => $3))
         ON CONFLICT DO NOTHING
         RETURNING status,lease_until`,
        [body.consumerName, body.idempotencyKey, body.leaseSeconds],
      );
      if (inserted.rows[0]) {
        await client.query('COMMIT');
        return { ok: true, acquired: true, alreadyCompleted: false, busy: false };
      }
      const existing = await client.query(
        `SELECT status,lease_until,result_json,last_error
         FROM edge_consumer_receipts
         WHERE consumer_name=$1 AND idempotency_key=$2
         FOR UPDATE`,
        [body.consumerName, body.idempotencyKey],
      );
      const row = existing.rows[0];
      if (!row) throw new Error('consumer_receipt_missing_after_conflict');
      if (row.status === 'completed') {
        await client.query('COMMIT');
        return { ok: true, acquired: false, alreadyCompleted: true, busy: false, result: row.result_json };
      }
      const leaseActive = row.status === 'processing' && new Date(row.lease_until).getTime() > Date.now();
      if (leaseActive) {
        await client.query('COMMIT');
        return { ok: true, acquired: false, alreadyCompleted: false, busy: true, leaseUntil: row.lease_until };
      }
      await client.query(
        `UPDATE edge_consumer_receipts
         SET status='processing',lease_until=now()+make_interval(secs => $3),last_error='',updated_at=now()
         WHERE consumer_name=$1 AND idempotency_key=$2`,
        [body.consumerName, body.idempotencyKey, body.leaseSeconds],
      );
      await client.query('COMMIT');
      return { ok: true, acquired: true, alreadyCompleted: false, busy: false, reclaimed: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/internal/consumer/complete', async (request: FastifyRequest, reply: FastifyReply) => {
    requireInternalSecret(request);
    const parsed = consumerCompleteSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, issues: parsed.error.issues };
    }
    const body = parsed.data;
    const result = await pool.query(
      `UPDATE edge_consumer_receipts
       SET status='completed',result_json=$3::jsonb,last_error='',lease_until=now(),updated_at=now()
       WHERE consumer_name=$1 AND idempotency_key=$2
       RETURNING status,result_json`,
      [body.consumerName, body.idempotencyKey, JSON.stringify(body.result)],
    );
    if (!result.rows[0]) {
      reply.code(404);
      return { ok: false, error: 'consumer_receipt_not_found' };
    }
    return { ok: true, completed: true, receipt: result.rows[0] };
  });

  app.post('/internal/consumer/fail', async (request: FastifyRequest, reply: FastifyReply) => {
    requireInternalSecret(request);
    const parsed = consumerFailSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, issues: parsed.error.issues };
    }
    const body = parsed.data;
    const result = await pool.query(
      `UPDATE edge_consumer_receipts
       SET status='failed',last_error=$3,lease_until=now(),updated_at=now()
       WHERE consumer_name=$1 AND idempotency_key=$2
       RETURNING status,last_error`,
      [body.consumerName, body.idempotencyKey, body.error],
    );
    return { ok: true, failed: Boolean(result.rows[0]), receipt: result.rows[0] || null };
  });

  app.post('/internal/conversations/bootstrap', async (request: FastifyRequest, reply: FastifyReply) => {
    requireInternalSecret(request);
    const parsed = bootstrapSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, issues: parsed.error.issues };
    }
    const body = parsed.data;
    const config = await configs.getActiveSnapshot(body.clientRecordId);
    const receivedAt = body.lastInboundAt || null;
    const result = await pool.query(
      `INSERT INTO edge_conversations (
        client_record_id, client_id, phone_normalized, lead_record_id, lead_id,
        lead_name, company_name, project_name, project_record_id,
        current_stage, current_question_key, preferred_language, answers_json,
        retry_count, status, human_takeover, stop_follow_up, closed_status,
        appointment_status, assigned_salesperson_record_id, assigned_salesperson_phone,
        last_inbound_at, conversation_window_expires_at, conversation_engine,
        state_authority, config_version, configuration_version_id
       ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21,
        $22::timestamptz, CASE WHEN $22::timestamptz IS NULL THEN NULL ELSE $22::timestamptz + interval '24 hours' END,
        $23,$24,$25,$26
       )
       ON CONFLICT (client_record_id, phone_normalized)
       DO UPDATE SET
        client_id=COALESCE(NULLIF(EXCLUDED.client_id,''),edge_conversations.client_id),
        lead_record_id=COALESCE(NULLIF(EXCLUDED.lead_record_id,''),edge_conversations.lead_record_id),
        lead_id=COALESCE(NULLIF(EXCLUDED.lead_id,''),edge_conversations.lead_id),
        lead_name=COALESCE(NULLIF(EXCLUDED.lead_name,''),edge_conversations.lead_name),
        company_name=COALESCE(NULLIF(EXCLUDED.company_name,''),edge_conversations.company_name),
        project_name=COALESCE(NULLIF(EXCLUDED.project_name,''),edge_conversations.project_name),
        project_record_id=COALESCE(NULLIF(EXCLUDED.project_record_id,''),edge_conversations.project_record_id),
        current_stage=EXCLUDED.current_stage,
        current_question_key=EXCLUDED.current_question_key,
        preferred_language=EXCLUDED.preferred_language,
        answers_json=EXCLUDED.answers_json,
        retry_count=EXCLUDED.retry_count,
        status=EXCLUDED.status,
        human_takeover=EXCLUDED.human_takeover,
        stop_follow_up=EXCLUDED.stop_follow_up,
        closed_status=EXCLUDED.closed_status,
        appointment_status=EXCLUDED.appointment_status,
        assigned_salesperson_record_id=EXCLUDED.assigned_salesperson_record_id,
        assigned_salesperson_phone=EXCLUDED.assigned_salesperson_phone,
        last_inbound_at=COALESCE(EXCLUDED.last_inbound_at,edge_conversations.last_inbound_at),
        conversation_window_expires_at=COALESCE(EXCLUDED.conversation_window_expires_at,edge_conversations.conversation_window_expires_at),
        conversation_engine='edge',
        state_authority='edge',
        config_version=CASE WHEN $27 THEN EXCLUDED.config_version ELSE edge_conversations.config_version END,
        configuration_version_id=CASE WHEN $27 THEN EXCLUDED.configuration_version_id ELSE edge_conversations.configuration_version_id END,
        state_version=edge_conversations.state_version+1,
        updated_at=now()
       RETURNING conversation_id, conversation_engine, state_authority, config_version, configuration_version_id, state_version`,
      [
        body.clientRecordId, body.clientId, body.phoneNormalized, body.leadRecordId, body.leadId,
        body.leadName, body.companyName, body.projectName, body.projectRecordId,
        body.currentStage, body.currentQuestionKey, body.preferredLanguage, JSON.stringify(body.answers),
        body.retryCount, body.status, body.humanTakeover, body.stopFollowUp, body.closedStatus,
        body.appointmentStatus, body.assignedSalespersonRecordId, body.assignedSalespersonPhone,
        receivedAt, 'edge', 'edge', config.versionKey, config.configurationVersionId, body.migrateConfig,
      ],
    );
    return { ok: true, conversation: result.rows[0] };
  });

  app.post('/internal/conversations/control', async (request: FastifyRequest, reply: FastifyReply) => {
    requireInternalSecret(request);
    const parsed = controlSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, issues: parsed.error.issues };
    }
    const body = parsed.data;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const control = await client.query(
        `INSERT INTO edge_lead_controls (
          client_record_id, phone_normalized, lead_record_id, status, current_stage,
          human_takeover, stop_follow_up, closed_status, appointment_status,
          assigned_salesperson_record_id, assigned_salesperson_phone,
          source, source_event_id, control_version
         ) VALUES ($1,$2,$3,$4,$5,COALESCE($6,false),COALESCE($7,false),$8,$9,$10,$11,$12,$13,1)
         ON CONFLICT (client_record_id,phone_normalized) DO UPDATE SET
          lead_record_id=COALESCE(NULLIF(EXCLUDED.lead_record_id,''),edge_lead_controls.lead_record_id),
          status=COALESCE(NULLIF(EXCLUDED.status,''),edge_lead_controls.status),
          current_stage=COALESCE(NULLIF(EXCLUDED.current_stage,''),edge_lead_controls.current_stage),
          human_takeover=COALESCE($6,edge_lead_controls.human_takeover),
          stop_follow_up=COALESCE($7,edge_lead_controls.stop_follow_up),
          closed_status=COALESCE(NULLIF(EXCLUDED.closed_status,''),edge_lead_controls.closed_status),
          appointment_status=COALESCE(NULLIF(EXCLUDED.appointment_status,''),edge_lead_controls.appointment_status),
          assigned_salesperson_record_id=COALESCE(NULLIF(EXCLUDED.assigned_salesperson_record_id,''),edge_lead_controls.assigned_salesperson_record_id),
          assigned_salesperson_phone=COALESCE(NULLIF(EXCLUDED.assigned_salesperson_phone,''),edge_lead_controls.assigned_salesperson_phone),
          source=EXCLUDED.source, source_event_id=EXCLUDED.source_event_id,
          control_version=edge_lead_controls.control_version+1, updated_at=now()
         RETURNING *`,
        [
          body.clientRecordId, body.phoneNormalized, body.leadRecordId,
          body.status ?? '', body.currentStage ?? '', body.humanTakeover ?? null,
          body.stopFollowUp ?? null, body.closedStatus ?? '', body.appointmentStatus ?? '',
          body.assignedSalespersonRecordId ?? '', body.assignedSalespersonPhone ?? '',
          body.source, body.sourceEventId,
        ],
      );
      const conversation = await client.query(
        `UPDATE edge_conversations SET
          status=COALESCE(NULLIF($3,''),status),
          current_stage=COALESCE(NULLIF($4,''),current_stage),
          human_takeover=COALESCE($5,human_takeover),
          stop_follow_up=COALESCE($6,stop_follow_up),
          closed_status=COALESCE(NULLIF($7,''),closed_status),
          appointment_status=COALESCE(NULLIF($8,''),appointment_status),
          assigned_salesperson_record_id=COALESCE(NULLIF($9,''),assigned_salesperson_record_id),
          assigned_salesperson_phone=COALESCE(NULLIF($10,''),assigned_salesperson_phone),
          state_version=state_version+1, updated_at=now()
         WHERE client_record_id=$1 AND phone_normalized=$2
         RETURNING conversation_id, current_stage, human_takeover, stop_follow_up,
                   closed_status, appointment_status, state_version`,
        [
          body.clientRecordId, body.phoneNormalized, body.status ?? '', body.currentStage ?? '',
          body.humanTakeover ?? null, body.stopFollowUp ?? null, body.closedStatus ?? '',
          body.appointmentStatus ?? '', body.assignedSalespersonRecordId ?? '',
          body.assignedSalespersonPhone ?? '',
        ],
      );
      await client.query('COMMIT');
      return {
        ok: true,
        control: control.rows[0],
        conversation: conversation.rows[0] || null,
        appliedBeforeConversationExists: !conversation.rows[0],
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/internal/conversations/:clientRecordId/:phoneNormalized', async (request: FastifyRequest, reply: FastifyReply) => {
    requireInternalSecret(request);
    const params = z.object({ clientRecordId: z.string(), phoneNormalized: z.string() }).safeParse(request.params);
    if (!params.success) {
      reply.code(400);
      return { ok: false, issues: params.error.issues };
    }
    const result = await pool.query(
      `SELECT c.*,ctrl.control_version,ctrl.source AS control_source,ctrl.source_event_id
       FROM edge_conversations c
       LEFT JOIN edge_lead_controls ctrl USING (client_record_id,phone_normalized)
       WHERE c.client_record_id=$1 AND c.phone_normalized=$2`,
      [params.data.clientRecordId, params.data.phoneNormalized],
    );
    if (!result.rows[0]) {
      reply.code(404);
      return { ok: false, error: 'conversation_not_found' };
    }
    return { ok: true, conversation: result.rows[0] };
  });

  app.post('/internal/messages/whatsapp/send', async (request: FastifyRequest, reply: FastifyReply) => {
    requireInternalSecret(request);
    const parsed = whatsappSendSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, issues: parsed.error.issues };
    }
    const result = await messageRequests.requestWhatsAppSend(parsed.data);
    return { ok: true, ...result };
  });

  app.post('/internal/leads/intake', async (request: FastifyRequest, reply: FastifyReply) => {
    requireInternalSecret(request);
    const parsed = leadIntakeSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, issues: parsed.error.issues };
    }
    const result = await leadIntake.intake(parsed.data);
    return { ok: true, ...result };
  });
}

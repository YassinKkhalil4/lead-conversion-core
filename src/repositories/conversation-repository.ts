import type { PoolClient } from 'pg';
import type {
  ConversationEngine,
  ConversationState,
  ShadowEvaluateInput,
  StateAuthority,
} from '../domain/types.js';
import type { ConfigSnapshot } from './config-repository.js';

interface ConversationRow {
  conversation_id: string;
  client_record_id: string;
  client_id: string;
  phone_normalized: string;
  lead_record_id: string;
  lead_id: string;
  lead_name: string;
  company_name: string;
  project_name: string;
  project_record_id: string;
  preferred_language: string;
  current_stage: string;
  current_question_key: string;
  answers_json: Record<string, string>;
  retry_count: number;
  status: string;
  human_takeover: boolean;
  stop_follow_up: boolean;
  closed_status: string;
  appointment_status: string;
  assigned_salesperson_record_id: string;
  assigned_salesperson_phone: string;
  last_inbound_at: Date | string | null;
  conversation_window_expires_at: Date | string | null;
  conversation_engine: ConversationEngine;
  state_authority: StateAuthority;
  config_version: string;
  configuration_version_id: string | null;
  state_version: string | number;
}

const iso = (value: Date | string | null): string => {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

function rowToState(row: ConversationRow): ConversationState {
  return {
    conversationId: row.conversation_id,
    clientRecordId: row.client_record_id,
    clientId: row.client_id,
    phoneNormalized: row.phone_normalized,
    leadRecordId: row.lead_record_id,
    leadId: row.lead_id,
    leadName: row.lead_name,
    companyName: row.company_name,
    projectName: row.project_name,
    projectRecordId: row.project_record_id,
    preferredLanguage: row.preferred_language === 'Arabic' || row.preferred_language === 'English'
      ? row.preferred_language
      : '',
    currentStage: row.current_stage,
    currentQuestionKey: row.current_question_key,
    answers: row.answers_json || {},
    retryCount: row.retry_count,
    status: row.status,
    humanTakeover: row.human_takeover,
    stopFollowUp: row.stop_follow_up,
    closedStatus: row.closed_status,
    appointmentStatus: row.appointment_status,
    assignedSalespersonRecordId: row.assigned_salesperson_record_id,
    assignedSalespersonPhone: row.assigned_salesperson_phone,
    lastInboundAt: iso(row.last_inbound_at),
    conversationWindowExpiresAt: iso(row.conversation_window_expires_at),
    conversationEngine: row.conversation_engine,
    stateAuthority: row.state_authority,
    configVersion: row.config_version,
    configurationVersionId: row.configuration_version_id,
    stateVersion: Number(row.state_version),
  };
}

type ActiveConversationConfig = Pick<ConfigSnapshot, 'versionKey' | 'configurationVersionId'> | string;

function normalizeActiveConfig(activeConfig: ActiveConversationConfig): Pick<ConfigSnapshot, 'versionKey' | 'configurationVersionId'> {
  return typeof activeConfig === 'string'
    ? { versionKey: activeConfig, configurationVersionId: null }
    : activeConfig;
}

export class ConversationRepository {
  async lockScope(client: PoolClient, clientRecordId: string, phoneNormalized: string): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${clientRecordId}:${phoneNormalized}`]);
  }

  async find(client: PoolClient, clientRecordId: string, phoneNormalized: string): Promise<ConversationState | null> {
    const result = await client.query<ConversationRow>(
      `SELECT * FROM edge_conversations
       WHERE client_record_id=$1 AND phone_normalized=$2 FOR UPDATE`,
      [clientRecordId, phoneNormalized],
    );
    return result.rows[0] ? rowToState(result.rows[0]) : null;
  }

  async getOrCreate(
    client: PoolClient,
    input: ShadowEvaluateInput,
    activeConfig: ActiveConversationConfig,
    defaults: { conversationEngine: ConversationEngine; stateAuthority: StateAuthority },
  ): Promise<ConversationState> {
    const configPin = normalizeActiveConfig(activeConfig);
    const controlResult = await client.query<{
      status: string; current_stage: string; human_takeover: boolean; stop_follow_up: boolean;
      closed_status: string; appointment_status: string;
      assigned_salesperson_record_id: string; assigned_salesperson_phone: string;
    }>(
      `SELECT status,current_stage,human_takeover,stop_follow_up,closed_status,
              appointment_status,assigned_salesperson_record_id,assigned_salesperson_phone
       FROM edge_lead_controls WHERE client_record_id=$1 AND phone_normalized=$2`,
      [input.clientRecordId, input.phoneNormalized],
    );
    const control = controlResult.rows[0];
    const existing = await this.find(client, input.clientRecordId, input.phoneNormalized);
    if (existing) {
      const authoritative = input.stateAuthority ?? existing.stateAuthority;
      const rebase = authoritative === 'legacy';
      const receivedAt = input.receivedAt || input.lastInboundAt || new Date().toISOString();
      const windowExpires = new Date(new Date(receivedAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
      const next: ConversationState = {
        ...existing,
        clientId: input.clientId || existing.clientId,
        leadRecordId: input.leadRecordId || existing.leadRecordId,
        leadId: input.leadId || existing.leadId,
        leadName: input.leadName || existing.leadName,
        companyName: input.companyName || existing.companyName,
        projectName: input.projectName || existing.projectName,
        projectRecordId: input.projectRecordId || existing.projectRecordId,
        preferredLanguage: rebase && input.preferredLanguage !== undefined
          ? input.preferredLanguage
          : existing.preferredLanguage,
        currentStage: rebase && input.currentStage !== undefined
          ? input.currentStage
          : (control?.current_stage || existing.currentStage),
        currentQuestionKey: rebase && input.currentQuestionKey !== undefined
          ? input.currentQuestionKey
          : existing.currentQuestionKey,
        answers: rebase && input.answers !== undefined ? input.answers : existing.answers,
        retryCount: rebase && input.retryCount !== undefined ? input.retryCount : existing.retryCount,
        status: input.status ?? control?.status ?? existing.status,
        humanTakeover: input.humanTakeover ?? control?.human_takeover ?? existing.humanTakeover,
        stopFollowUp: input.stopFollowUp ?? control?.stop_follow_up ?? existing.stopFollowUp,
        closedStatus: input.closedStatus ?? control?.closed_status ?? existing.closedStatus,
        appointmentStatus: input.appointmentStatus ?? control?.appointment_status ?? existing.appointmentStatus,
        assignedSalespersonRecordId:
          input.assignedSalespersonRecordId ?? control?.assigned_salesperson_record_id ?? existing.assignedSalespersonRecordId,
        assignedSalespersonPhone: input.assignedSalespersonPhone ?? control?.assigned_salesperson_phone ?? existing.assignedSalespersonPhone,
        lastInboundAt: receivedAt,
        conversationWindowExpiresAt: windowExpires,
        stateAuthority: authoritative,
        // Existing conversations stay pinned. A separate ownership/config migration changes this deliberately.
        configVersion: existing.configVersion,
        configurationVersionId: existing.configurationVersionId,
      };
      await this.update(client, next);
      return next;
    }

    const receivedAt = input.receivedAt || input.lastInboundAt || new Date().toISOString();
    const windowExpires = new Date(new Date(receivedAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
    const inserted = await client.query<ConversationRow>(
      `INSERT INTO edge_conversations (
        client_record_id, client_id, phone_normalized, lead_record_id, lead_id,
        lead_name, company_name, project_name, project_record_id,
        preferred_language, current_stage, current_question_key, answers_json,
        retry_count, status, human_takeover, stop_follow_up, closed_status,
        appointment_status, assigned_salesperson_record_id, assigned_salesperson_phone,
        last_inbound_at, conversation_window_expires_at, conversation_engine,
        state_authority, config_version, configuration_version_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,
        $20,$21,$22,$23,$24,$25,$26,$27
      ) RETURNING *`,
      [
        input.clientRecordId,
        input.clientId || '',
        input.phoneNormalized,
        input.leadRecordId,
        input.leadId || '',
        input.leadName || '',
        input.companyName || '',
        input.projectName || '',
        input.projectRecordId || '',
        input.preferredLanguage || '',
        input.currentStage || control?.current_stage || '',
        input.currentQuestionKey || '',
        JSON.stringify(input.answers || {}),
        input.retryCount || 0,
        input.status || control?.status || '',
        input.humanTakeover ?? control?.human_takeover ?? false,
        input.stopFollowUp ?? control?.stop_follow_up ?? false,
        input.closedStatus || control?.closed_status || '',
        input.appointmentStatus || control?.appointment_status || '',
        input.assignedSalespersonRecordId || control?.assigned_salesperson_record_id || '',
        input.assignedSalespersonPhone || control?.assigned_salesperson_phone || '',
        receivedAt,
        windowExpires,
        defaults.conversationEngine,
        input.stateAuthority || defaults.stateAuthority,
        configPin.versionKey,
        configPin.configurationVersionId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('Failed to insert conversation');
    return rowToState(row);
  }

  async update(client: PoolClient, state: ConversationState): Promise<void> {
    if (!state.conversationId) throw new Error('Conversation ID is required');
    await client.query(
      `UPDATE edge_conversations SET
        client_id=$2, lead_record_id=$3, lead_id=$4, lead_name=$5,
        company_name=$6, project_name=$7, project_record_id=$8,
        preferred_language=$9, current_stage=$10, current_question_key=$11,
        answers_json=$12::jsonb, retry_count=$13, status=$14,
        human_takeover=$15, stop_follow_up=$16, closed_status=$17,
        appointment_status=$18, assigned_salesperson_record_id=$19,
        assigned_salesperson_phone=$20, last_inbound_at=NULLIF($21,'')::timestamptz,
        conversation_window_expires_at=NULLIF($22,'')::timestamptz,
        conversation_engine=$23, state_authority=$24, config_version=$25,
        configuration_version_id=$26, state_version=$27, updated_at=now()
       WHERE conversation_id=$1`,
      [
        state.conversationId,
        state.clientId,
        state.leadRecordId,
        state.leadId,
        state.leadName,
        state.companyName,
        state.projectName,
        state.projectRecordId,
        state.preferredLanguage,
        state.currentStage,
        state.currentQuestionKey,
        JSON.stringify(state.answers),
        state.retryCount,
        state.status,
        state.humanTakeover,
        state.stopFollowUp,
        state.closedStatus,
        state.appointmentStatus,
        state.assignedSalespersonRecordId,
        state.assignedSalespersonPhone,
        state.lastInboundAt,
        state.conversationWindowExpiresAt,
        state.conversationEngine,
        state.stateAuthority,
        state.configVersion,
        state.configurationVersionId ?? null,
        state.stateVersion,
      ],
    );
  }
}

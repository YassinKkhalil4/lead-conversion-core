export type Role = 'admin' | 'manager' | 'salesperson';

export interface User {
  userId: string;
  clientId: string;
  salespersonId: string | null;
  email: string;
  name: string;
  role: Role;
  clientKey: string;
  companyName: string;
  timezone: string;
  lastLoginAt: string | null;
}

export interface Contact {
  contactId: string;
  name: string;
  phoneE164: string;
  email: string;
}

export interface LeadProject {
  projectId: string;
  projectName: string;
  location: string;
}

export interface LeadAssignment {
  leadAssignmentId: string;
  salespersonId: string;
  salespersonName: string;
  salespersonPhoneE164: string;
  status: string;
  assignedAt: string;
  acknowledgedAt: string | null;
}

export interface LeadScoreSummary {
  scoreRunId: string;
  score: number;
  temperature: string;
  scoringVersion: string;
  createdAt: string;
}

export interface Lead {
  leadId: string;
  clientId: string;
  status: string;
  currentStage: string;
  temperature: string;
  leadScore: number | null;
  source: string;
  provider: string;
  stopFollowUp: boolean;
  closedStatus: string;
  firstReceivedAt: string | null;
  firstContactedAt: string | null;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  sessionWindowExpiresAt: string | null;
  sessionWindowOpen: boolean;
  humanTakeover: boolean;
  messageCount: number;
  createdAt: string;
  contact: Contact;
  project: LeadProject | null;
  assignment: LeadAssignment | null;
  latestScore: LeadScoreSummary | null;
}

export interface LeadPage {
  leads: Lead[];
  total: number;
  limit: number;
  offset: number;
}

export interface QualificationAnswer {
  questionKey: string;
  order: number;
  answered: boolean;
  normalizedValue: string;
  rawValue: string;
  parserSource: string;
  answeredAt: string | null;
}

export interface ScoreFactor {
  key: string;
  value: unknown;
  points: number;
  reason: string;
}

export interface ScoreRun {
  scoreRunId: string;
  scoringVersion: string;
  score: number;
  temperature: string;
  factors: ScoreFactor[];
  missingAnswers: string[];
  createdAt: string;
}

export interface RoutingCandidate {
  salespersonId: string;
  name: string;
  rank: number;
  score: number;
  phoneE164: string;
  unitMatch: boolean;
  languageMatch: boolean;
  locationMatch: boolean;
  priorityRank: number;
  activeAssignmentCount: number;
  selected: boolean;
}

export interface RoutingRun {
  routingRunId: string;
  routingVersion: string;
  outcome: string;
  selectedSalespersonId: string | null;
  candidates: RoutingCandidate[];
  reasons: Record<string, unknown>;
  createdAt: string;
}

export interface Message {
  messageId: string;
  direction: 'inbound' | 'outbound' | string;
  channel: string;
  messageText: string;
  messageType: string;
  state: string;
  fromAddress: string;
  providerMessageId: string;
  createdAt: string;
}

export interface AssignmentHistoryItem {
  leadAssignmentId: string;
  salespersonId: string;
  salespersonName: string;
  salespersonPhoneE164: string;
  status: string;
  routingVersion: string;
  assignedAt: string;
  acknowledgedAt: string | null;
  closedAt: string | null;
}

export interface ActivityItem {
  auditEventId: string;
  eventType: string;
  actorType: string;
  actorId: string;
  aggregateType: string;
  aggregateId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface LeadDetail {
  lead: Lead;
  qualification: {
    qualificationSessionId: string | null;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    answers: QualificationAnswer[];
  };
  latestScoreRun: ScoreRun | null;
  latestRoutingRun: RoutingRun | null;
  assignments: AssignmentHistoryItem[];
  messages: Message[];
  activity: ActivityItem[];
}

export interface LeadFilters {
  status?: string[];
  temperature?: string[];
  assignedTo?: 'me' | 'unassigned' | string;
  source?: string[];
  search?: string;
  unacknowledged?: boolean;
  sort?: 'created_at' | 'lead_score' | 'last_message_at';
  direction?: 'asc' | 'desc';
}

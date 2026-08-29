export interface Actor {
  employeeId: number;
  leagueId: number;
  dealershipId: number | null;
  email: string;
  name: string;
  role: 'advisor' | 'manager' | 'commissioner';
}

export type AuthProvider = 'session' | 'cloudflare-access';

export interface Period {
  id: number;
  leagueId: number;
  label: string;
  startsOn: string;
  endsOn: string;
  status: 'open' | 'locked' | 'published';
  lockedAt: string | null;
  publishedAt: string | null;
}

export interface Dealership {
  id: number;
  leagueId: number;
  name: string;
  alias: string | null;
  archivedAt: string | null;
}

export interface Employee {
  id: number;
  leagueId: number;
  dealershipId: number | null;
  name: string;
  alias: string | null;
  email: string;
  role: 'advisor' | 'manager' | 'commissioner';
  hireDate: string | null;
  consecutiveFloaterMonths: number;
  archivedAt: string | null;
}

export interface League {
  id: number;
  organizationId: number;
  name: string;
  slug: string;
  timezone: string;
  submissionDays: number[];
  submissionCutoffTime: string;
  latePenaltyValue: string;
  latePenaltyStacks: boolean;
  trainingPenaltyValue: string;
  eligibilityNewHireGraceDays: number;
  eligibilityMinAdvisorsForManager: number;
  eligibilityFloaterRuleEnabled: boolean;
  attainmentCap: string | null;
  sendingDomain: string | null;
}

export interface EmailRecipient {
  id: number;
  leagueId: number;
  dealershipId: number | null;
  label: string;
  email: string;
  templates: string[];
  createdBy: number;
  createdAt: string;
  revokedAt: string | null;
}

export interface EmailLogRow {
  id: number;
  template: string;
  periodId: number | null;
  recipientEmail: string;
  status: 'queued' | 'sent' | 'failed';
  sentAt: string | null;
  createdAt: string;
}

export interface RosterMember {
  id: number;
  name: string;
  alias: string | null;
  status: 'eligible' | 'hidden' | 'terminated';
}

export interface Category {
  id: number;
  key: string;
  label: string;
  scope: 'advisor' | 'manager';
  unit: 'count' | 'currency' | 'ratio' | 'percent';
  direction: 'higher_better' | 'lower_better';
  isDerived: boolean;
  weight?: number | null;
}

export interface ScoreRow {
  id: number;
  periodId: number;
  scope: 'advisor' | 'manager' | 'team';
  employeeId: number | null;
  dealershipId: number | null;
  categoryBreakdown: Record<string, number>;
  total: string;
  penaltyTotal: string;
  position: number | null;
  isPublished: boolean;
  revision: number;
  employeeName?: string | null;
  dealershipName?: string | null;
}

export interface StandingsResponse {
  period: Period;
  advisors: ScoreRow[];
  managers: ScoreRow[];
  teams: ScoreRow[];
}

export interface Penalty {
  id: number;
  periodId: number;
  dealershipId: number | null;
  employeeId: number | null;
  kind: 'late_submission' | 'training_incomplete' | 'manual';
  value: string;
  reason: string;
}

export interface Announcement {
  id: number;
  title: string;
  body: string;
  audience: 'all' | 'managers' | 'advisors' | 'store';
  dealershipId: number | null;
  authorId: number;
  createdAt: string;
  read: boolean;
}

export interface ApiKey {
  id: number;
  name: string;
  dealershipId: number | null;
  scopes: string[];
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface RosterImportRow {
  line: number;
  name: string;
  email: string;
  alias: string | null;
  role: 'advisor' | 'manager' | 'commissioner';
  dealershipId: number | null;
  dealershipName: string | null;
  hireDate: string | null;
}

export interface RosterPreview {
  toCreate: RosterImportRow[];
  toUpdate: Array<RosterImportRow & { employeeId: number; restore: boolean; changes: string[] }>;
  unchanged: number;
  errors: string[];
  unmatchedStores: string[];
  expectedColumns: string[];
}

export interface RosterCommitResult {
  created: number;
  updated: number;
  unchanged: number;
}

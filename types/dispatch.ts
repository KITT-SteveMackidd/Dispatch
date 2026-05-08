export type AppRole = 'manager' | 'worker';

export type UserProfile = {
  uid: string;
  displayName: string;
  role: AppRole;
  phoneNumber?: string;
  avatarUrl?: string;
};

export type EventTaskAttachment = {
  id: string;
  name: string;
  url: string;
  kind: 'photo' | 'document';
};

export type EventTask = {
  id: string;
  name: string;
  description?: string;
  attachments?: EventTaskAttachment[];
  expectedOffsetMinutes?: number;
  dueAt?: string;
  optional?: boolean;
  completedBy?: string[];
};

export type EventRole = {
  id: string;
  name: string;
  assignedWorkerIds: string[];
  openSlots: number;
  tasks: EventTask[];
};

export type DispatchEvent = {
  id: string;
  managerId: string;
  name: string;
  location: string;
  startsAt: string;
  endsAt?: string;
  teamIds: string[];
  roles: EventRole[];
};

export type Team = {
  id: string;
  managerId: string;
  name: string;
  workerIds: string[];
};

export type WorkerInviteStatus =
  | 'created'
  | 'delivery_queued'
  | 'delivered'
  | 'delivery_failed'
  | 'pending_acceptance'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'revoked'
  | 'cancelled';

export type WorkerInvite = {
  id: string;
  managerId: string;
  teamId?: string;
  teamName?: string;
  email: string;
  normalizedEmail?: string;
  workerId?: string | null;
  token?: string;
  tokenPreview?: string;
  appLink?: string;
  status: WorkerInviteStatus;
  statusReason?: string;
  deliveryChannel?: 'email' | 'in_app';
  emailDelivery?: 'http-endpoint' | 'firebase-auth-email-link' | 'firebase-mail-collection';
  sendCount?: number;
  lastSentAt?: { toDate?: () => Date } | Date | null;
  expiresAt?: { toDate?: () => Date } | Date | null;
  consumedAt?: { toDate?: () => Date } | Date | null;
  acceptedAt?: { toDate?: () => Date } | Date | null;
  declinedAt?: { toDate?: () => Date } | Date | null;
  revokedAt?: { toDate?: () => Date } | Date | null;
  revokedBy?: string | null;
  cancelledAt?: { toDate?: () => Date } | Date | null;
  linkedAt?: { toDate?: () => Date } | Date | null;
  managerClearedAt?: { toDate?: () => Date } | Date | null;
  createdAt?: { toDate?: () => Date } | Date | null;
  sentAt?: { toDate?: () => Date } | Date | null;
};

export type EventTemplateTask = {
  id: string;
  name: string;
  description?: string;
  attachments?: EventTaskAttachment[];
  expectedOffsetMinutes: number;
};

export type EventTemplateRole = {
  id: string;
  name: string;
  tasks: EventTemplateTask[];
};

export type EventTemplate = {
  id: string;
  managerId: string;
  name: string;
  roles: EventTemplateRole[];
  defaultLocation?: string;
  defaultTime?: string;
  defaultDescription?: string;
  createdAt?: { toDate?: () => Date } | Date | null;
  updatedAt?: { toDate?: () => Date } | Date | null;
};

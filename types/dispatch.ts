export type AppRole = 'manager' | 'worker';

export type UserProfile = {
  uid: string;
  displayName: string;
  role: AppRole;
  onboardingCompleted?: boolean;
  organizationId?: string | null;
  organizationName?: string | null;
  email?: string | null;
  canonicalEmail?: string | null;
  phoneNumber?: string;
  avatarUrl?: string;
  scheduledEventReminderKeys?: string[];
};

export type Organisation = {
  id: string;
  name: string;
  managerIds: string[];
  workerIds?: string[];
  createdBy?: string;
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
  waitlistWorkerIds?: string[];
  eligibleWaitlistWorkerIds?: string[];
  waitlistInviteWorkerIds?: string[];
  removedWorkerIds?: string[];
  openSlots: number;
  tasks: EventTask[];
};

export type DispatchEvent = {
  id: string;
  managerId: string;
  organizationId?: string | null;
  revision?: number;
  name: string;
  location: string;
  locationPlaceId?: string;
  description?: string;
  startsAt: string;
  endsAt?: string;
  teamIds: string[];
  workerIds?: string[];
  roles: EventRole[];
  pendingInviteNotificationId?: string;
  pendingInviteRoleId?: string;
  pendingInviteNotificationIds?: Record<string, string>;
};

export type Team = {
  id: string;
  managerId: string;
  managerIds?: string[];
  organizationId?: string | null;
  organizationName?: string | null;
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
  organizationId?: string | null;
  organizationName?: string | null;
  email?: string | null;
  deliveryEmail?: string | null;
  normalizedEmail?: string;
  canonicalEmail?: string;
  workerId?: string | null;
  claimRequired?: boolean;
  secureInviteId?: string | null;
  inviteTokenId?: string | null;
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

export type ManagerInviteStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked' | 'cancelled';

export type ManagerInvite = {
  id: string;
  inviterId: string;
  organizationId: string;
  organizationName?: string | null;
  email?: string | null;
  deliveryEmail?: string | null;
  normalizedEmail?: string;
  canonicalEmail?: string;
  managerUserId?: string | null;
  claimRequired?: boolean;
  secureInviteId?: string | null;
  status: ManagerInviteStatus;
  statusReason?: string;
  createdAt?: { toDate?: () => Date } | Date | null;
  acceptedAt?: { toDate?: () => Date } | Date | null;
};

export type InviteTokenStatus = 'active' | 'consumed' | 'expired' | 'revoked' | 'cancelled';

export type InviteToken = {
  id: string;
  inviteId: string;
  managerId: string;
  teamId?: string | null;
  email: string;
  token: string;
  tokenPreview: string;
  status: InviteTokenStatus;
  expiresAt?: { toDate?: () => Date } | Date | null;
  consumedAt?: { toDate?: () => Date } | Date | null;
  revokedAt?: { toDate?: () => Date } | Date | null;
  cancelledAt?: { toDate?: () => Date } | Date | null;
  createdAt?: { toDate?: () => Date } | Date | null;
  updatedAt?: { toDate?: () => Date } | Date | null;
};

export type EventTemplateTask = {
  id: string;
  name: string;
  description?: string;
  attachments?: EventTaskAttachment[];
  expectedOffsetMinutes?: number;
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
  defaultLocationPlaceId?: string;
  defaultTime?: string;
  defaultDescription?: string;
  createdAt?: { toDate?: () => Date } | Date | null;
  updatedAt?: { toDate?: () => Date } | Date | null;
};

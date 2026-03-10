export type AppRole = 'manager' | 'worker';

export type UserProfile = {
  uid: string;
  displayName: string;
  role: AppRole;
  phoneNumber?: string;
  avatarUrl?: string;
};

export type EventTask = {
  id: string;
  name: string;
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

export type EventTemplateTask = {
  id: string;
  name: string;
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

export const documentRemindersCollection = "documentReminders";

export type DocumentReminderKind =
  | "travel-order-status"
  | "leave-application-status"
  | "permit-slip-expiry"
  | "accomplishment-report";

export type DocumentReminder = {
  id: string;
  recipientId: string;
  ownerId: string;
  kind: DocumentReminderKind;
  recordId?: string;
  read: boolean;
  createdAt?: unknown;
  date?: string;
  returnDate?: string;
  purpose?: string;
  destination?: string;
  leaveType?: string;
  inclusiveDateFrom?: string;
  inclusiveDateTo?: string;
  deletesAt?: unknown;
  month?: string;
  cycle?: 1 | 2;
  startDay?: number;
  endDay?: number;
  periodLabel?: string;
};

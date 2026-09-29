export type WorkflowStatus = "Pending" | "Approved" | "Disapproved";

export const LEGACY_PENDING_STATUS = "Processing";

export function normalizeWorkflowStatus(status: unknown): WorkflowStatus {
  if (status === "Approved" || status === "Disapproved") return status;
  return "Pending";
}

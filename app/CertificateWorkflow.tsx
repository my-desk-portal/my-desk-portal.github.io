"use client";

import type { ReactNode } from "react";

export type CertificateWorkflowStatus = "Pending" | "Approved" | "Disapproved";

export type CertificateWorkflowFields = {
  status?: CertificateWorkflowStatus;
  decidedAt?: unknown;
  decidedBy?: string;
  signerName?: string;
  signerDesignation?: string;
  signerOffice?: string;
  signatureAsset?: string;
};

function toDate(value: unknown): Date | null {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return null;
}

export function certificateWorkflowStatus(value?: string): CertificateWorkflowStatus {
  return value === "Approved" || value === "Disapproved" ? value : "Pending";
}

export function CertificateStatusBadge({ record, children }: { record: CertificateWorkflowFields; children?: ReactNode }) {
  const status = certificateWorkflowStatus(record.status);
  const decidedAt = toDate(record.decidedAt);
  const decisionTime = decidedAt
    ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(decidedAt)
    : "";

  return <span className={`certificate-workflow-status is-${status.toLowerCase()}`}>
    <strong>{status}</strong>
    {status !== "Pending" && (record.signerName || decisionTime) && <small>{[record.signerName ? `By ${record.signerName}` : "", decisionTime].filter(Boolean).join(" · ")}</small>}
    {children}
  </span>;
}

const publicAsset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
const fieldOperationsChiefSignature = "field_operations_division_chief_signature.png";

export function hasFieldOperationsChiefApprovalSignature(record: CertificateWorkflowFields) {
  return certificateWorkflowStatus(record.status) === "Approved"
    && record.signatureAsset === fieldOperationsChiefSignature
    && record.signerDesignation?.trim() === "Chief"
    && (record.signerOffice === "Division" || record.signerOffice === "Field Operations Division");
}

export function CertificateApprovalSignature({ record }: { record: CertificateWorkflowFields }) {
  if (!hasFieldOperationsChiefApprovalSignature(record)) return null;
  const approvedAt = toDate(record.decidedAt);
  const dateParts = approvedAt
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(approvedAt)
    : [];
  const datePart = (type: string) => dateParts.find((part) => part.type === type)?.value ?? "";
  const approvalDate = approvedAt ? `${datePart("year")}.${datePart("month")}.${datePart("day")}` : "";
  const approvalTime = approvedAt
    ? `${new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(approvedAt)} +0800`
    : "";
  const signerName = record.signerName || "Chief, Field Operations Division";
  return <div className="certificate-approved-signature" aria-label={`Digitally signed by ${signerName}${approvalDate ? ` on ${approvalDate}` : ""}`}>
    <img src={publicAsset(`/${fieldOperationsChiefSignature}`)} alt="" />
    <div className="certificate-approved-signature-meta">
      <span>Digitally Signed By</span>
      <strong>{signerName}</strong>
      {approvalDate && <small>Date: {approvalDate}</small>}
      {approvalTime && <small>Time: {approvalTime}</small>}
    </div>
  </div>;
}

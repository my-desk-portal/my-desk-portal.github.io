"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch, type QueryConstraint } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import { accountDivision, accountDivisionForApproval, accountOffice, hasAccountDesignation, unitsForOfficeDivision } from "@/lib/account-profile";
import type { AccountRole } from "@/lib/user-roles";
import { makeDocumentNotification } from "@/lib/document-notifications";
import { CertificateStatusBadge, certificateWorkflowStatus, type CertificateWorkflowFields, type CertificateWorkflowStatus } from "./CertificateWorkflow";
import DeleteConfirmation from "./DeleteConfirmation";
import RecordPagination, { useRecordPagination } from "./RecordPagination";
import "./certificate-approval.css";
import "./certificate-workflow.css";

type CertificateCollection = "certificatesOfAppearance" | "completionCertificates" | "appreciationCertificates" | "participationCertificates";
type CertificateQueueRecord = CertificateWorkflowFields & {
  id: string;
  collectionName: CertificateCollection;
  certificateType: string;
  ownerId: string;
  unit?: string;
  division?: string;
  recordType?: string;
  ownerOffice?: string;
  eventTitle?: string;
  eventDateFrom?: string;
  eventDateTo?: string;
  eventDate?: string;
  eventTimeFrom?: string;
  eventTimeTo?: string;
  destination?: string;
  eventDestination?: string;
  createdAt?: { toMillis?: () => number };
};

const certificateCollections: { name: CertificateCollection; label: string }[] = [
  { name: "certificatesOfAppearance", label: "Appearance" },
  { name: "completionCertificates", label: "Completion" },
  { name: "appreciationCertificates", label: "Appreciation" },
  { name: "participationCertificates", label: "Participation" },
];

function officeDivision(office: string) {
  if (office === "AMIA" || office === "FOD-AMIA") return "Agribusiness and Marketing Assistance Division";
  if (office === "AGRISTAT" || office === "FOD-AGRISTAT") return "Planning, Monitoring and Evaluation Division";
  if (office === "DRRM" || office === "FOD-DRRM") return "Disaster Risk Reduction and Management Division";
  return office;
}

function unitsForOffice(office: string, division: string) {
  const certificateUnits = new Set(["AMIA", "AGRISTAT", "DRRM"]);
  return unitsForOfficeDivision(office, division).filter((unit) => certificateUnits.has(unit));
}

function approvalSignerOffice(profile: Record<string, unknown>) {
  const version = typeof profile.profileFieldsVersion === "number" ? profile.profileFieldsVersion : 0;
  const office = typeof profile.office === "string" ? profile.office : "";
  const legacyProjectProgram = typeof profile.projectProgram === "string" ? profile.projectProgram : "";
  const legacyUnit = typeof profile.unit === "string" ? profile.unit : "";
  const rawOffice = version >= 2 && office.length > 0
    ? office
    : legacyProjectProgram.length > 0
      ? legacyProjectProgram
      : legacyUnit.length > 0
        ? legacyUnit
        : office;
  if (version >= 4) return office;
  if (rawOffice === "Field Operations Division (ILD)"
    || ["AGRISTAT", "AMIA", "DRRM", "FOD-AGRISTAT", "FOD-AMIA", "FOD-DRRM"].includes(rawOffice)
    || rawOffice.startsWith("FOD-")) return "Field Operations Division";
  return rawOffice;
}

function displaySchedule(record: CertificateQueueRecord) {
  const from = record.eventDateFrom || record.eventDate || "";
  const to = record.eventDateTo || from;
  if (!from && !to) return "\u2014";
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);
  const validRange = !Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime());
  const sameYear = validRange && fromDate.getFullYear() === toDate.getFullYear();
  const sameMonth = sameYear && fromDate.getMonth() === toDate.getMonth();
  const formatDate = (date: Date, value: string) => Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(date);
  let schedule = from === to
    ? formatDate(fromDate, from)
    : sameMonth
      ? `${new Intl.DateTimeFormat("en-PH", { month: "long" }).format(fromDate)} ${fromDate.getDate()}-${toDate.getDate()}, ${fromDate.getFullYear()}`
      : sameYear
        ? `${new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" }).format(fromDate)} \u2013 ${new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" }).format(toDate)}, ${fromDate.getFullYear()}`
        : `${formatDate(fromDate, from)} \u2013 ${formatDate(toDate, to)}`;
  if (record.eventTimeFrom) schedule += ` \u00b7 ${record.eventTimeFrom}${record.eventTimeTo ? `\u2013${record.eventTimeTo}` : ""}`;
  return schedule;
}

export default function CertificateApproval({ user, role, office, division, unit, assignment, designation }: {
  user: User;
  role: AccountRole;
  office?: string | null;
  division?: string | null;
  unit?: string | null;
  assignment?: string | null;
  designation?: string;
  accountName?: string;
}) {
  const [records, setRecords] = useState<CertificateQueueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CertificateQueueRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { currentPage, pageCount, visibleRecords, setPage } = useRecordPagination(records);
  const isChiefAdmin = role === "admin" && hasAccountDesignation(designation, "Chief");
  const reviewDivision = accountDivisionForApproval(office ?? "", unit ?? assignment ?? "", division ?? "");

  const accessMessage = useMemo(() => {
    if (role === "admin" && (!office || !reviewDivision)) return "Set your Office and Division in Profile to view certificates assigned to your division.";
    return "";
  }, [office, reviewDivision, role]);

  useEffect(() => {
    let active = true;
    setRecords([]);
    setError("");
    setMessage("");
    if (!db || (role === "admin" && (!isChiefAdmin || !office || !reviewDivision))) {
      setLoading(false);
      return () => { active = false; };
    }

    const firestore = db;
    setLoading(true);
    async function loadRecords() {
      try {
        const snapshots = await Promise.all(certificateCollections.map(async ({ name, label }) => {
          const constraints: QueryConstraint[] = [];
          if (role === "regular") constraints.push(where("ownerId", "==", user.uid));
          if (isChiefAdmin) {
            if (name === "certificatesOfAppearance") {
              constraints.push(where("division", "==", officeDivision(reviewDivision)));
            } else {
              const units = unitsForOffice(office!, reviewDivision);
              if (!units.length) return [];
              constraints.push(units.length === 1 ? where("unit", "==", units[0]) : where("unit", "in", units));
            }
          }
          const result = await getDocs(query(collection(firestore, name), ...constraints));
          return result.docs.map((item) => ({
            ...item.data(),
            id: item.id,
            collectionName: name,
            certificateType: label,
          } as CertificateQueueRecord));
        }));
        const loadedRecords = snapshots.flat();
        const blankOwnerIds = [...new Set(loadedRecords
          .filter((record) => record.collectionName === "certificatesOfAppearance" && record.recordType === "blank" && !record.ownerOffice?.trim())
          .map((record) => record.ownerId)
          .filter(Boolean))];
        const ownerOffices = new Map<string, string>();
        await Promise.all(blankOwnerIds.map(async (ownerId) => {
          try {
            const ownerProfile = await getDoc(doc(firestore, "users", ownerId));
            const ownerOffice = ownerProfile.exists() ? accountOffice(ownerProfile.data()) : null;
            if (typeof ownerOffice === "string" && ownerOffice.trim()) ownerOffices.set(ownerId, ownerOffice.trim());
          } catch {
            // Keep the approval list available if an owner's profile cannot be loaded.
          }
        }));
        if (!active) return;
        setRecords(loadedRecords.map((record) => {
          if (record.collectionName !== "certificatesOfAppearance" || record.recordType !== "blank") return record;
          const storedOwnerOffice = record.ownerOffice?.trim() ?? "";
          const ownerOffice = (storedOwnerOffice ? accountOffice({ office: storedOwnerOffice, profileFieldsVersion: 3 }) : null)
            || ownerOffices.get(record.ownerId)
            || "";
          return { ...record, ownerOffice, destination: ownerOffice || "" };
        }).sort((left, right) => (right.createdAt?.toMillis?.() ?? 0) - (left.createdAt?.toMillis?.() ?? 0)));
      } catch (cause) {
        if (!active) return;
        const code = (cause as { code?: string }).code;
        setError(code ? `Could not load certificates for approval (${code}).` : "Could not load certificates for approval. Refresh and try again.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadRecords();
    return () => { active = false; };
  }, [user.uid, role, office, division, unit, assignment, reviewDivision, isChiefAdmin]);

  async function decide(record: CertificateQueueRecord, status: Exclude<CertificateWorkflowStatus, "Pending">) {
    if (!db || certificateWorkflowStatus(record.status) === "Approved") return;
    const key = `${record.collectionName}:${record.id}`;
    setSavingKey(key);
    setError("");
    setMessage("");
    let signerProfile: Record<string, unknown> | null = null;
    try {
      const signerSnapshot = await getDoc(doc(db, "users", user.uid));
      if (signerSnapshot.exists()) signerProfile = signerSnapshot.data();
    } catch {
      // Fall through to a clear profile verification error below.
    }
    if (!signerProfile) {
      setError("Could not verify your approval profile. Refresh and try again.");
      setSavingKey(null);
      return;
    }
    const signerOffice = approvalSignerOffice(signerProfile);
    const signerDesignation = typeof signerProfile.designation === "string" ? signerProfile.designation : "";
    const signerName = typeof signerProfile.name === "string" ? signerProfile.name : "";
    let ownerProfile: Record<string, unknown> | null = null;
    if (record.ownerId && record.ownerId !== user.uid) {
      try {
        const ownerSnapshot = await getDoc(doc(db, "users", record.ownerId));
        if (ownerSnapshot.exists()) ownerProfile = ownerSnapshot.data();
      } catch {
        // Approval can continue without the owner's profile, but the special signature requires it.
      }
    }
    const ownerRole = ownerProfile?.accountRole;
    const isRegularFieldOperationsOwner = (ownerRole === "regular" || ownerRole === "user")
      && accountDivision(ownerProfile ?? {}) === "Field Operations Division";
    const useChiefSignature = record.collectionName === "certificatesOfAppearance"
      && record.recordType !== "blank"
      && isRegularFieldOperationsOwner
      && isChiefAdmin
      && signerProfile.profileFieldsVersion === 4
      && signerProfile.accountRole === "admin"
      && signerOffice === "Division"
      && signerProfile.division === "Field Operations Division"
      && signerProfile.unit === "Field Operations Division"
      && signerDesignation === "Chief"
      && status === "Approved";
    const decision = {
      status,
      decidedAt: serverTimestamp(),
      decidedBy: user.uid,
      signerName,
      signerDesignation,
      signerOffice,
      signatureAsset: useChiefSignature ? "field_operations_division_chief_signature.png" : "",
    };
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, record.collectionName, record.id), decision);
      if (record.ownerId && record.ownerId !== user.uid) {
        try {
          const ownerProfile = await getDoc(doc(db, "users", record.ownerId));
          const ownerRole = ownerProfile.exists() ? ownerProfile.data().accountRole : null;
          if (ownerRole === "regular" || ownerRole === "user") {
            const notification = makeDocumentNotification(db, {
              recipientId: record.ownerId,
              ownerId: user.uid,
              documentId: record.id,
              documentType: "Certificate Decision",
              certificateType: record.certificateType,
              certificateCollection: record.collectionName,
              decisionStatus: status,
              activityTitle: record.eventTitle || `Certificate of ${record.certificateType}`,
              destination: record.destination || record.eventDestination || "",
            });
            batch.set(notification.reference, notification.data);
          }
        } catch {
          // Keep an authorized decision from failing if the owner's profile cannot be read.
        }
      }
      await batch.commit();
      setRecords((current) => current.map((item) => item.id === record.id && item.collectionName === record.collectionName ? { ...item, ...decision, decidedAt: new Date() } : item));
      setMessage(`${record.certificateType} certificate ${status.toLowerCase()}.`);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code ? `Could not update this certificate (${code}).` : "Could not update this certificate. Refresh and try again.");
    } finally {
      setSavingKey(null);
    }
  }

  async function deleteRecord() {
    if (!db || !pendingDelete || certificateWorkflowStatus(pendingDelete.status) === "Approved") return;
    setDeleting(true);
    setError("");
    try {
      await deleteDoc(doc(db, pendingDelete.collectionName, pendingDelete.id));
      setRecords((current) => current.filter((record) => record.id !== pendingDelete.id || record.collectionName !== pendingDelete.collectionName));
      setMessage(`${pendingDelete.certificateType} certificate deleted.`);
      setPendingDelete(null);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code ? `Could not delete this certificate (${code}).` : "Could not delete this certificate.");
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return <>
    <section className="content-section certificate-approval-section">
      <div className="section-heading">
        <div><p className="eyebrow">Admin Panel</p><h2>Certificate Approval</h2><p className="muted">Review certificate submissions and their current status.</p></div>
      </div>
      {accessMessage && <p className="certificate-approval-notice">{accessMessage}</p>}
      {role === "regular" && <p className="certificate-approval-notice">Your certificates appear here with their current approval status. Only an authorized administrator can change a status.</p>}
      {error && <p className="certificate-approval-error" role="alert">{error}</p>}
      {message && <p className="certificate-approval-success" role="status">{message}</p>}
      {loading ? <p className="muted">Loading certificates...</p> : role === "admin" && !isChiefAdmin ? null : !accessMessage && records.length === 0 ? <div className="empty-state"><span className="empty-number">00</span><h3>No certificates to show</h3><p>Submitted certificates will appear here with their status.</p></div> : records.length > 0 && <div className="certificate-approval-table-wrap"><div className="certificate-approval-table">
        <div className="certificate-approval-head"><span>Type of Certificate</span><span>Title</span><span>Schedule</span><span>Destination</span><span>Status</span><span>Action</span></div>
        {visibleRecords.map((record) => {
          const status = certificateWorkflowStatus(record.status);
          const approved = status === "Approved";
          const rowKey = `${record.collectionName}:${record.id}`;
          const canManage = role === "superadmin" || isChiefAdmin;
          return <div className="certificate-approval-row" key={rowKey}>
            <strong>{record.certificateType}</strong>
            <span>{record.eventTitle || `Certificate of ${record.certificateType}`}</span>
            <span>{displaySchedule(record)}</span>
            <span>{record.destination || record.eventDestination || "—"}</span>
            <span><CertificateStatusBadge record={record} /></span>
            <div className="certificate-approval-actions">{canManage && !approved && <>
              <button type="button" className="row-action" disabled={savingKey !== null || deleting} onClick={() => void decide(record, "Approved")}>{savingKey === rowKey ? "Saving..." : "Approve"}</button>
              <button type="button" className="row-action" disabled={savingKey !== null || deleting || status === "Disapproved"} onClick={() => void decide(record, "Disapproved")}>Disapprove</button>
              <button type="button" className="delete-button" disabled={savingKey !== null || deleting} onClick={() => setPendingDelete(record)}>Delete</button>
            </>}</div>
          </div>;
        })}
      </div><RecordPagination totalRecords={records.length} currentPage={currentPage} pageCount={pageCount} onPageChange={setPage} label="Certificate Approval" /></div>}
    </section>
    <DeleteConfirmation open={Boolean(pendingDelete)} title="Delete certificate?" description="This certificate will be permanently removed. This action cannot be undone." busy={deleting} onCancel={() => setPendingDelete(null)} onConfirm={() => void deleteRecord()} />
  </>;
}

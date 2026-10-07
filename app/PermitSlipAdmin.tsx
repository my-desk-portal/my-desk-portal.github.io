"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import { ADMIN_EMAIL, SUPERADMIN_EMAIL, accountRoleForEmail } from "@/lib/user-roles";
import { normalizeWorkflowStatus, type WorkflowStatus } from "./workflow-status";
import { assignApprovedPermitNumbers, displayPermitNumber, highestApprovedPermitSequence, permitNumberYear } from "./permit-number";
import "./permit-slip-admin.css";

type PermitStatus = WorkflowStatus;
type PermitUnitFilter = "All" | "AGRISTAT" | "AMIA" | "DRRM";
type PermitUnit = Exclude<PermitUnitFilter, "All">;
type PersonDecision = { status?: PermitStatus; decidedAt?: unknown; signerName?: string; decidedBy?: string; approvedPermitNo?: string };
export type AdminPermit = {
  id: string;
  permitNo: string;
  permitNos?: string[];
  date: string;
  names: string[];
  name?: string;
  personUnits?: PermitUnit[];
  unit?: PermitUnit;
  purpose: string;
  ownerId?: string;
  personStatuses?: Record<string, PersonDecision>;
};

export const PERMIT_ADMIN_EMAILS = [ADMIN_EMAIL, SUPERADMIN_EMAIL] as const;
export function isPermitAdmin(email?: string | null) {
  return accountRoleForEmail(email) === "admin" || accountRoleForEmail(email) === "superadmin";
}

function permitNumber(permit: AdminPermit, index: number) {
  const personNumber = permit.permitNos?.[index];
  if (typeof personNumber === "string" && personNumber) return personNumber;
  return typeof permit.permitNo === "string" ? permit.permitNo : "";
}

function decisionKey(permit: AdminPermit, index: number) {
  const personNumber = permit.permitNos?.[index];
  if (typeof personNumber === "string" && personNumber) return personNumber;
  const permitNo = typeof permit.permitNo === "string" ? permit.permitNo : "";
  const keyBase = permitNo || permit.id;
  return permit.names.length > 1 ? `${keyBase}__person_${index + 1}` : keyBase;
}

function personStatus(permit: AdminPermit, index: number): PermitStatus {
  return normalizeWorkflowStatus(permit.personStatuses?.[decisionKey(permit, index)]?.status);
}

function monthString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthDateString(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return "";
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function displayDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`));
}

export default function PermitSlipAdmin({ user, mode, focusNotificationKey }: { user: User; mode: "statistics" | "status"; focusNotificationKey?: string | null }) {
  const [permits, setPermits] = useState<AdminPermit[]>([]);
  const [month, setMonth] = useState(monthString(new Date()));
  const [unitFilter, setUnitFilter] = useState<PermitUnitFilter>("All");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!db || !isPermitAdmin(user.email)) { setLoading(false); return; }
    const firestore = db;
    return onSnapshot(query(collection(firestore, "permits")), (snapshot) => {
      setPermits(snapshot.docs.map((permitDoc) => {
        const data = permitDoc.data() as Omit<AdminPermit, "id">;
        return {
          ...data,
          id: permitDoc.id,
          permitNo: typeof data.permitNo === "string" ? data.permitNo : "",
          permitNos: Array.isArray(data.permitNos) ? data.permitNos as string[] : undefined,
          names: Array.isArray(data.names) ? data.names : data.name ? [data.name] : [],
        };
      }).sort((left, right) => right.date.localeCompare(left.date)));
      setError("");
      setLoading(false);
    }, (snapshotError) => {
      setError(snapshotError.code ? `Could not load Permit Slips (${snapshotError.code}).` : "Could not load Permit Slips.");
      setLoading(false);
    });
  }, [user.email]);

  const entries = useMemo(() => permits.flatMap((permit) => permit.names.map((name, index) => ({
    permit,
    index,
    name,
    unit: permit.personUnits?.[index] ?? permit.unit,
    permitNo: permitNumber(permit, index),
    status: personStatus(permit, index),
    approvedPermitNo: permit.personStatuses?.[decisionKey(permit, index)]?.approvedPermitNo,
  }))), [permits]);
  const approvedPermitNumbers = useMemo(() => assignApprovedPermitNumbers(entries
    .filter((entry) => entry.status === "Approved")
    .map((entry) => ({ permitNo: entry.permitNo, approvedPermitNo: entry.approvedPermitNo }))), [entries]);

  const statusEntries = useMemo(() => entries
    .filter((entry) => unitFilter === "All" || entry.unit === unitFilter)
    .sort((left, right) => right.permitNo.localeCompare(left.permitNo, "en", { numeric: true, sensitivity: "base" })
      || right.permit.date.localeCompare(left.permit.date)), [entries, unitFilter]);

  useEffect(() => {
    if (mode !== "status" || !focusNotificationKey || loading) return;
    if (unitFilter !== "All") setUnitFilter("All");
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`permit-status-${encodeURIComponent(focusNotificationKey)}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusNotificationKey, loading, mode, statusEntries.length, unitFilter]);

  const monthlyStats = useMemo(() => {
    const stats = new Map<string, { name: string; purposes: Set<string>; approved: number; disapproved: number }>();
    for (const entry of entries) {
      if (!entry.permit.date?.startsWith(`${month}-`)) continue;
      if (unitFilter !== "All" && entry.unit !== unitFilter) continue;
      const key = entry.name.trim().toLocaleLowerCase();
      if (!key) continue;
      const row = stats.get(key) ?? { name: entry.name.trim(), purposes: new Set<string>(), approved: 0, disapproved: 0 };
      if (entry.permit.purpose?.trim()) row.purposes.add(entry.permit.purpose.trim());
      if (entry.status === "Approved") row.approved += 1;
      if (entry.status === "Disapproved") row.disapproved += 1;
      stats.set(key, row);
    }
    return [...stats.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [entries, month, unitFilter]);

  async function changeStatus(permit: AdminPermit, personIndex: number, status: PermitStatus) {
    if (!db || !isPermitAdmin(user.email)) return;
    if (personStatus(permit, personIndex) === "Approved") return;
    const permitNo = permitNumber(permit, personIndex);
    const statusKey = decisionKey(permit, personIndex);
    const key = `${permit.id}:${statusKey}`;
    setSavingKey(key);
    setError("");
    try {
      const firestore = db;
      const permitRef = doc(firestore, "permits", permit.id);
      const calendarRef = doc(firestore, "approvedPermitCalendar", `${permit.id}_${encodeURIComponent(statusKey)}`);
      const year = permitNumberYear(permitNo, permit.date);
      const counterRef = doc(firestore, "permitCounters", `approved-${year}`);
      const currentNumbers = assignApprovedPermitNumbers(entries
        .filter((entry) => entry.status === "Approved")
        .map((entry) => ({ permitNo: entry.permitNo, approvedPermitNo: entry.approvedPermitNo })));
      const baselineHighest = (targetYear: string) => entries.filter((entry) => entry.status === "Approved").reduce((highest, entry) => {
        const match = /^(\d{4})-(\d{4,})$/.exec(entry.approvedPermitNo ?? "");
        return match?.[1] === targetYear ? Math.max(highest, Number(match[2])) : highest;
      }, highestApprovedPermitSequence(currentNumbers, targetYear));

      await runTransaction(firestore, async (transaction) => {
        const permitSnapshot = await transaction.get(permitRef);
        if (!permitSnapshot.exists()) throw new Error("This Permit Slip no longer exists.");
        const data = permitSnapshot.data();
        const latestPermitNumbers = Array.isArray(data.permitNos) ? data.permitNos as unknown[] : [];
        const latestPermitNo = typeof latestPermitNumbers[personIndex] === "string"
          ? latestPermitNumbers[personIndex] as string
          : typeof data.permitNo === "string" ? data.permitNo : "";
        const latestDate = typeof data.date === "string" ? data.date : permit.date;
        const latestYear = permitNumberYear(latestPermitNo, latestDate);
        const currentDecision = (data.personStatuses as Record<string, PersonDecision> | undefined)?.[statusKey] ?? {};
        if (normalizeWorkflowStatus(currentDecision.status) === "Approved") {
          throw new Error("Approved Permit Slips cannot be changed.");
        }
        let approvedPermitNo = currentDecision.approvedPermitNo;

        if (status === "Approved") {
          const latestCounterRef = latestYear === year ? counterRef : doc(firestore, "permitCounters", `approved-${latestYear}`);
          const counterSnapshot = await transaction.get(latestCounterRef);
          const counterValue = Number(counterSnapshot.exists() ? counterSnapshot.data().lastNumber : 0) || 0;
          const assignedMatch = /^(\d{4})-(\d{4,})$/.exec(approvedPermitNo ?? "");
          if (!assignedMatch || assignedMatch[1] !== latestYear) {
            const startingNumber = counterSnapshot.exists() ? counterValue : baselineHighest(latestYear);
            const nextNumber = Math.max(startingNumber, counterValue) + 1;
            approvedPermitNo = `${latestYear}-${String(nextNumber).padStart(4, "0")}`;
            transaction.set(latestCounterRef, { year: latestYear, lastNumber: nextNumber });
          } else if (counterValue < Math.max(Number(assignedMatch[2]), baselineHighest(latestYear))) {
            transaction.set(latestCounterRef, { year: latestYear, lastNumber: Math.max(Number(assignedMatch[2]), baselineHighest(latestYear)) });
          }
        }
        if (status === "Approved" && !approvedPermitNo) throw new Error("Could not assign a PS No. Please try again.");

        const nextDecision: PersonDecision = {
          ...currentDecision,
          status,
          decidedAt: serverTimestamp(),
          decidedBy: user.email ?? "",
          signerName: "GERLIE B. ANTIPASO",
        };
        if (approvedPermitNo) nextDecision.approvedPermitNo = approvedPermitNo;
        transaction.update(permitRef, { [`personStatuses.${statusKey}`]: nextDecision });

        if (status === "Approved") {
          const names = Array.isArray(data.names) ? data.names as string[] : [];
          const units = Array.isArray(data.personUnits) ? data.personUnits as string[] : [];
          transaction.set(calendarRef, {
            permitId: permit.id,
            statusKey,
            status: "Approved",
            permitNo: latestPermitNo,
            approvedPermitNo,
            name: names[personIndex] ?? permit.names[personIndex] ?? "",
            date: latestDate,
            purpose: typeof data.purpose === "string" ? data.purpose : permit.purpose,
            unit: units[personIndex] ?? data.unit ?? permit.personUnits?.[personIndex] ?? permit.unit ?? "",
          });
        } else {
          transaction.delete(calendarRef);
        }
      });
    } catch (updateError) {
      const code = (updateError as { code?: string }).code;
      setError(code ? `Could not update ${permitNo} (${code}).` : `Could not update ${permitNo}.`);
    } finally {
      setSavingKey("");
    }
  }

  if (!isPermitAdmin(user.email)) return null;
  const title = mode === "statistics" ? "Permit Slip Statistics" : "Permit Slip Status";

  return <section className="content-section permit-admin-section">
    <div className="section-heading permit-admin-heading">
      <div><p className="eyebrow">Administrator access</p><h2>{title}</h2><p className="muted">{mode === "statistics" ? "Monthly approved and disapproved Permit Slips, grouped by person." : "Review and update each person’s Permit Slip independently."}</p></div>
      <div className="permit-admin-filters">{mode === "statistics" && <label>Month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>}<label>Unit<select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value as PermitUnitFilter)}><option value="All">All Units</option><option value="AGRISTAT">Agricultural Statistics</option><option value="AMIA">AMIA</option><option value="DRRM">DRRM</option></select></label></div>
    </div>
    {error && <div className="permit-admin-error" role="alert">{error}</div>}
    {loading ? <p className="permit-admin-empty">Loading Permit Slips…</p> : mode === "statistics" ? <>
      <p className="permit-admin-period">{monthDateString(month)}</p>
      {monthlyStats.length === 0 ? <p className="permit-admin-empty">No Permit Slips were created this month.</p> : <div className="permit-admin-table-wrap"><table className="permit-admin-table"><thead><tr><th>Name</th><th>Purpose</th><th>No. of Approved Permit Slips</th><th>No. of Disapproved Permit Slips</th></tr></thead><tbody>{monthlyStats.map((row) => <tr key={row.name}><td data-label="Name">{row.name}</td><td data-label="Purpose">{[...row.purposes].join("; ") || "—"}</td><td data-label="No. of Approved Permit Slips">{row.approved}</td><td data-label="No. of Disapproved Permit Slips">{row.disapproved}</td></tr>)}</tbody></table></div>}
    </> : statusEntries.length === 0 ? <p className="permit-admin-empty">{permits.length === 0 ? "No Permit Slips have been submitted." : "No Permit Slips match this unit."}</p> : <div className="permit-admin-table-wrap"><table className="permit-admin-table permit-status-table"><thead><tr><th>PS No.</th><th>Date</th><th>Name</th><th>Unit</th><th>Purpose</th><th>Status</th></tr></thead><tbody>{statusEntries.map(({ permit, index, name, unit, permitNo, status, approvedPermitNo }) => {
      const key = `${permit.id}:${decisionKey(permit, index)}`;
      const originalNumber = displayPermitNumber(permitNo);
      const displayedNumber = status === "Approved" ? (approvedPermitNo ?? approvedPermitNumbers[originalNumber] ?? originalNumber) || "—" : "Pending";
      return <tr id={`permit-status-${encodeURIComponent(key)}`} className={key === focusNotificationKey ? "permit-admin-notification-target" : undefined} key={key}><td data-label="PS No.">{displayedNumber}</td><td data-label="Date">{displayDate(permit.date)}</td><td data-label="Name">{name}</td><td data-label="Unit">{unit || "—"}</td><td data-label="Purpose">{permit.purpose || "—"}</td><td data-label="Status"><select className={`permit-admin-status permit-admin-status-${status.toLowerCase()}`} value={status} disabled={savingKey === key || status === "Approved"} title={status === "Approved" ? "Approved Permit Slips cannot be changed." : undefined} aria-label={`Status for ${name}, ${displayPermitNumber(permitNo)}${status === "Approved" ? ", locked after approval" : ""}`} onChange={(event) => void changeStatus(permit, index, event.target.value as PermitStatus)}><option>Pending</option><option>Approved</option><option>Disapproved</option></select>{savingKey === key && <small className="permit-admin-saving">Saving…</small>}</td></tr>;
    })}</tbody></table></div>}
  </section>;
}

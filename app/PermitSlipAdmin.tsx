"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, serverTimestamp, updateDoc, doc, type Timestamp } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import "./permit-slip-admin.css";

type PermitStatus = "Processing" | "Approved" | "Disapproved";
type PermitUnitFilter = "All" | "AGRISTAT" | "AMIA" | "DRRM";
type PersonDecision = { status?: PermitStatus; decidedAt?: Timestamp | Date | string; signerName?: string; decidedBy?: string };
type AdminPermit = {
  id: string;
  permitNo: string;
  permitNos?: string[];
  date: string;
  names: string[];
  name?: string;
  unit?: "AGRISTAT" | "AMIA" | "DRRM";
  purpose: string;
  ownerId?: string;
  personStatuses?: Record<string, PersonDecision>;
};

export const PERMIT_ADMIN_EMAILS = ["gerlieantipaso27@gmail.com", "rjamescute2@gmail.com"] as const;
export function isPermitAdmin(email?: string | null) {
  return Boolean(email && PERMIT_ADMIN_EMAILS.includes(email.trim().toLowerCase() as (typeof PERMIT_ADMIN_EMAILS)[number]));
}

function permitNumber(permit: AdminPermit, index: number) {
  return permit.permitNos?.[index] ?? permit.permitNo;
}

function decisionKey(permit: AdminPermit, index: number) {
  return permit.permitNos?.[index] ?? (permit.names.length > 1 ? `${permit.permitNo}__person_${index + 1}` : permit.permitNo);
}

function personStatus(permit: AdminPermit, index: number): PermitStatus {
  return permit.personStatuses?.[decisionKey(permit, index)]?.status ?? "Processing";
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

export default function PermitSlipAdmin({ user, mode }: { user: User; mode: "statistics" | "status" }) {
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
        return { ...data, id: permitDoc.id, names: Array.isArray(data.names) ? data.names : data.name ? [data.name] : [] };
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
    permitNo: permitNumber(permit, index),
    status: personStatus(permit, index),
  }))), [permits]);

  const statusEntries = useMemo(() => [...entries].sort((left, right) =>
    right.permitNo.localeCompare(left.permitNo, "en", { numeric: true, sensitivity: "base" })
      || right.permit.date.localeCompare(left.permit.date),
  ), [entries]);

  const monthlyStats = useMemo(() => {
    const stats = new Map<string, { name: string; purposes: Set<string>; approved: number; disapproved: number }>();
    for (const entry of entries) {
      if (!entry.permit.date?.startsWith(`${month}-`)) continue;
      if (unitFilter !== "All" && entry.permit.unit !== unitFilter) continue;
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
    const permitNo = permitNumber(permit, personIndex);
    const statusKey = decisionKey(permit, personIndex);
    const key = `${permit.id}:${statusKey}`;
    setSavingKey(key);
    setError("");
    try {
      await updateDoc(doc(db, "permits", permit.id), {
        [`personStatuses.${statusKey}`]: {
          status,
          decidedAt: serverTimestamp(),
          decidedBy: user.email,
          signerName: "GERLIE B. ANTIPASO",
        },
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
      {mode === "statistics" && <div className="permit-admin-filters"><label>Month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><label>Unit<select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value as PermitUnitFilter)}><option value="All">All units</option><option value="AGRISTAT">Agricultural Statistics</option><option value="AMIA">AMIA</option><option value="DRRM">DRRM</option></select></label></div>}
    </div>
    {error && <div className="permit-admin-error" role="alert">{error}</div>}
    {loading ? <p className="permit-admin-empty">Loading Permit Slips…</p> : mode === "statistics" ? <>
      <p className="permit-admin-period">{monthDateString(month)}</p>
      {monthlyStats.length === 0 ? <p className="permit-admin-empty">No Permit Slips were created this month.</p> : <div className="permit-admin-table-wrap"><table className="permit-admin-table"><thead><tr><th>Name</th><th>Purpose</th><th>No. of Approved Permit Slips</th><th>No. of Disapproved Permit Slips</th></tr></thead><tbody>{monthlyStats.map((row) => <tr key={row.name}><td data-label="Name">{row.name}</td><td data-label="Purpose">{[...row.purposes].join("; ") || "—"}</td><td data-label="No. of Approved Permit Slips">{row.approved}</td><td data-label="No. of Disapproved Permit Slips">{row.disapproved}</td></tr>)}</tbody></table></div>}
    </> : statusEntries.length === 0 ? <p className="permit-admin-empty">No Permit Slips have been submitted.</p> : <div className="permit-admin-table-wrap"><table className="permit-admin-table permit-status-table"><thead><tr><th>PS No.</th><th>Date</th><th>Name</th><th>Purpose</th><th>Status</th></tr></thead><tbody>{statusEntries.map(({ permit, index, name, permitNo, status }) => {
      const key = `${permit.id}:${decisionKey(permit, index)}`;
      return <tr key={key}><td data-label="PS No.">{permitNo}</td><td data-label="Date">{displayDate(permit.date)}</td><td data-label="Name">{name}</td><td data-label="Purpose">{permit.purpose || "—"}</td><td data-label="Status"><select className={`permit-admin-status permit-admin-status-${status.toLowerCase()}`} value={status} disabled={savingKey === key} aria-label={`Status for ${name}, ${permitNo}`} onChange={(event) => void changeStatus(permit, index, event.target.value as PermitStatus)}><option>Processing</option><option>Approved</option><option>Disapproved</option></select>{savingKey === key && <small className="permit-admin-saving">Saving…</small>}</td></tr>;
    })}</tbody></table></div>}
  </section>;
}

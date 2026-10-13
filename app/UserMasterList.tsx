"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { normalizeAccountRole, normalizeAccountStatus, type AccountRole, type AccountStatus } from "@/lib/user-roles";
import { accountOffice, accountAssignment } from "@/lib/account-profile";
import DeleteConfirmation from "./DeleteConfirmation";
import RecordPagination, { useRecordPagination } from "./RecordPagination";
import "./user-master-list.css";

type MasterListAccount = {
  id: string;
  name?: string;
  position?: string;
  designation?: string;
  office?: string;
  assignment?: string;
  projectProgram?: string;
  unit?: string;
  profileFieldsVersion?: number;
  isRootSuperAdmin?: boolean;
  accountStatus?: AccountStatus;
  accountRole?: AccountRole | "user";
};

const roleOptions: { value: AccountRole; label: string }[] = [
  { value: "superadmin", label: "Super Admin" },
  { value: "admin", label: "Admin" },
  { value: "regular", label: "Regular" },
];

export default function UserMasterList({ user }: { user: User }) {
  const [accounts, setAccounts] = useState<MasterListAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [pendingDelete, setPendingDelete] = useState<MasterListAccount | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const { currentPage, pageCount, visibleRecords, setPage } = useRecordPagination(accounts);

  useEffect(() => {
    if (!db) { setError("Firebase is not configured."); setLoading(false); return; }
    return onSnapshot(query(collection(db, "users"), where("emailVerified", "==", true)), (snapshot) => {
      const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as MasterListAccount));
      rows.sort((first, second) => {
        const statusOrder = (normalizeAccountStatus(first.accountStatus) === "Pending" ? 0 : 1) - (normalizeAccountStatus(second.accountStatus) === "Pending" ? 0 : 1);
        return statusOrder || String(first.name ?? "").localeCompare(String(second.name ?? ""), "en", { sensitivity: "base" });
      });
      setAccounts(rows);
      setError("");
      setLoading(false);
    }, (cause) => {
      const code = (cause as { code?: string }).code;
      setError(code ? `Could not load the Users' Master List (${code}).` : "Could not load the Users' Master List.");
      setLoading(false);
    });
  }, []);

  const accountCountLabel = useMemo(() => `${accounts.length} verified ${accounts.length === 1 ? "account" : "accounts"}`, [accounts.length]);

  async function updateAccount(account: MasterListAccount, changes: { accountStatus?: AccountStatus; accountRole?: AccountRole }) {
    if (!db || busyId) return;
    setBusyId(account.id);
    setError("");
    setMessage("");
    try {
      await updateDoc(doc(db, "users", account.id), changes);
      setMessage(`${account.name || "Account"} updated.`);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code ? `Could not update this account (${code}).` : "Could not update this account.");
    } finally {
      setBusyId("");
    }
  }

  async function deleteAccount() {
    if (!db || !pendingDelete || busyId) return;
    setBusyId(pendingDelete.id);
    setError("");
    setMessage("");
    try {
      await deleteDoc(doc(db, "users", pendingDelete.id));
      setMessage(`${pendingDelete.name || "Account"} removed from the Users' Master List and system access disabled.`);
      setPendingDelete(null);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code ? `Could not delete this account (${code}).` : "Could not delete this account.");
    } finally {
      setBusyId("");
    }
  }

  return <section className="content-section user-master-list-section">
    <div className="section-heading"><div><p className="eyebrow">Super Admin</p><h2>Users&apos; Master List</h2><p className="muted">Verified accounts waiting for approval and active system users.</p></div><span className="user-master-list-count">{accountCountLabel}</span></div>
    {error && <p className="user-master-list-message is-error" role="alert">{error}</p>}
    {message && <p className="user-master-list-message" role="status">{message}</p>}
    {loading ? <p className="muted">Loading verified accounts...</p> : accounts.length === 0 ? <div className="empty-state"><span className="empty-number">00</span><h3>No verified accounts yet</h3><p>Accounts appear here after their owners verify their email address and sign in.</p></div> : <>
      <div className="user-master-list-table-wrap"><table className="user-master-list-table"><thead><tr><th>Name</th><th>Position</th><th>Designation</th><th>Office</th><th>Assignment</th><th>Role</th><th>Status / Action</th></tr></thead><tbody>
      {visibleRecords.map((account) => {
        const status = normalizeAccountStatus(account.accountStatus);
        const role = normalizeAccountRole(account.accountRole);
        const protectedAccount = account.id === user.uid || account.isRootSuperAdmin === true;
        const busy = busyId === account.id;
        return <tr key={account.id}>
          <td data-label="Name"><strong>{account.name || "—"}</strong></td>
          <td data-label="Position">{account.position || "—"}</td>
          <td data-label="Designation">{account.designation || "—"}</td>
          <td data-label="Office">{accountOffice(account) || "—"}</td>
          <td data-label="Assignment">{accountAssignment(account) || "—"}</td>
          <td data-label="Role"><select aria-label={`Role for ${account.name || "account"}`} value={role} disabled={busy || protectedAccount} onChange={(event) => void updateAccount(account, { accountRole: event.target.value as AccountRole })}>{roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
          <td data-label="Status / Action"><div className="user-master-list-status-actions"><span className={`user-master-list-status is-${status.toLowerCase()}`}>{status}</span><div className="user-master-list-actions"><button type="button" className="row-action" disabled={busy || protectedAccount || status === "Approved"} onClick={() => void updateAccount(account, { accountStatus: "Approved" })}>{busy ? "Saving..." : "Approve"}</button><button type="button" className="row-action" disabled={busy || protectedAccount || status === "Disapproved"} onClick={() => void updateAccount(account, { accountStatus: "Disapproved" })}>{busy ? "Saving..." : "Disapprove"}</button><button type="button" className="delete-button" disabled={busy || protectedAccount} onClick={() => setPendingDelete(account)}>{busy ? "Deleting..." : "Delete"}</button></div></div></td>
        </tr>;
      })}
      </tbody></table></div>
      <RecordPagination totalRecords={accounts.length} currentPage={currentPage} pageCount={pageCount} onPageChange={setPage} label="Users' Master List" />
    </>}
    <DeleteConfirmation open={Boolean(pendingDelete)} title="Delete this account?" description={`Remove ${pendingDelete?.name || "this account"} from the Users' Master List? Its Firestore profile will be deleted, which disables access to My Desk.`} busy={Boolean(pendingDelete && busyId === pendingDelete.id)} onCancel={() => setPendingDelete(null)} onConfirm={() => void deleteAccount()} />
  </section>;
}

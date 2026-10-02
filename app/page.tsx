"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendPasswordResetEmail,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "@/lib/firebase";
import { parsePersonnelWorkbook, type PersonnelEntry } from "@/lib/personnel";
import NtaModule from "./Nta";
import TravelOrderModule from "./TravelOrder";
import LeaveApplicationModule from "./LeaveApplication";
import WhereaboutsCalendarModule from "./WhereaboutsCalendar";
import DeleteConfirmation from "./DeleteConfirmation";
import AccomplishmentReportModule from "./AccomplishmentReport";
import PermitSlipAdmin, { isPermitAdmin, type AdminPermit } from "./PermitSlipAdmin";
import CertificateOfAppearance from "./CertificateOfAppearance";
import CompletionCertificate from "./CompletionCertificate";
import AppreciationCertificate from "./AppreciationCertificate";
import ParticipationCertificate from "./ParticipationCertificate";
import { normalizeWorkflowStatus } from "./workflow-status";
import "./special-order.css";
import { assignApprovedPermitNumbers, displayPermitNumber } from "./permit-number";

type Unit = "AMIA" | "AGRISTAT" | "DRRM";
type PermitDecision = { status?: "Pending" | "Approved" | "Disapproved"; decidedAt?: unknown; signerName?: string; decidedBy?: string };
type Permit = { id: string; permitNo: string; permitNos?: string[]; date: string; names: string[]; personUnits?: Unit[]; unit: Unit; purpose: string; personStatuses?: Record<string, PermitDecision>; createdAt?: unknown };
type SpecialOrder = { id: string; subject: string; activityTitle: string; organizer: string; dateFrom: string; dateTo: string; timeFrom?: string; timeTo?: string; venue: string; participants: string[]; signatoryName?: string; signatoryDesignation?: string; createdAt?: unknown };

const specialOrderSignatories = [
  { name: "ENGR. RICARDO P. OÑATE JR.", designation: "Regional Executive Director" },
  { name: "REBECCA R. ATEGA", designation: "Regional Technical Director" },
] as const;

const units: Unit[] = ["AMIA", "AGRISTAT", "DRRM"];
const amiaDocumentTrackingLinks = [
  { label: "AMIA Status of Funds", href: "https://docs.google.com/spreadsheets/d/1wSNta-v-unsP5EvxZe5q1oA2YG0lF-xa/edit?gid=800892725" },
  { label: "Acknowledgement Receipt", href: "https://docs.google.com/spreadsheets/d/1u7k481x6vKfyV9btnCIOrBHAociNwZBy/edit?gid=1914856634" },
  { label: "AMIA Minimum Requirements", href: "https://docs.google.com/spreadsheets/d/1ZkedGbBjqZkJ0UEohZGBoPL3oafdbNlpsRNizUJ9bQY/edit?gid=1817634266" },
  { label: "AMIA Properties Under GBA", href: "https://docs.google.com/spreadsheets/d/1jJULlezndneDggyPKiX4C7nWeANdHeMZ/edit?gid=937100823" },
  { label: "AMIA Staff Directory", href: "https://docs.google.com/spreadsheets/d/1SMIOH-UvvM-edpCBfDO3FfWk7pEFhaKy/edit?gid=16567296" },
  { label: "AWS Update", href: "https://docs.google.com/spreadsheets/d/11FouwYOU4J1Z6hDMdjg8HGIwQteHBx4o/edit?gid=1735388733" },
  { label: "Calamity Updates Per Village", href: "https://docs.google.com/spreadsheets/d/1xsYWEK37-Wsaojr0c4viN2iXqIuCr9IN/edit?gid=1833610696" },
  { label: "Calendar of Activities", href: "https://docs.google.com/spreadsheets/d/1IMPltjcxMqNq4B4ebTYxLCjLYWPiCIA1/edit?gid=1167988669" },
  { label: "Drafts", href: "https://docs.google.com/spreadsheets/d/1KvwH2K6Fcx9yKKhI-TBPFYmymwU6i3VU/edit?gid=595053097" },
  { label: "Incoming and Outgoing Basic Correspondence", href: "https://docs.google.com/spreadsheets/d/1xmisHO1IMWiyFQZ6BDrS2Qotbymu5h0b/edit?gid=1840005247" },
  { label: "IPCRs", href: "https://docs.google.com/spreadsheets/d/19noRNTZNuiqK2Qt5HoKx9Y1t4oajJuPF/edit?gid=1505714350" },
  { label: "Others", href: "https://docs.google.com/spreadsheets/d/1C0iXV1Z3TIsAxB62c2jB25yfnhjMV3By/edit?gid=1490275197" },
  { label: "Philip Tracking", href: "https://docs.google.com/spreadsheets/d/1sGCV91KQfms2yuTF2iwuEz5o0SACouTTJKfRyZ1VrKA/edit?usp=sharing" },
  { label: "Physical Accomplishment Updates", href: "https://docs.google.com/spreadsheets/d/1o5hXhVjfOLbMP2KXvbxbF2OgArBMiSU0/edit?gid=328484245" },
  { label: "Procument Updates", href: "https://docs.google.com/spreadsheets/d/1rnl2NxgAXdhwLki0zFFEf4kGYiOcCqnL/edit?gid=387609537" },
  { label: "Recieved Documents via QR", href: "https://docs.google.com/spreadsheets/d/108R25W_RgTp3Mpgkuz2QmpqdriOg_P6J5Aemu68Db90/edit?gid=115756846" },
  { label: "Scanned Documents", href: "https://darfoxiii-my.sharepoint.com/my?id=%2Fpersonal%2Famia%5Fcaraga%5Fda%5Fgov%5Fph%2FDocuments%2F2026%20WORKING%20FILES%2FSCANNED%20DOCUMENTS%2DAPPROVED&viewid=a922d1ac%2Da10a%2D4277%2D80dc%2Dd5261e478759" },
  { label: "Special Tasks", href: "https://docs.google.com/spreadsheets/d/1Yc8lndKZSgNwWrbvBUycgDXX27l2SED5/edit?gid=2098609058" },
  { label: "Travel Order Maker 2026", href: "https://docs.google.com/spreadsheets/d/16xng3LBmgNAlBtB115t8ZWzPoPOxXUUQ/edit?gid=8330880" },
  { label: "Travel Orders and Post Travel Reports", href: "https://docs.google.com/spreadsheets/d/1hniVoqkTFN7WmouP2NrFzmfQ4bNWg5sK/edit?gid=1841021416" },
];
const profileUnitOptions: { value: Unit; label: string }[] = [
  { value: "AGRISTAT", label: "FOD-AGRISTAT" },
  { value: "AMIA", label: "FOD-AMIA" },
  { value: "DRRM", label: "FOD-DRRM" },
];
const publicAsset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;

function permitUnitForPersonnel(person?: PersonnelEntry): Unit | "" {
  const value = person?.unit.trim().toUpperCase();
  if (units.includes(value as Unit)) return value as Unit;
  return value === "AGRICULTURAL STATISTICS" ? "AGRISTAT" : "";
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(new Date(`${date}T00:00:00`));
}

function formatPhilippineDateTime(date: Date) {
  const dateText = new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(date);
  const timeParts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hourCycle: "h12", timeZone: "Asia/Manila" }).formatToParts(date);
  const timePart = (type: string) => timeParts.find((part) => part.type === type)?.value ?? "";
  const timeText = `${timePart("hour")}:${timePart("minute")} ${timePart("dayPeriod").toUpperCase()}`;
  return `${dateText} | ${timeText}`;
}

function getPhilippineBiometricsGreeting(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Manila" }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(part("weekday"))) return null;
  const minutes = Number(part("hour")) * 60 + Number(part("minute"));
  if (minutes >= 12 * 60 && minutes <= 12 * 60 + 29) return "BIOMETRICS Break-out";
  if (minutes >= 12 * 60 + 31 && minutes <= 12 * 60 + 59) return "BIOMETRICS Break-in";
  if (minutes >= 17 * 60 && minutes <= 17 * 60 + 15) return "BIOMETRICS Check-out";
  return null;
}

function formatTime(value?: string) {
  if (!value) return "";
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date(2000, 0, 1, hours, minutes);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}

function formatTimeRange(from?: string, to?: string) {
  const start = formatTime(from);
  const end = formatTime(to);
  return start && end ? `${start} to ${end}` : "—";
}

function signatureDate(value: unknown) {
  const date = value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function"
    ? value.toDate() as Date
    : value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}.${part("month")}.${part("day")}`;
}

function signatureTime(value: unknown) {
  const date = value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function"
    ? value.toDate() as Date
    : value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const time = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
  return `${time} +0800`;
}

function Login({ onError }: { onError: (message: string) => void }) {
  const [registering, setRegistering] = useState(false);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [position, setPosition] = useState("");
  const [unit, setUnit] = useState<Unit | "">("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    setAuthMessage(null);
    if (registering && (!firstName.trim() || !lastName.trim())) {
      setAuthMessage({ kind: "error", text: "Enter your first and last name." });
      return;
    }
    if (registering && !position.trim()) {
      setAuthMessage({ kind: "error", text: "Enter your position." });
      return;
    }
    if (registering && !unit) {
      setAuthMessage({ kind: "error", text: "Select your unit." });
      return;
    }
    if (registering && `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, " ").length > 120) {
      setAuthMessage({ kind: "error", text: "Your name must be 120 characters or fewer." });
      return;
    }
    if (registering && position.trim().length > 120) {
      setAuthMessage({ kind: "error", text: "Your position must be 120 characters or fewer." });
      return;
    }
    if (registering && password !== confirmPassword) return;
    setBusy(true);
    onError("");
    try {
      if (registering) {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        const name = `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, " ");
        await updateProfile(credential.user, { displayName: name });
        if (!db) throw new Error("Profile storage is unavailable.");
        await setDoc(doc(db, "users", credential.user.uid), { name, position: position.trim(), unit: unit as Unit });
        await sendEmailVerification(credential.user);
        await signOut(auth);
        setAuthMessage({ kind: "success", text: `A verification email was sent to ${email}. Verify your email before signing in.` });
      } else {
        const credential = await signInWithEmailAndPassword(auth, email, password);
        await reload(credential.user);
        if (!credential.user.emailVerified) {
          await sendEmailVerification(credential.user);
          await signOut(auth);
          setAuthMessage({ kind: "error", text: "Your email is not verified yet. We sent another verification link; verify your email before signing in." });
        }
      }
    } catch (error) {
      if (auth.currentUser && !auth.currentUser.emailVerified) await signOut(auth).catch(() => undefined);
      const firebaseError = error as { code?: string; message?: string };
      const code = firebaseError.code?.replace("auth/", "");
      const invalidSignInCodes = ["invalid-credential", "invalid-login-credentials", "user-not-found", "wrong-password"];
      const message = !registering && invalidSignInCodes.includes(code ?? "")
        ? "Email or password is incorrect. Please check your details and try again."
        : registering
          ? "Unable to create your account. Please check your details and try again."
          : "Unable to sign in. Please check your details and try again.";
      setAuthMessage({ kind: "error", text: message });
      onError(message);
    } finally { setBusy(false); }
  }

  async function sendLoginReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    const resetEmail = email.trim();
    setAuthMessage(null);
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      setAuthMessage({ kind: "success", text: `A password reset link was sent to ${resetEmail}. Check your inbox.` });
    } catch (error) {
      const firebaseError = error as { code?: string; message?: string };
      const code = firebaseError.code?.replace("auth/", "");
      const message = code === "user-not-found"
        ? "The email is not registered."
        : code ? `${code}: ${firebaseError.message ?? "Could not send a password reset link."}` : "Could not send a password reset link. Try again.";
      setAuthMessage({ kind: "error", text: message });
    } finally { setBusy(false); }
  }

  return <main className="auth-shell">
    <section className="auth-intro"><img className="brand-mark brand-logo" src="/my%20desk%20logo.png" alt="My Desk logo" draggable={false} onDragStart={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()} /><p className="eyebrow">MD Administration</p><h1>Keep every<br /><em>movement</em> accounted for.</h1><p className="intro-copy">A clear, dependable desk for creating and retrieving official docs.</p><div className="intro-note"><span>01</span><p>Authenticated access for your unit</p></div></section>
    <section className="auth-panel"><div className="auth-form-wrap"><div className="mobile-brand"><img className="brand-mark brand-logo" src="/my%20desk%20logo.png" alt="My Desk logo" draggable={false} onDragStart={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()} /><span>My Desk</span></div><p className="eyebrow">{forgotPasswordOpen ? "Password reset" : registering ? "New account" : "Welcome back"}</p><h2>{forgotPasswordOpen ? "Reset your password" : registering ? "Create your account" : <>Sign in to <img className="auth-title-logo" src="/my%20desk%20logo.png" alt="My Desk" draggable={false} onDragStart={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()} /></>}</h2>{(forgotPasswordOpen || registering) && <p className="muted">{forgotPasswordOpen ? "Enter your account email and we will send a password reset link." : "Create your account and verify your email to get started."}</p>}
      {authMessage && <div className={`auth-message auth-message-${authMessage.kind}`} role={authMessage.kind === "error" ? "alert" : "status"}>{authMessage.text}</div>}
      {forgotPasswordOpen ? <form className="auth-reset-form" onSubmit={sendLoginReset}>
        <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="your email here" required /></label>
        <button className="primary-button" disabled={busy}>{busy ? "Sending..." : "Reset"}</button>
        <button type="button" className="text-button" onClick={() => { setForgotPasswordOpen(false); setAuthMessage(null); }}>Back to Sign In</button>
      </form> : <>
        <form onSubmit={submit}>
          {registering && <div className="auth-name-fields"><label>First Name<input autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="First name" required /></label><label>Last Name<input autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="Last name" required /></label></div>}
          {registering && <label>Position<input autoComplete="organization-title" maxLength={120} value={position} onChange={(event) => setPosition(event.target.value)} placeholder="Your position" required /></label>}
          {registering && <label>Unit<select value={unit} onChange={(event) => setUnit(event.target.value as Unit | "")} required><option value="" disabled>Select your unit</option>{units.map((option) => <option key={option}>{option}</option>)}</select></label>}
          <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="your email here" required /></label>
          <label>Password<div className="password-field"><input type={showPassword ? "text" : "password"} autoComplete={registering ? "new-password" : "current-password"} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" required /><button type="button" className="password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide" : "Show"}</button></div></label>
          {registering && <label>Confirm Password<div className="password-field"><input type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" minLength={6} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Re-enter your password" required /><button type="button" className="password-toggle" aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"} onClick={() => setShowConfirmPassword(!showConfirmPassword)}>{showConfirmPassword ? "Hide" : "Show"}</button></div></label>}
          {registering && confirmPassword && confirmPassword !== password && <p className="auth-validation-message" role="alert">Passwords do not match.</p>}
          <button className="primary-button" disabled={busy}>{busy ? "Please wait..." : registering ? "Create account" : "Sign in"}</button>
        </form>
        <div className="auth-footer-actions">
          {!registering && !forgotPasswordOpen && <button type="button" className="text-button auth-forgot-password" onClick={() => { setForgotPasswordOpen(true); setAuthMessage(null); }}>Forgot Password?</button>}
          <button type="button" className="text-button" onClick={() => { setRegistering(!registering); setForgotPasswordOpen(false); setConfirmPassword(""); setShowConfirmPassword(false); setAuthMessage(null); onError(""); }}>{registering ? "Already have an account? Sign in" : "Need an account? Register here"}</button>
        </div>
      </>}
    </div></section>
  </main>;
}
function PermitForm({ user, onSaved, onCancel, onError }: { user: User; onSaved: (permit: Permit) => void; onCancel: () => void; onError: (message: string) => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [people, setPeople] = useState<{ name: string; unit: Unit | "" }[]>([{ name: "", unit: "" }]);
  const [purpose, setPurpose] = useState("");
  const [personnel, setPersonnel] = useState<PersonnelEntry[]>([]);
  const [personnelStatus, setPersonnelStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadPersonnel() {
      try {
        const response = await fetch(publicAsset("/Personnel.xlsx"), { cache: "no-store" });
        if (!response.ok) throw new Error("Personnel.xlsx could not be loaded.");
        const entries = (await parsePersonnelWorkbook(new Uint8Array(await response.arrayBuffer())))
          .sort((first, second) => first.name.localeCompare(second.name, "en", { sensitivity: "base" }));
        if (!entries.length) throw new Error("The personnel sheet has no names.");
        if (!cancelled) {
          setPersonnel(entries);
          setPersonnelStatus("ready");
        }
      } catch {
        if (!cancelled) setPersonnelStatus("error");
      }
    }
    void loadPersonnel();
    return () => { cancelled = true; };
  }, []);

  function selectPerson(index: number, name: string) {
    const selectedPerson = personnel.find((person) => person.name === name);
    setPeople((current) => current.map((person, currentIndex) => currentIndex === index
      ? { name, unit: permitUnitForPersonnel(selectedPerson) }
      : person));
  }

  function selectPersonUnit(index: number, unit: Unit | "") {
    setPeople((current) => current.map((person, currentIndex) => currentIndex === index ? { ...person, unit } : person));
  }

  function removePerson(index: number) {
    setPeople((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!db) return;
    const selectedPeople = people.map((person) => ({ ...person, name: person.name.trim() })).filter((person) => person.name);
    if (!selectedPeople.length) { onError("Select at least one personnel name."); return; }
    const missingUnit = selectedPeople.find((person) => !person.unit);
    if (missingUnit) { onError(`Select a unit for ${missingUnit.name}.`); return; }
    const nameList = selectedPeople.map((person) => person.name);
    const personUnits = selectedPeople.map((person) => person.unit as Unit);
    const firestore = db;
    setBusy(true); onError("");
    try {
      const year = new Date(`${date}T00:00:00`).getFullYear();
      const permit = await runTransaction(firestore, async (transaction) => {
        const unitCounterRefs = units.map((counterUnit) => doc(firestore, "permitCounters", `${counterUnit}-${year}`));
        const yearCounterRef = doc(firestore, "permitCounters", `year-${year}`);
        const counterSnapshots = await Promise.all([...unitCounterRefs, yearCounterRef].map((counterRef) => transaction.get(counterRef)));
        const firstNumber = Math.max(0, ...counterSnapshots.map((snapshot) => Number(snapshot.exists() ? snapshot.data().lastNumber : 0) || 0)) + 1;
        const permitNos = nameList.map((_, index) => `${year}-${String(firstNumber + index).padStart(4, "0")}`);
        const lastNumber = firstNumber + nameList.length - 1;
        const permitRef = doc(collection(firestore, "permits"));
        const record = { permitNo: permitNos[0], permitNos, date, names: nameList, personUnits, unit: personUnits[0], purpose: purpose.trim(), ownerId: user.uid, createdAt: serverTimestamp() };
        unitCounterRefs.forEach((counterRef, index) => transaction.set(counterRef, { lastNumber, unit: units[index], year }));
        transaction.set(yearCounterRef, { lastNumber, year });
        transaction.set(permitRef, record);
        return { id: permitRef.id, ...record } as Permit;
      });
      onSaved(permit);
    } catch (error) { onError(error instanceof Error ? error.message : "Unable to save permit."); }
    finally { setBusy(false); }
  }

  return <section className="content-section form-section permit-slip-form-section"><div className="section-heading"><div><p className="eyebrow">New record</p><h2>Enter permit details</h2><p className="muted">The permit number is generated automatically when you save.</p></div><button className="ghost-button" onClick={onCancel}>Cancel</button></div><form className="permit-form permit-slip-create-form" onSubmit={save}><label className="permit-date-field">Date<input className="permit-date-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><div className="permit-person-fields wide-field">{people.map((person, index) => { const personnelRecord = personnel.find((candidate) => candidate.name === person.name); const personnelUnit = permitUnitForPersonnel(personnelRecord); const unitNeedsManualSelection = Boolean(person.name) && !personnelUnit && !person.unit; return <div className="permit-person-entry" key={index}><label>Full name<select aria-label={`Full name ${index + 1}`} value={person.name} onChange={(event) => selectPerson(index, event.target.value)} required={index === 0} disabled={personnelStatus !== "ready"}><option value="" disabled>{personnelStatus === "loading" ? "Loading personnel..." : personnelStatus === "error" ? "Personnel list unavailable" : `Select person ${index + 1}`}</option>{personnel.map((candidate) => <option key={candidate.name} value={candidate.name}>{candidate.name}</option>)}</select></label><label>Unit<select aria-label={`Unit for ${person.name || `person ${index + 1}`}`} value={person.unit} onChange={(event) => selectPersonUnit(index, event.target.value as Unit | "")} required={Boolean(person.name)} disabled={personnelStatus !== "ready" || !person.name || Boolean(personnelUnit)}><option value="" disabled>{unitNeedsManualSelection ? "Select unit" : person.name ? "Select unit" : "Choose a name first"}</option>{profileUnitOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{unitNeedsManualSelection && <span className="permit-person-unit-warning" role="status">No supported unit is listed for this person. Select a unit.</span>}</label>{people.length > 1 && <button type="button" className="remove-participant" aria-label={`Remove person ${index + 1}`} onClick={() => removePerson(index)}>Remove</button>}</div>; })}<button type="button" className="text-button add-participant" onClick={() => setPeople((current) => [...current, { name: "", unit: "" }])}>+ Add name</button>{personnelStatus === "error" && <span className="auth-message auth-message-error" role="alert">Unable to load Personnel.xlsx. Reload the page to try again.</span>}</div><label className="wide-field permit-purpose-field">Purpose<textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Why is this permit being requested?" rows={5} required /></label><div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save"}</button></div></form></section>;
}

function PermitList({ permits, approvedPermitNumbers, deletingId, onNew, onPrint, onDelete }: { permits: Permit[]; approvedPermitNumbers: Record<string, string>; deletingId: string | null; onNew: () => void; onPrint: (permit: Permit) => void; onDelete: (permit: Permit) => void }) {
  return <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Your records</p><h2>Permit Slips</h2><p className="muted">{permits.length} {permits.length === 1 ? "slip" : "slips"} registered to your account.</p></div><button className="primary-button" onClick={onNew}>Add</button></div>{permits.length === 0 ? <div className="empty-state"><span className="empty-number">00</span><h3>No permit slips yet</h3><p>Create your first record to see it here.</p><button className="text-button" onClick={onNew}>Create a permit slip</button></div> : <div className="permit-table"><div className="table-head"><span>Permit no.</span><span>Date</span><span>Name</span><span>Unit</span><span>Actions</span></div>{permits.map((permit) => <div className="table-row" key={permit.id}><strong>{permit.names.map((_, index) => {
    const originalNumber = permit.permitNos?.[index] ?? permit.permitNo;
    if (normalizeWorkflowStatus(permit.personStatuses?.[permitDecisionKey(permit, index)]?.status) !== "Approved") return "Pending";
    const key = displayPermitNumber(originalNumber);
    return approvedPermitNumbers[key] ?? key;
  }).join(", ")}</strong><span>{formatDate(permit.date)}</span><span><span className="permit-person-name-list">{permit.names.map((name, index) => <span key={`${permit.id}-name-${index}`}>{name}</span>)}</span></span><span><span className="permit-person-unit-list">{permit.names.map((_, index) => <b className="unit-tag" key={`${permit.id}-unit-${index}`}>{permit.personUnits?.[index] ?? permit.unit}</b>)}</span></span><span className="permit-row-actions"><button type="button" className="row-action" onClick={() => onPrint(permit)}>View</button><button type="button" className="delete-button" disabled={deletingId !== null} onClick={() => onDelete(permit)}>{deletingId === permit.id ? "Deleting..." : "Delete"}</button></span></div>)}</div>}</section>;
}

function chunkNames(names: string[], size: number) {
  const chunks: string[][] = [];
  for (let index = 0; index < names.length; index += size) chunks.push(names.slice(index, index + size));
  return chunks;
}

function permitDecisionKey(permit: Permit, index: number) {
  return permit.permitNos?.[index] ?? (permit.names.length > 1 ? `${permit.permitNo}__person_${index + 1}` : permit.permitNo);
}

function permitPersonNumber(permit: Pick<Permit, "permitNo" | "permitNos" | "names">, index: number) {
  return permit.permitNos?.[index] ?? (permit.names.length > 1 ? `${permit.permitNo}__person_${index + 1}` : permit.permitNo);
}

function timestampMillis(value: unknown) {
  const date = value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function"
    ? value.toDate() as Date
    : value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  const milliseconds = date?.getTime();
  return typeof milliseconds === "number" && Number.isFinite(milliseconds) ? milliseconds : 0;
}

type PermitNotification = { permit: Permit; personIndex: number; permitNo: string; name: string; date: string; status: "Approved" | "Disapproved"; decidedAt?: unknown };
type PendingPermitNotification = { permitId: string; statusKey: string; permitNo: string; name: string; date: string; purpose: string; submittedAt: number };

function permitNotificationKey(notification: PermitNotification) {
  return `${notification.permit.id}:${notification.permitNo}:${notification.status}:${timestampMillis(notification.decidedAt)}`;
}

function singlePersonPermitPreview(permit: Permit | AdminPermit, personIndex: number): Permit {
  const personNumber = permit.permitNos?.[personIndex] ?? (permit.names.length > 1 ? `${permit.permitNo}__person_${personIndex + 1}` : permit.permitNo);
  const personUnit = permit.personUnits?.[personIndex] ?? permit.unit ?? "AGRISTAT";
  return {
    ...permit,
    permitNo: personNumber,
    permitNos: [personNumber],
    names: [permit.names[personIndex] ?? ""],
    personUnits: [personUnit],
    unit: personUnit,
  } as Permit;
}

function PermitNotificationCenter({ isAdmin, userId, count, notifications, pendingNotifications, onAdminOpen, onViewPermit }: {
  isAdmin: boolean;
  userId: string;
  count: number;
  notifications: PermitNotification[];
  pendingNotifications: PendingPermitNotification[];
  onAdminOpen: (notification: PendingPermitNotification) => void;
  onViewPermit: (notification: PermitNotification) => void;
}) {
  const [open, setOpen] = useState(false);
  const [readNotificationState, setReadNotificationState] = useState<{ userId: string; keys: string[] } | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`my-desk:read-permit-notifications:${userId}`);
      const keys = stored ? JSON.parse(stored) : [];
      setReadNotificationState({ userId, keys: Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [] });
    } catch {
      setReadNotificationState({ userId, keys: [] });
    }
  }, [userId]);

  const readNotificationKeys = readNotificationState?.userId === userId ? readNotificationState.keys : [];
  const readNotificationKeySet = new Set(readNotificationKeys);
  const unreadNotifications = notifications.filter((notification) => !readNotificationKeySet.has(permitNotificationKey(notification)));
  const visibleCount = isAdmin ? count : unreadNotifications.length;

  function markAsRead(notification: PermitNotification) {
    const keys = [...new Set([...readNotificationKeys, permitNotificationKey(notification)])];
    setReadNotificationState({ userId, keys });
    try {
      window.localStorage.setItem(`my-desk:read-permit-notifications:${userId}`, JSON.stringify(keys));
    } catch {
      // Dismiss for this session if browser storage is unavailable.
    }
  }

  return <div className="notification-center" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
    <button type="button" className="notification-button" aria-label={`${visibleCount} ${isAdmin ? "filed Permit Slip" : "unread approved or disapproved Permit Slip"} notifications`} title={`${visibleCount} ${isAdmin ? "filed Permit Slip" : "unread approved or disapproved Permit Slip"} notifications`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>
      {visibleCount > 0 && <span className="notification-badge" aria-hidden="true">{visibleCount > 99 ? "99+" : visibleCount}</span>}
    </button>
    {open && <div className="notification-dropdown" role="dialog" aria-label={isAdmin ? "Filed Permit Slip notifications" : "Permit Slip notifications"}>
      <div className="notification-dropdown-heading"><strong>{isAdmin ? "Filed Permit Slips" : "Permit Slip updates"}</strong><button type="button" onClick={() => setOpen(false)} aria-label="Close notifications">×</button></div>
      {isAdmin ? pendingNotifications.length === 0 ? <p className="notification-empty">No Permit Slips are awaiting review.</p> : <ul>{pendingNotifications.map((notification) => <li key={`${notification.permitId}-${notification.permitNo}`}><button type="button" className="notification-item" onClick={() => { setOpen(false); onAdminOpen(notification); }}>
        <span className="notification-status notification-status-pending">Awaiting review</span>
        <strong>{notification.name}</strong>
        <span className="notification-permit-number">Pending</span>
        {notification.purpose && <span className="notification-permit-number">{notification.purpose}</span>}
        <small>{notification.date ? formatDate(notification.date) : "Date not provided"}</small>
        <span className="notification-view-label">Open in Permit Slip Status</span>
      </button></li>)}</ul> : unreadNotifications.length === 0 ? <p className="notification-empty">You’re all caught up on Permit Slip updates.</p> : <ul>{unreadNotifications.map((notification) => <li key={permitNotificationKey(notification)}><button type="button" className="notification-item" onClick={() => { markAsRead(notification); setOpen(false); onViewPermit(notification); }}>
        <span className="notification-detail"><span className="notification-detail-label">Name</span><strong>{notification.name}</strong></span>
        <span className="notification-detail"><span className="notification-detail-label">Date</span><span>{notification.date ? formatDate(notification.date) : "Date not provided"}</span></span>
        <span className="notification-detail"><span className="notification-detail-label">Status</span><strong className={`notification-status notification-status-${notification.status.toLowerCase()}`}>{notification.status}</strong></span>
      </button></li>)}</ul>}
    </div>}
  </div>;
}

function PermitCard({ permit, name, permitNo, decisionKey, approvedPermitNumbers }: { permit: Permit; name: string; permitNo: string; decisionKey: string; approvedPermitNumbers: Record<string, string> }) {
  const decision = permit.personStatuses?.[decisionKey];
  const decisionTime = signatureTime(decision?.decidedAt);
  const isApproved = normalizeWorkflowStatus(decision?.status) === "Approved";
  const displayNumber = isApproved ? approvedPermitNumbers[displayPermitNumber(permitNo)] ?? displayPermitNumber(permitNo) : "Pending";
  return <article className="permit-document">
    <header className="permit-header">
      <div className="permit-logos">
        <img src={publicAsset("/bagong-pilipinas-logo.webp")} alt="Bagong Pilipinas" className="permit-logo-left" />
        <div className="permit-seal-wrap">
          <img src={publicAsset("/da-caraga-logo.jpg")} alt="Department of Agriculture Caraga Region" className="permit-logo-right" />
        </div>
      </div>
      <h1 className="permit-heading">PERMIT SLIP</h1>
      <img src={publicAsset("/maunlad_na_ekonomiya_logo.jpg")} alt="Masaganang Agrikultura, Maunlad na Ekonomiya" className="permit-logo-economy" />
    </header>

    <section className="permit-metadata">
      <div className="permit-meta-row">
        <span className="permit-label">PS No.</span>
        <span className="permit-colon">:</span>
        <span className="permit-input-line">{displayNumber}</span>
      </div>
      <div className="permit-meta-row">
        <span className="permit-label">Date</span>
        <span className="permit-colon">:</span>
        <span className="permit-input-line">{formatDate(permit.date)}</span>
      </div>
    </section>

    <div className="permit-body-watermarked">
      <img className="permit-body-watermark" src={publicAsset("/maunlad_na_ekonomiya_logo.jpg")} alt="" aria-hidden="true" />
      <h3 className="permit-banner">PERMIT TO LEAVE THE OFFICE IS GRANTED TO:</h3>
      <p className="permit-blank-line permit-blank-line-lg permit-name-line">{name}</p>

      <section className="permit-purpose-block">
        <h3>PURPOSE:</h3>
        <p className="permit-blank-line permit-filled-line">{permit.purpose}</p>
        <div className="permit-blank-line" />
      </section>

      <div className="permit-grid-wrap">
        <table className="permit-grid">
          <thead>
            <tr>
              <th>PLACES TO BE VISITED</th>
              <th>CERTIFYING OFFICER</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1.)</td><td /></tr>
            <tr><td>2.)</td><td /></tr>
            <tr><td>3.)</td><td /></tr>
            <tr><td>4.)</td><td /></tr>
            <tr><td>(5.)</td><td /></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div className="permit-signature-row">
      <div className="permit-guard-signature">GUARD'S SIGNATURE</div>
      <div className="permit-time-block">
        <div className="permit-time-row">
          <span className="permit-time-label">TIME OUT</span>
          <span className="permit-colon">:</span>
          <span className="permit-time-line" />
          <span className="permit-colon">:</span>
          <span className="permit-time-line" />
        </div>
        <div className="permit-time-row">
          <span className="permit-time-label">TIME IN</span>
          <span className="permit-colon">:</span>
          <span className="permit-time-line" />
          <span className="permit-colon">:</span>
          <span className="permit-time-line" />
        </div>
        <div className="permit-time-row">
          <span className="permit-time-label">TIME OUT</span>
          <span className="permit-colon">:</span>
          <span className="permit-time-line" />
          <span className="permit-colon">:</span>
          <span className="permit-time-line" />
        </div>
        <div className="permit-time-row">
          <span className="permit-time-label">TIME IN</span>
          <span className="permit-colon">:</span>
          <span className="permit-time-line" />
          <span className="permit-colon">:</span>
          <span className="permit-time-line" />
        </div>
      </div>
    </div>

    <div className="permit-approval">
      <div className="permit-approved-label">Approved:</div>
      {decision?.status === "Approved" && <div className="permit-digital-signature"><img src={publicAsset("/gba-signature.png")} alt="Digital signature of Gerlie B. Antipaso" /><div><span>Digitally Signed By</span><strong>{decision.signerName || "GERLIE B. ANTIPASO"}</strong><span>Date: {signatureDate(decision.decidedAt)}</span><span>Time: {decisionTime}</span></div></div>}
      {decision?.status === "Disapproved" && <div className="permit-disapproved-stamp"><strong>Disapproved</strong><span>Date: {signatureDate(decision.decidedAt)}</span><span>Time: {decisionTime}</span></div>}
      <div className="permit-approved-name">GERLIE B. ANTIPASO</div>
      <div className="permit-approved-role">DRRM/AMIA/AGRISTAT Head/Agriculturist II</div>
    </div>

  </article>;
}

function PrintPreview({ permit, approvedPermitNumbers, onClose, singleSlip = false }: { permit: Permit; approvedPermitNumbers: Record<string, string>; onClose: () => void; singleSlip?: boolean }) {
  const sheetsRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");
  const sheets = chunkNames(permit.names, 4);

  async function waitForImages(container: HTMLElement) {
    await Promise.all(Array.from(container.querySelectorAll("img")).map(async (image) => {
      if (!image.complete) await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("A permit logo could not be loaded.")); });
      if (image.naturalWidth === 0) throw new Error("A permit logo could not be loaded.");
      if (image.decode) await image.decode();
    }));
  }

  async function downloadPdf() {
    if (!sheetsRef.current) return;
    setDownloading(true);
    setDownloadError("");
    try {
      await waitForImages(sheetsRef.current);
      if (singleSlip) {
        const slip = sheetsRef.current.querySelector<HTMLElement>(".permit-document");
        if (!slip) throw new Error("The Permit Slip preview could not be found.");
        const canvas = await html2canvas(slip, { backgroundColor: "#fff", logging: false, scale: 3, useCORS: true });
        const slipBounds = slip.getBoundingClientRect();
        const pdfWidth = slipBounds.width * 25.4 / 96;
        const pdfHeight = pdfWidth * canvas.height / canvas.width;
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [pdfWidth, pdfHeight] });
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pdfWidth, pdfHeight);
        pdf.save(`permit-${displayPermitNumber(permit.permitNo)}.pdf`);
        return;
      }
      const sheetElements = Array.from(sheetsRef.current.querySelectorAll<HTMLElement>(".permit-sheet"));
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      for (let index = 0; index < sheetElements.length; index += 1) {
        const canvas = await html2canvas(sheetElements[index], { backgroundColor: "#fff", logging: false, scale: 3, useCORS: true });
        if (index > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 210, 297);
      }
      pdf.save(`permit-${displayPermitNumber(permit.permitNo)}.pdf`);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Unable to create the PDF.");
    } finally {
      setDownloading(false);
    }
  }

  async function printPreview() {
    if (!sheetsRef.current) return;
    setPrinting(true);
    setPrintError("");
    try {
      await waitForImages(sheetsRef.current);
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      window.print();
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : "Unable to prepare the Permit Slip for printing.");
    } finally {
      setPrinting(false);
    }
  }

  return <div className={singleSlip ? "preview-backdrop preview-backdrop-single" : "preview-backdrop"}>
    <div className={singleSlip ? "preview-toolbar preview-toolbar-single" : "preview-toolbar"}>
      {!singleSlip && <span>Permit preview</span>}
      <button type="button" className="ghost-button" onClick={onClose}>Close</button>
      {!singleSlip && <>
        <button type="button" className="pdf-button" disabled={downloading} onClick={downloadPdf}>{downloading ? "Preparing PDF..." : "Download PDF"}</button>
        <button type="button" className="pdf-button" disabled={printing} onClick={printPreview}>{printing ? "Preparing print..." : "Print"}</button>
        {downloadError && <small className="download-error">{downloadError}</small>}
        {printError && <small className="download-error" role="alert">{printError}</small>}
      </>}
    </div>
    <div ref={sheetsRef} className={singleSlip ? "permit-sheets permit-sheets-single" : "permit-sheets"}>
      {singleSlip
        ? <div className="permit-sheets-single-scale"><PermitCard permit={permit} name={permit.names[0] ?? ""} permitNo={permit.permitNos?.[0] ?? permit.permitNo} decisionKey={permitDecisionKey(permit, 0)} approvedPermitNumbers={approvedPermitNumbers} /></div>
        : sheets.map((sheetNames, sheetIndex) => <div className="permit-sheet" key={sheetIndex}>
          {sheetNames.map((name, nameIndex) => { const personIndex = sheetIndex * 4 + nameIndex; return <PermitCard permit={permit} name={name} permitNo={permit.permitNos?.[personIndex] ?? permit.permitNo} decisionKey={permitDecisionKey(permit, personIndex)} approvedPermitNumbers={approvedPermitNumbers} key={nameIndex} />; })}
        </div>)}
    </div>
  </div>;
}

function SpecialOrderForm({ user, onSaved, onCancel, onError }: { user: User; onSaved: (order: SpecialOrder) => void; onCancel: () => void; onError: (message: string) => void }) {
  const [subject, setSubject] = useState("");
  const [activityTitle, setActivityTitle] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState("");
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
  const [venue, setVenue] = useState("");
  const [signatoryName, setSignatoryName] = useState("");
  const selectedSignatory = specialOrderSignatories.find((signatory) => signatory.name === signatoryName);
  const [participants, setParticipants] = useState([""]);
  const [personnel, setPersonnel] = useState<PersonnelEntry[]>([]);
  const [personnelStatus, setPersonnelStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadPersonnel() {
      try {
        const response = await fetch(publicAsset("/Personnel.xlsx"), { cache: "no-store" });
        if (!response.ok) throw new Error("Personnel.xlsx could not be loaded.");
        const entries = (await parsePersonnelWorkbook(new Uint8Array(await response.arrayBuffer())))
          .sort((first, second) => first.name.localeCompare(second.name, "en", { sensitivity: "base" }));
        if (!entries.length) throw new Error("The personnel sheet has no names.");
        if (!cancelled) {
          setPersonnel(entries);
          setPersonnelStatus("ready");
        }
      } catch {
        if (!cancelled) setPersonnelStatus("error");
      }
    }
    void loadPersonnel();
    return () => { cancelled = true; };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!db) return;
    const participantList = participants.map((person) => person.trim()).filter(Boolean);
    if (!participantList.length) { onError("Select at least one designated participant."); return; }
    if (!selectedSignatory) { onError("Select a signatory."); return; }
    setBusy(true); onError("");
    try {
      const signatory = { signatoryName: selectedSignatory.name, signatoryDesignation: selectedSignatory.designation };
      const reference = await addDoc(collection(db, "specialOrders"), { subject: subject.trim(), activityTitle: activityTitle.trim(), organizer: organizer.trim(), dateFrom, dateTo: dateTo || dateFrom, timeFrom, timeTo, venue: venue.trim(), participants: participantList, ...signatory, ownerId: user.uid, createdAt: serverTimestamp() });
      onSaved({ id: reference.id, subject: subject.trim(), activityTitle: activityTitle.trim(), organizer: organizer.trim(), dateFrom, dateTo: dateTo || dateFrom, timeFrom, timeTo, venue: venue.trim(), participants: participantList, ...signatory });
    } catch (error) { onError(error instanceof Error ? error.message : "Unable to save special order."); }
    finally { setBusy(false); }
  }

  return <section className="content-section form-section special-order-form-section"><div className="section-heading"><div><p className="eyebrow">New record</p><h2>Create special order</h2><p className="muted">Add the activity details and designated participants.</p></div><button className="ghost-button" onClick={onCancel}>Cancel</button></div><form className="permit-form" onSubmit={save}><label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} required /></label><label>Title of the Activity<input value={activityTitle} onChange={(event) => setActivityTitle(event.target.value)} required /></label><label>Organizer or Host<input value={organizer} onChange={(event) => setOrganizer(event.target.value)} required /></label><div className="date-range-field"><span>Date</span><div><input aria-label="Date from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} required /><span>to</span><input aria-label="Date to" type="date" min={dateFrom} value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div></div><div className="date-range-field"><span>Time</span><div><input aria-label="Time from" type="time" value={timeFrom} onChange={(event) => setTimeFrom(event.target.value)} required /><span>to</span><input aria-label="Time to" type="time" value={timeTo} onChange={(event) => setTimeTo(event.target.value)} required /></div></div><label>Venue<input value={venue} onChange={(event) => setVenue(event.target.value)} required /></label><div className="participant-fields wide-field"><span>Designated Participant</span>{participants.map((participant, index) => <div className="participant-input" key={index}><select aria-label={`Designated participant ${index + 1}`} value={participant} onChange={(event) => setParticipants((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} required={index === 0} disabled={personnelStatus !== "ready"}><option value="" disabled>{personnelStatus === "loading" ? "Loading personnel..." : personnelStatus === "error" ? "Personnel list unavailable" : `Participant ${index + 1}`}</option>{personnel.map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}</select>{participants.length > 1 && <button type="button" className="remove-participant" aria-label={`Remove participant ${index + 1}`} onClick={() => setParticipants((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}</div>)}<button type="button" className="text-button add-participant" onClick={() => setParticipants((current) => [...current, ""])}>+ Add participant</button>{personnelStatus === "error" && <span className="auth-message auth-message-error" role="alert">Unable to load Personnel.xlsx. Reload the page to try again.</span>}</div><label>Signatory Name<select value={signatoryName} onChange={(event) => setSignatoryName(event.target.value)} required><option value="" disabled>Select a signatory</option>{specialOrderSignatories.map((signatory) => <option key={signatory.name} value={signatory.name}>{signatory.name}</option>)}</select></label><label>Signatory Designation<input value={selectedSignatory?.designation ?? ""} readOnly required /></label><div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save"}</button></div></form></section>;
}

function SpecialOrderList({ orders, deletingId, onNew, onPrint, onDelete }: { orders: SpecialOrder[]; deletingId: string | null; onNew: () => void; onPrint: (order: SpecialOrder) => void; onDelete: (order: SpecialOrder) => void }) {
  return <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Your records</p><h2>Special Orders</h2><p className="muted">{orders.length} {orders.length === 1 ? "order" : "orders"} registered to your account.</p></div><button className="primary-button" onClick={onNew}>Add</button></div>{orders.length === 0 ? <div className="empty-state"><span className="empty-number">00</span><h3>No special orders yet</h3><p>Create your first order to see it here.</p><button className="text-button" onClick={onNew}>Create a special order</button></div> : <div className="permit-table"><div className="table-head special-order-list-head"><span>Subject</span><span>Activity</span><span>Date</span><span>Participants</span><span></span></div>{orders.map((order) => <div className="table-row special-order-list-row" key={order.id}><strong>{order.subject}</strong><span>{order.activityTitle}</span><span>{formatDate(order.dateFrom)}{order.dateTo !== order.dateFrom && ` - ${formatDate(order.dateTo)}`}</span><span>{order.participants.length}</span><span className="permit-row-actions"><button type="button" className="row-action" onClick={() => onPrint(order)}>View</button><button type="button" className="delete-button" disabled={deletingId !== null} onClick={() => onDelete(order)}>{deletingId === order.id ? "Deleting..." : "Delete"}</button></span></div>)}</div>}</section>;
}

function SpecialOrderPreview({ order, onClose }: { order: SpecialOrder; onClose: () => void }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [personnel, setPersonnel] = useState<PersonnelEntry[]>([]);
  const [personnelStatus, setPersonnelStatus] = useState<"loading" | "ready" | "error">("loading");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");
  const [firstPageCount, setFirstPageCount] = useState(order.participants.length);
  const [firstPageSaturated, setFirstPageSaturated] = useState(false);
  const [continuationSettings, setContinuationSettings] = useState<{ capacity: number; saturated: boolean }[]>([]);
  const [closingUnitsOnLastAttendeePage, setClosingUnitsOnLastAttendeePage] = useState(7);
  const [closingPageSettings, setClosingPageSettings] = useState<{ capacity: number; saturated: boolean }[]>([]);
  const [signatoryPulledBack, setSignatoryPulledBack] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadPersonnel() {
      try {
        const response = await fetch(publicAsset("/Personnel.xlsx"), { cache: "no-store" });
        if (!response.ok) throw new Error("Personnel.xlsx could not be loaded.");
        const entries = await parsePersonnelWorkbook(new Uint8Array(await response.arrayBuffer()));
        if (!cancelled) {
          setPersonnel(entries);
          setPersonnelStatus("ready");
        }
      } catch {
        if (!cancelled) setPersonnelStatus("error");
      }
    }
    void loadPersonnel();
    return () => { cancelled = true; };
  }, []);

  const continuationPages: string[][] = [];
  const remainingParticipants = order.participants.slice(firstPageCount);
  let continuationOffset = 0;
  while (continuationOffset < remainingParticipants.length) {
    const pageIndex = continuationPages.length;
    const capacity = Math.max(1, continuationSettings[pageIndex]?.capacity ?? 24);
    continuationPages.push(remainingParticipants.slice(continuationOffset, continuationOffset + capacity));
    continuationOffset += capacity;
  }

  const closingUnits = [
    <p className="special-order-obligations special-order-closing-unit" data-special-order-closing-unit key="obligations">The above-named personnel shall actively participate in the said activity and are expected to:</p>,
    <ul className="special-order-obligation-list special-order-closing-unit" data-special-order-closing-unit key="represent"><li>Represent the office professionally;</li></ul>,
    <ul className="special-order-obligation-list special-order-closing-unit" data-special-order-closing-unit key="discussions"><li>Take note of important discussions, agreements, and action items;</li></ul>,
    <ul className="special-order-obligation-list special-order-closing-unit" data-special-order-closing-unit key="report"><li>Submit a brief written report and/or feedback within ____ days after the activity.</li></ul>,
    <p className="special-order-expenses special-order-closing-unit" data-special-order-closing-unit key="expenses">Travel and other incidental expenses, if any, shall be charged against available funds subject to existing accounting and auditing rules and regulations.</p>,
    <p className="special-order-done special-order-closing-unit" data-special-order-closing-unit key="done">Done this ____ day of ____________, {new Date().getFullYear()}</p>,
    <footer className="special-order-signatory special-order-closing-unit" data-special-order-closing-unit key="signatory"><strong>{order.signatoryName || specialOrderSignatories[0].name}</strong><span>{order.signatoryDesignation || specialOrderSignatories[0].designation}</span></footer>,
  ];
  const closingContinuationPages: (typeof closingUnits)[] = [];
  const remainingClosingUnits = closingUnits.slice(closingUnitsOnLastAttendeePage);
  let closingOffset = 0;
  while (closingOffset < remainingClosingUnits.length) {
    const pageIndex = closingContinuationPages.length;
    const capacity = Math.max(1, closingPageSettings[pageIndex]?.capacity ?? 7);
    closingContinuationPages.push(remainingClosingUnits.slice(closingOffset, closingOffset + capacity));
    closingOffset += capacity;
  }
  if (closingContinuationPages.length > 1) {
    const lastPage = closingContinuationPages[closingContinuationPages.length - 1];
    const previousPage = closingContinuationPages[closingContinuationPages.length - 2];
    if (lastPage.length === 1 && lastPage[0] === closingUnits[closingUnits.length - 1] && previousPage.length > 0) {
      const precedingUnit = previousPage.pop();
      if (precedingUnit) lastPage.unshift(precedingUnit);
      if (previousPage.length === 0) closingContinuationPages.splice(closingContinuationPages.length - 2, 1);
    }
  }
  const renderClosingUnits = (units: typeof closingUnits) => units.length > 0
    ? <div className={`special-order-closing${signatoryPulledBack && units.includes(closingUnits[closingUnits.length - 1]) ? " special-order-closing-pulled" : ""}`}>{units}</div>
    : null;

  useLayoutEffect(() => {
    const pages = pagesRef.current;
    if (!pages) return;

    const pageLimit = (page: HTMLElement) => {
      const rect = page.getBoundingClientRect();
      return rect.bottom - rect.width * 0.121;
    };

    const firstPage = pages.querySelector<HTMLElement>(".special-order-paper");
    if (!firstPage) return;

    const firstRows = Array.from(firstPage.querySelectorAll<HTMLElement>(".special-order-first-participants li"));
    const firstFitCount = firstRows.filter((row) => row.getBoundingClientRect().bottom <= pageLimit(firstPage)).length;
    if (firstFitCount < firstRows.length) {
      if (firstFitCount !== firstPageCount) setFirstPageCount(firstFitCount);
      if (!firstPageSaturated) setFirstPageSaturated(true);
      return;
    }
    if (firstPageCount < order.participants.length && !firstPageSaturated) {
      setFirstPageCount(firstPageCount + 1);
      return;
    }

    const continuationElements = Array.from(pages.querySelectorAll<HTMLElement>(".special-order-continuation-page"));
    const nextSettings = [...continuationSettings];
    for (let pageIndex = 0; pageIndex < continuationElements.length; pageIndex += 1) {
      const page = continuationElements[pageIndex];
      const rows = Array.from(page.querySelectorAll<HTMLElement>(".special-order-continuation-participants li"));
      const fitCount = rows.filter((row) => row.getBoundingClientRect().bottom <= pageLimit(page)).length;
      const current = nextSettings[pageIndex] ?? { capacity: 24, saturated: false };
      if (fitCount < rows.length) {
        const capacity = Math.max(1, fitCount);
        if (capacity !== current.capacity || !current.saturated) {
          nextSettings[pageIndex] = { capacity, saturated: true };
          setContinuationSettings(nextSettings);
          return;
        }
      } else if (pageIndex < continuationElements.length - 1 && rows.length === current.capacity && !current.saturated) {
        nextSettings[pageIndex] = { capacity: current.capacity + 1, saturated: false };
        setContinuationSettings(nextSettings);
        return;
      }
    }

    const lastAttendeePage = continuationElements[continuationElements.length - 1] ?? firstPage;
    const visibleClosingUnits = Array.from(lastAttendeePage.querySelectorAll<HTMLElement>(".special-order-closing-unit"));
    const closingFitCount = visibleClosingUnits.filter((unit) => unit.getBoundingClientRect().bottom <= pageLimit(lastAttendeePage)).length;
    if (closingFitCount < visibleClosingUnits.length) {
      const signatoryWouldBeTheOnlyOverflow = visibleClosingUnits[visibleClosingUnits.length - 1]?.classList.contains("special-order-signatory") && closingFitCount === visibleClosingUnits.length - 1;
      if (signatoryWouldBeTheOnlyOverflow && !signatoryPulledBack && closingUnitsOnLastAttendeePage === closingUnits.length) {
        setSignatoryPulledBack(true);
        return;
      }
      if (signatoryWouldBeTheOnlyOverflow && signatoryPulledBack) {
        setClosingUnitsOnLastAttendeePage(Math.max(0, visibleClosingUnits.length - 2));
        setSignatoryPulledBack(false);
        return;
      }
      if (closingFitCount !== closingUnitsOnLastAttendeePage) setClosingUnitsOnLastAttendeePage(closingFitCount);
      if (signatoryPulledBack) setSignatoryPulledBack(false);
      return;
    }

    const closingContinuationElements = Array.from(pages.querySelectorAll<HTMLElement>(".special-order-closing-page"));
    const lastClosingPage = closingContinuationElements[closingContinuationElements.length - 1];
    const lastClosingUnits = lastClosingPage ? Array.from(lastClosingPage.querySelectorAll<HTMLElement>(".special-order-closing-unit")) : [];
    if (closingContinuationElements.length === 1 && lastClosingUnits.length === 1 && lastClosingUnits[0].classList.contains("special-order-signatory")) {
      setClosingUnitsOnLastAttendeePage(closingUnits.length);
      return;
    }
    const nextClosingSettings = [...closingPageSettings];
    for (let pageIndex = 0; pageIndex < closingContinuationElements.length; pageIndex += 1) {
      const page = closingContinuationElements[pageIndex];
      const units = Array.from(page.querySelectorAll<HTMLElement>(".special-order-closing-unit"));
      const fitCount = units.filter((unit) => unit.getBoundingClientRect().bottom <= pageLimit(page)).length;
      const current = nextClosingSettings[pageIndex] ?? { capacity: 7, saturated: false };
      if (fitCount < units.length) {
        const capacity = Math.max(1, fitCount);
        if (capacity !== current.capacity || !current.saturated) {
          nextClosingSettings[pageIndex] = { capacity, saturated: true };
          setClosingPageSettings(nextClosingSettings);
          return;
        }
      } else if (pageIndex < closingContinuationElements.length - 1 && units.length === current.capacity && !current.saturated) {
        nextClosingSettings[pageIndex] = { capacity: current.capacity + 1, saturated: false };
        setClosingPageSettings(nextClosingSettings);
        return;
      }
    }
  }, [closingContinuationPages.length, closingPageSettings, closingUnitsOnLastAttendeePage, continuationPages.length, continuationSettings, firstPageCount, firstPageSaturated, order.participants, personnel, signatoryPulledBack]);

  async function downloadPdf() {
    if (!pagesRef.current) return;
    setDownloading(true); setDownloadError("");
    try {
      await Promise.all(Array.from(pagesRef.current.querySelectorAll("img")).map(async (image) => {
        if (!image.complete) await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("The Special Order letterhead could not be loaded.")); });
        if (image.decode) await image.decode();
      }));
      const pageElements = Array.from(pagesRef.current.querySelectorAll<HTMLElement>(".special-order-paper"));
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      for (let index = 0; index < pageElements.length; index += 1) {
        const canvas = await html2canvas(pageElements[index], { backgroundColor: "#fff", logging: false, scale: 3, useCORS: true });
        if (index > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 210, 297);
      }
      pdf.save(`special-order-${order.dateFrom}.pdf`);
    } catch (error) { setDownloadError(error instanceof Error ? error.message : "Unable to create the PDF."); }
    finally { setDownloading(false); }
  }

  async function printPreview() {
    if (!pagesRef.current) return;
    setPrinting(true);
    setPrintError("");
    try {
      await Promise.all(Array.from(pagesRef.current.querySelectorAll("img")).map(async (image) => {
        if (!image.complete) await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("The Special Order letterhead could not be loaded."));
        });
        if (image.naturalWidth === 0) throw new Error("The Special Order letterhead could not be loaded.");
        if (image.decode) await image.decode();
      }));
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      window.print();
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : "Unable to prepare the Special Order for printing.");
    } finally {
      setPrinting(false);
    }
  }

  const pageParticipants = (participants: string[], continued: boolean, pageKey: string, className: string, includeClosing: boolean) => <>
    <section className={`special-order-participants ${className}`}>
      {!continued && <div className="special-order-spacer" aria-hidden="true" />}
      <h2>{continued ? "Designated Participants (continued):" : order.participants.length === 1 ? "Designated Participant:" : "Designated Participants:"}</h2>
      <ol>{participants.map((participant, index) => { const position = personnel.find((person) => person.name === participant)?.position; return <li key={`${pageKey}-${index}`}><strong>{participant}</strong>{position && <>, <em>{position}</em></>}</li>; })}</ol>
    </section>
    {includeClosing && renderClosingUnits(closingUnits.slice(0, closingUnitsOnLastAttendeePage))}
  </>;

  const firstPageHasAllParticipants = continuationPages.length === 0;
  return <div className="preview-backdrop"><div className="preview-toolbar"><span>Special Order preview</span><button type="button" className="ghost-button" onClick={onClose}>Close</button><button type="button" className="pdf-button" disabled={downloading || personnelStatus === "loading"} onClick={downloadPdf}>{personnelStatus === "loading" ? "Loading personnel..." : downloading ? "Preparing PDF..." : "Download PDF"}</button><button type="button" className="pdf-button" disabled={printing || personnelStatus === "loading"} onClick={printPreview}>{personnelStatus === "loading" ? "Loading personnel..." : printing ? "Preparing print..." : "Print"}</button>{personnelStatus === "error" && <small className="download-error" role="status">Personnel positions could not be loaded.</small>}{downloadError && <small className="download-error">{downloadError}</small>}{printError && <small className="download-error" role="alert">{printError}</small>}</div>
    <div ref={pagesRef} className="special-order-preview-pages">
      <article className="special-order-paper"><img className="special-order-letterhead" src={publicAsset("/Document-Header-Footer.jpg")} alt="" /><div className="special-order-content"><header className="special-order-heading"><h1>SPECIAL ORDER</h1><p>No. <span /></p><p>Series of {new Date().getFullYear()}</p></header><div className="special-order-flow"><section className="special-order-subject"><p><b>SUBJECT :</b><span>{order.subject}</span></p></section><p className="special-order-intro">In view of the unavailability of the undersigned and/or the absence of specified participants on the received communications, the following personnel is/are hereby designated to attend and represent this Office in the activity detailed below:</p><div className="special-order-body"><section className="special-order-details"><p><b>Title of the Activity :</b><span>{order.activityTitle}</span></p><p><b>Organizer/ Host :</b><span>{order.organizer}</span></p><p><b>Date :</b><span>{formatDate(order.dateFrom)}{order.dateTo !== order.dateFrom && ` to ${formatDate(order.dateTo)}`}</span></p><p><b>Time :</b><span>{formatTimeRange(order.timeFrom, order.timeTo)}</span></p><p><b>Venue :</b><span>{order.venue}</span></p></section>{(firstPageCount > 0 || order.participants.length === 0) && pageParticipants(order.participants.slice(0, firstPageCount), false, "first", "special-order-first-participants", firstPageHasAllParticipants)}</div></div></div></article>
      {continuationPages.map((participants, index) => {
        const isLastPage = index === continuationPages.length - 1;
        return <article className="special-order-paper special-order-continuation-page" key={`continuation-${index}`}><img className="special-order-letterhead" src={publicAsset("/Document-Header-Footer.jpg")} alt="" /><div className="special-order-content"><div className="special-order-flow special-order-flow-continued">{pageParticipants(participants, true, `continuation-${index}`, "special-order-continuation-participants", isLastPage)}</div></div></article>;
      })}
      {closingContinuationPages.map((units, index) => <article className="special-order-paper special-order-closing-page" key={`closing-${index}`}><img className="special-order-letterhead" src={publicAsset("/Document-Header-Footer.jpg")} alt="" /><div className="special-order-content"><div className="special-order-flow special-order-flow-continued">{renderClosingUnits(units)}</div></div></article>)}
    </div>
  </div>;
}

export default function Home() {
  const [philippineDateTime, setPhilippineDateTime] = useState("");
  const [biometricsGreeting, setBiometricsGreeting] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [approvedPermitNumbers, setApprovedPermitNumbers] = useState<Record<string, string>>({});
  const [deletingPermitId, setDeletingPermitId] = useState<string | null>(null);
  const [pendingPermitDelete, setPendingPermitDelete] = useState<Permit | null>(null);
  const [pendingPermitNotifications, setPendingPermitNotifications] = useState<PendingPermitNotification[]>([]);
  const [focusedPermitNotificationKey, setFocusedPermitNotificationKey] = useState<string | null>(null);
  const [specialOrders, setSpecialOrders] = useState<SpecialOrder[]>([]);
  const [deletingSpecialOrderId, setDeletingSpecialOrderId] = useState<string | null>(null);
  const [pendingSpecialOrderDelete, setPendingSpecialOrderDelete] = useState<SpecialOrder | null>(null);
  const [view, setView] = useState<"list" | "new">("list");
  const [section, setSection] = useState<"permits" | "special-orders" | "nta" | "travel-orders" | "whereabouts-calendar" | "permit-statistics" | "permit-status" | "myar" | "leave-application" | "certificate-of-appearance" | "completion" | "appreciation" | "participation">("whereabouts-calendar");
  const [permitMenuOpen, setPermitMenuOpen] = useState(false);
  const [certificateMenuOpen, setCertificateMenuOpen] = useState(false);
  const [amiaDocumentMenuOpen, setAmiaDocumentMenuOpen] = useState(false);
  const [preview, setPreview] = useState<Permit | null>(null);
  const [singleSlipPreview, setSingleSlipPreview] = useState(false);
  const [specialOrderPreview, setSpecialOrderPreview] = useState<SpecialOrder | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileCertificateOpen, setMobileCertificateOpen] = useState(false);
  const [mobileAmiaDocumentOpen, setMobileAmiaDocumentOpen] = useState(false);
  const [mobilePermitOpen, setMobilePermitOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [changePassword, setChangePassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [resetEmailBusy, setResetEmailBusy] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profilePosition, setProfilePosition] = useState("");
  const [profileUnit, setProfileUnit] = useState<Unit>(units[0]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setPhilippineDateTime(formatPhilippineDateTime(now));
      setBiometricsGreeting(getPhilippineBiometricsGreeting(now));
    };
    updateClock();
    let interval = 0;
    const nextMinute = window.setTimeout(() => {
      updateClock();
      interval = window.setInterval(updateClock, 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      window.clearTimeout(nextMinute);
      if (interval) window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const preventAssetTransfer = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("img")) event.preventDefault();
    };
    document.addEventListener("dragstart", preventAssetTransfer, true);
    document.addEventListener("contextmenu", preventAssetTransfer, true);
    document.querySelectorAll("img").forEach((image) => { image.draggable = false; });
    return () => {
      document.removeEventListener("dragstart", preventAssetTransfer, true);
      document.removeEventListener("contextmenu", preventAssetTransfer, true);
    };
  }, []);

  function closeProfile() {
    setProfileOpen(false);
    setProfileMessage(null);
    setChangePassword("");
    setConfirmNewPassword("");
    setShowChangePassword(false);
    setShowConfirmNewPassword(false);
  }

  async function openProfile() {
    if (!user || !db) return;
    setProfileMenuOpen(false);
    setProfileOpen(true);
    setProfileLoading(true);
    setProfileMessage(null);
    setProfileName(user.displayName ?? "");
    setProfilePosition("");
    setProfileUnit(units[0]);
    try {
      const profileSnapshot = await getDoc(doc(db, "users", user.uid));
      if (profileSnapshot.exists()) {
        const profile = profileSnapshot.data();
        if (typeof profile.name === "string") setProfileName(profile.name);
        if (typeof profile.position === "string") setProfilePosition(profile.position);
        if (units.includes(profile.unit as Unit)) setProfileUnit(profile.unit as Unit);
      }
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setProfileMessage({ kind: "error", text: code ? `Could not load your profile (${code}).` : "Could not load your profile. Try again." });
    } finally {
      setProfileLoading(false);
    }
  }

  async function saveChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileMessage(null);
    const name = profileName.trim().replace(/\s+/g, " ");
    const position = profilePosition.trim().replace(/\s+/g, " ");
    const wantsPasswordChange = changePassword.length > 0 || confirmNewPassword.length > 0;
    if (!name) {
      setProfileMessage({ kind: "error", text: "Enter your name." });
      return;
    }
    if (wantsPasswordChange && (!changePassword || !confirmNewPassword)) {
      setProfileMessage({ kind: "error", text: "Enter and confirm the new password, or leave both password fields empty." });
      return;
    }
    if (wantsPasswordChange && changePassword !== confirmNewPassword) {
      setProfileMessage({ kind: "error", text: "The passwords do not match." });
      return;
    }
    if (wantsPasswordChange && changePassword.length < 6) {
      setProfileMessage({ kind: "error", text: "Password must be at least 6 characters." });
      return;
    }
    if (!user || !db) {
      setProfileMessage({ kind: "error", text: "Your account is unavailable. Sign in again and retry." });
      return;
    }
    setProfileSaving(true);
    let profileDataSaved = false;
    let accountNameSaved = false;
    try {
      await setDoc(doc(db, "users", user.uid), { name, position, unit: profileUnit });
      profileDataSaved = true;
      await updateProfile(user, { displayName: name });
      accountNameSaved = true;
      setUser(auth?.currentUser ?? user);
      setProfileName(name);
      setProfilePosition(position);
      if (wantsPasswordChange) await updatePassword(user, changePassword);
      setChangePassword("");
      setConfirmNewPassword("");
      setProfileMessage({ kind: "success", text: "Your changes have been saved." });
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      const reason = code === "auth/requires-recent-login"
        ? "Sign in again before changing your password, or choose Reset Password."
        : code ? `Firebase returned ${code}.` : "Try again.";
      const message = !profileDataSaved
        ? `Could not save your changes. ${reason}`
        : !accountNameSaved
          ? `Your profile fields were saved, but the account name was not updated. ${reason}`
          : wantsPasswordChange
            ? `Your profile was saved, but the password was not changed. ${reason}`
            : `Your profile was saved, but the account could not be updated. ${reason}`;
      setProfileMessage({ kind: "error", text: message });
    } finally {
      setProfileSaving(false);
    }
  }

  async function sendResetLink() {
    setProfileMessage(null);
    if (!auth || !user?.email) {
      setProfileMessage({ kind: "error", text: "A verified email address is required to send a reset link." });
      return;
    }
    setResetEmailBusy(true);
    try {
      await sendPasswordResetEmail(auth, user.email);
      setProfileMessage({ kind: "success", text: `A password reset link was sent to ${user.email}.` });
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setProfileMessage({ kind: "error", text: code ? `Could not send the reset link (${code}).` : "Could not send the reset link. Try again." });
    } finally {
      setResetEmailBusy(false);
    }
  }

  useEffect(() => { if (!auth) { setLoading(false); return; } return onAuthStateChanged(auth, (currentUser) => { const verifiedUser = currentUser?.emailVerified ? currentUser : null; setUser(verifiedUser); if (verifiedUser) { setSection("whereabouts-calendar"); setView("list"); } setLoading(false); }); }, []);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileMenuOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen]);
  useEffect(() => { if (singleSlipPreview) return; setPreview((currentPreview) => { if (!currentPreview) return currentPreview; return permits.find((permit) => permit.id === currentPreview.id) ?? currentPreview; }); }, [permits, singleSlipPreview]);
  useEffect(() => { if (!user || !db) return; return onSnapshot(query(collection(db, "permits"), where("ownerId", "==", user.uid), orderBy("createdAt", "desc")), (snapshot) => setPermits(snapshot.docs.map((item) => {
    const data = item.data() as Record<string, unknown>;
    const names = Array.isArray(data.names) ? data.names as string[] : typeof data.name === "string" ? [data.name] : [];
    return { id: item.id, ...data, names } as Permit;
  })), () => setError("Could not load permits. If this is your first setup, deploy the Firestore index or refresh.")); }, [user]);
  useEffect(() => {
    if (!user || !db) { setApprovedPermitNumbers({}); return; }
    return onSnapshot(collection(db, "approvedPermitCalendar"), (snapshot) => {
      const approvedNumbers = snapshot.docs
        .map((item) => item.data() as { status?: string; permitNo?: string })
        .filter((permit): permit is { status: string; permitNo: string } => permit.status === "Approved" && typeof permit.permitNo === "string")
        .map((permit) => ({ permitNo: permit.permitNo }));
      setApprovedPermitNumbers(assignApprovedPermitNumbers(approvedNumbers));
    }, () => setApprovedPermitNumbers({}));
  }, [user]);
  useEffect(() => {
    if (!user || !db || !isPermitAdmin(user.email)) {
      setPendingPermitNotifications([]);
      return;
    }
    const firestore = db;
    return onSnapshot(collection(firestore, "permits"), (snapshot) => {
      const pending = snapshot.docs.flatMap((item) => {
        const data = item.data() as Record<string, unknown>;
        const names = Array.isArray(data.names) ? data.names as string[] : typeof data.name === "string" ? [data.name] : [];
        const permit = { ...data, id: item.id, names } as Permit;
        return names.flatMap((name, index) => {
          if (normalizeWorkflowStatus(permit.personStatuses?.[permitDecisionKey(permit, index)]?.status) !== "Pending") return [];
          return [{ permitId: item.id, statusKey: permitDecisionKey(permit, index), permitNo: permitPersonNumber(permit, index), name, date: permit.date, purpose: permit.purpose, submittedAt: timestampMillis(permit.createdAt) }];
        });
      }).sort((left, right) => right.submittedAt - left.submittedAt || right.permitNo.localeCompare(left.permitNo, "en", { numeric: true }));
      setPendingPermitNotifications(pending);
    }, () => setError("Could not load Permit Slip notifications. Refresh and try again."));
  }, [user]);
  useEffect(() => {
    if (!user || !db) return;
    getDocs(query(collection(db, "specialOrders"), where("ownerId", "==", user.uid))).then((snapshot) => {
      const orders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as SpecialOrder));
      orders.sort((left, right) => {
        const leftTime = (left.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
        const rightTime = (right.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
        return rightTime - leftTime;
      });
      setSpecialOrders(orders);
    }).catch((error) => {
      const code = (error as { code?: string }).code;
      setError(code ? `Could not load special orders (${code}).` : "Could not load special orders. Refresh and try again.");
    });
  }, [user]);

  async function deletePermit(permit: Permit) {
    if (!db) return;
    setDeletingPermitId(permit.id);
    setError("");
    try {
      const firestore = db;
      const calendarEntries = await getDocs(query(collection(firestore, "approvedPermitCalendar"), where("permitId", "==", permit.id)));
      const batch = writeBatch(firestore);
      calendarEntries.docs.forEach((entry) => batch.delete(entry.ref));
      batch.delete(doc(firestore, "permits", permit.id));
      await batch.commit();
      setPreview((current) => current?.id === permit.id ? null : current);
      setPendingPermitDelete(null);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code ? `Could not delete the Permit Slip (${code}).` : "Could not delete the Permit Slip.");
      setPendingPermitDelete(null);
    } finally {
      setDeletingPermitId(null);
    }
  }

  async function deleteSpecialOrder(order: SpecialOrder) {
    if (!db) return;
    setDeletingSpecialOrderId(order.id);
    setError("");
    try {
      await deleteDoc(doc(db, "specialOrders", order.id));
      setSpecialOrders((current) => current.filter((item) => item.id !== order.id));
      setSpecialOrderPreview((current) => current?.id === order.id ? null : current);
      setPendingSpecialOrderDelete(null);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code ? `Could not delete the Special Order (${code}).` : "Could not delete the Special Order.");
      setPendingSpecialOrderDelete(null);
    } finally {
      setDeletingSpecialOrderId(null);
    }
  }

  function closeMobileNavigation() {
    setMobileMenuOpen(false);
    setMobileCertificateOpen(false);
    setMobileAmiaDocumentOpen(false);
    setMobilePermitOpen(false);
  }

  if (loading) return <div className="loading-screen" role="status" aria-label="Loading My Desk"><span>Loading</span><img className="loading-logo" src={publicAsset("/my%20desk%20logo.png")} alt="" draggable={false} onDragStart={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()} /><span aria-hidden="true">...</span></div>;
  if (!isFirebaseConfigured) return <div className="setup-screen"><div className="setup-card"><img className="brand-mark brand-logo" src="/my%20desk%20logo.png" alt="My Desk logo" draggable={false} onDragStart={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()} /><p className="eyebrow">One setup step</p><h1>Connect your Firebase project</h1><p className="muted">Copy <strong>.env.example</strong> to <strong>.env.local</strong>, add your Firebase web app credentials, then restart the dev server.</p><code>NEXT_PUBLIC_FIREBASE_PROJECT_ID=...</code></div></div>;
  if (!user) return <Login onError={setError} />;

  const fullName = user.displayName?.trim().replace(/\s+/g, " ") || "";
  const firstName = fullName.split(" ")[0] || "";
  const isAdmin = isPermitAdmin(user.email);
  const userPermitNotifications = permits.flatMap((permit) => permit.names.flatMap((name, personIndex) => {
    const decision = permit.personStatuses?.[permitDecisionKey(permit, personIndex)];
    if (decision?.status !== "Approved" && decision?.status !== "Disapproved") return [];
    return [{ permit, personIndex, permitNo: permitPersonNumber(permit, personIndex), name, date: permit.date, status: decision.status, decidedAt: decision.decidedAt }];
  })).sort((left, right) => timestampMillis(right.decidedAt) - timestampMillis(left.decidedAt));
  const notificationCount = pendingPermitNotifications.length;
  return <div className="app-shell"><header className="topbar"><button type="button" className="brand brand-home" aria-label="My Desk home - Whereabouts Calendar" onClick={() => { closeMobileNavigation(); setSection("whereabouts-calendar"); setView("list"); }}><img className="brand-mark brand-logo" src="/my%20desk%20logo.png" alt="" draggable={false} onDragStart={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()} /><span>My Desk</span></button><nav className="main-nav" aria-label="Main navigation">
      <button className={section === "special-orders" ? "nav-button active" : "nav-button"} onClick={() => { setSection("special-orders"); setView("list"); }}>Special Order</button>
      <button className={section === "nta" ? "nav-button active" : "nav-button"} onClick={() => { setSection("nta"); setView("list"); }}>NTA</button>
      {isAdmin ? <div className="nav-dropdown" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPermitMenuOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setPermitMenuOpen(false); }}><button type="button" className={section === "permits" || section === "permit-statistics" || section === "permit-status" ? "nav-button active" : "nav-button"} aria-haspopup="true" aria-expanded={permitMenuOpen} aria-controls="permit-admin-menu" onClick={() => setPermitMenuOpen((open) => !open)}>Permit Slip <span className="nav-dropdown-arrow" aria-hidden="true">&#9662;</span></button>{permitMenuOpen && <div className="nav-dropdown-menu" id="permit-admin-menu"><button type="button" className={section === "permits" ? "nav-dropdown-item active" : "nav-dropdown-item"} onClick={() => { setSection("permits"); setView("list"); setPermitMenuOpen(false); }}>Permit Slip</button><button type="button" className={section === "permit-status" ? "nav-dropdown-item active" : "nav-dropdown-item"} onClick={() => { setSection("permit-status"); setPermitMenuOpen(false); }}>Permit Slip Status</button><button type="button" className={section === "permit-statistics" ? "nav-dropdown-item active" : "nav-dropdown-item"} onClick={() => { setSection("permit-statistics"); setPermitMenuOpen(false); }}>Permit Slip Statistics</button></div>}</div> : <button className={section === "permits" ? "nav-button active" : "nav-button"} onClick={() => { setSection("permits"); setView("list"); }}>Permit Slip</button>}
      <button className={section === "travel-orders" ? "nav-button active" : "nav-button"} aria-label="Travel Order" title="Travel Order" onClick={() => { setSection("travel-orders"); setView("list"); }}>TO</button>
      <button className={section === "myar" ? "nav-button active" : "nav-button"} onClick={() => { setSection("myar"); setView("list"); }}>myAR</button>
      <button className={section === "leave-application" ? "nav-button active" : "nav-button"} onClick={() => { setSection("leave-application"); setView("list"); }}>Leave Application</button>
      <div className="nav-dropdown amia-document-nav-dropdown" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAmiaDocumentMenuOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setAmiaDocumentMenuOpen(false); }}><button type="button" className="nav-button amia-document-nav-button" aria-haspopup="true" aria-expanded={amiaDocumentMenuOpen} aria-controls="amia-document-menu" onClick={() => setAmiaDocumentMenuOpen((open) => !open)}>AMIA Document Tracking <span className="nav-dropdown-arrow" aria-hidden="true">&#9662;</span></button>{amiaDocumentMenuOpen && <div className="nav-dropdown-menu amia-document-nav-menu" id="amia-document-menu">{amiaDocumentTrackingLinks.map((link) => <a className="nav-dropdown-item" href={link.href} key={link.label} target="_blank" rel="noopener noreferrer">{link.label}</a>)}</div>}</div>
      <div className="nav-dropdown certificate-nav-dropdown" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setCertificateMenuOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setCertificateMenuOpen(false); }}><button type="button" className={section === "certificate-of-appearance" || section === "completion" || section === "appreciation" || section === "participation" ? "nav-button certificate-nav-button active" : "nav-button certificate-nav-button"} aria-haspopup="true" aria-expanded={certificateMenuOpen} aria-controls="certificate-menu" onClick={() => setCertificateMenuOpen((open) => !open)}>Certificate <span className="nav-dropdown-arrow" aria-hidden="true">&#9662;</span></button>{certificateMenuOpen && <div className="nav-dropdown-menu certificate-nav-menu" id="certificate-menu"><button type="button" className={section === "certificate-of-appearance" ? "nav-dropdown-item active" : "nav-dropdown-item"} onClick={() => { setSection("certificate-of-appearance"); setView("list"); setCertificateMenuOpen(false); }}>Appearance</button><button type="button" className={section === "completion" ? "nav-dropdown-item active" : "nav-dropdown-item"} onClick={() => { setSection("completion"); setView("list"); setCertificateMenuOpen(false); }}>Completion</button><button type="button" className={section === "appreciation" ? "nav-dropdown-item active" : "nav-dropdown-item"} onClick={() => { setSection("appreciation"); setView("list"); setCertificateMenuOpen(false); }}>Appreciation</button><button type="button" className={section === "participation" ? "nav-dropdown-item active" : "nav-dropdown-item"} onClick={() => { setSection("participation"); setView("list"); setCertificateMenuOpen(false); }}>Participation</button></div>}</div>
    </nav><div className="user-menu"><PermitNotificationCenter isAdmin={isAdmin} userId={user.uid} count={notificationCount} notifications={userPermitNotifications} pendingNotifications={pendingPermitNotifications} onAdminOpen={(notification) => { closeMobileNavigation(); setFocusedPermitNotificationKey(`${notification.permitId}:${notification.statusKey}`); setSection("permit-status"); setView("list"); }} onViewPermit={(notification) => { closeMobileNavigation(); setSingleSlipPreview(true); setPreview(singlePersonPermitPreview(notification.permit, notification.personIndex)); }} /><div className="profile-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setProfileMenuOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setProfileMenuOpen(false); }}><button type="button" className="user-greeting profile-trigger" aria-haspopup="menu" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((open) => !open)}>{firstName}<span aria-hidden="true">▾</span></button>{profileMenuOpen && <div className="profile-dropdown" role="menu"><button type="button" role="menuitem" onClick={() => { setChangePassword(""); setConfirmNewPassword(""); void openProfile(); }}>Profile</button></div>}</div><button type="button" className="text-button logout-button" aria-label="Log out" title="Log out" onClick={() => auth && signOut(auth)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></svg></button></div><button type="button" className="mobile-menu-toggle" aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileMenuOpen} aria-controls="mobile-navigation" onClick={() => setMobileMenuOpen((open) => !open)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 5h18M3 12h18M3 19h18" /></svg></button></header>
{mobileMenuOpen && <><button type="button" className="mobile-nav-scrim" aria-label="Close navigation" onClick={closeMobileNavigation} /><nav className="mobile-navigation" id="mobile-navigation" aria-label="Mobile navigation">
<button type="button" className="mobile-profile-link" onClick={() => { closeMobileNavigation(); setChangePassword(""); setConfirmNewPassword(""); void openProfile(); }}>Profile</button>
<div className="mobile-navigation-links">
<button type="button" className="mobile-nav-link" aria-expanded={mobileAmiaDocumentOpen} aria-controls="mobile-amia-document-menu" onClick={() => setMobileAmiaDocumentOpen((open) => !open)}><span>AMIA Document Tracking</span><span className={mobileAmiaDocumentOpen ? "mobile-nav-chevron is-open" : "mobile-nav-chevron"} aria-hidden="true" /></button>
{mobileAmiaDocumentOpen && <div className="mobile-nav-submenu mobile-amia-document-submenu" id="mobile-amia-document-menu">{amiaDocumentTrackingLinks.map((link) => <a className="mobile-nav-submenu-link" href={link.href} key={link.label} target="_blank" rel="noopener noreferrer" onClick={closeMobileNavigation}>{link.label}</a>)}</div>}
<button type="button" className="mobile-nav-link" aria-expanded={mobileCertificateOpen} aria-controls="mobile-certificate-menu" onClick={() => setMobileCertificateOpen((open) => !open)}><span>Certificate</span><span className={mobileCertificateOpen ? "mobile-nav-chevron is-open" : "mobile-nav-chevron"} aria-hidden="true" /></button>
{mobileCertificateOpen && <div className="mobile-nav-submenu" id="mobile-certificate-menu"><button type="button" onClick={() => { setSection("certificate-of-appearance"); setView("list"); closeMobileNavigation(); }}>Appearance</button><button type="button" onClick={() => { setSection("completion"); setView("list"); closeMobileNavigation(); }}>Completion</button><button type="button" onClick={() => { setSection("appreciation"); setView("list"); closeMobileNavigation(); }}>Appreciation</button><button type="button" onClick={() => { setSection("participation"); setView("list"); closeMobileNavigation(); }}>Participation</button></div>}
<button type="button" className="mobile-nav-link" onClick={() => { setSection("myar"); setView("list"); closeMobileNavigation(); }}>myAR</button>
<button type="button" className="mobile-nav-link" onClick={() => { setSection("leave-application"); setView("list"); closeMobileNavigation(); }}>Leave Application</button>
<button type="button" className="mobile-nav-link" onClick={() => { setSection("travel-orders"); setView("list"); closeMobileNavigation(); }}>Travel Order</button>
{isAdmin ? <><button type="button" className="mobile-nav-link" aria-expanded={mobilePermitOpen} aria-controls="mobile-permit-menu" onClick={() => setMobilePermitOpen((open) => !open)}><span>Permit Slip</span><span className={mobilePermitOpen ? "mobile-nav-chevron is-open" : "mobile-nav-chevron"} aria-hidden="true" /></button>{mobilePermitOpen && <div className="mobile-nav-submenu" id="mobile-permit-menu"><button type="button" onClick={() => { setSection("permits"); setView("list"); closeMobileNavigation(); }}>Permit Slip</button><button type="button" onClick={() => { setSection("permit-status"); setView("list"); closeMobileNavigation(); }}>Permit Slip Status</button><button type="button" onClick={() => { setSection("permit-statistics"); setView("list"); closeMobileNavigation(); }}>Permit Slip Statistics</button></div>}</> : <button type="button" className="mobile-nav-link" onClick={() => { setSection("permits"); setView("list"); closeMobileNavigation(); }}>Permit Slip</button>}
<button type="button" className="mobile-nav-link" onClick={() => { setSection("nta"); setView("list"); closeMobileNavigation(); }}>NTA</button>
<button type="button" className="mobile-nav-link" onClick={() => { setSection("special-orders"); setView("list"); closeMobileNavigation(); }}>Special Order</button>
</div></nav></>}{profileOpen && <div className="profile-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeProfile(); }} onKeyDown={(event) => { if (event.key === "Escape") closeProfile(); }}><section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title"><header className="profile-dialog-header"><div><p className="eyebrow">Account</p><h2 id="profile-title">Profile</h2></div><button type="button" className="ghost-button" onClick={closeProfile}>Close</button></header><form className="profile-form" onSubmit={saveChanges} aria-busy={profileLoading || profileSaving}>
  <label>Name<input autoComplete="name" maxLength={120} value={profileName} onChange={(event) => setProfileName(event.target.value)} required disabled={profileLoading || profileSaving} /></label>
  <label>Position<input autoComplete="organization-title" maxLength={120} value={profilePosition} onChange={(event) => setProfilePosition(event.target.value)} disabled={profileLoading || profileSaving} /></label>
  <label>Unit<select value={profileUnit} onChange={(event) => setProfileUnit(event.target.value as Unit)} disabled={profileLoading || profileSaving}>{profileUnitOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
  <label>Email<input type="email" value={user.email ?? ""} readOnly /></label>
  <div className="profile-password-fields">
  <label>Change Password<div className="password-field"><input type={showChangePassword ? "text" : "password"} autoComplete="new-password" value={changePassword} onChange={(event) => setChangePassword(event.target.value)} /><button type="button" className="password-toggle" aria-label={showChangePassword ? "Hide new password" : "Show new password"} onClick={() => setShowChangePassword((show) => !show)}>{showChangePassword ? "Hide" : "Show"}</button></div></label>
  <label>Confirmation Password<div className="password-field"><input type={showConfirmNewPassword ? "text" : "password"} autoComplete="new-password" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} /><button type="button" className="password-toggle" aria-label={showConfirmNewPassword ? "Hide confirmation password" : "Show confirmation password"} onClick={() => setShowConfirmNewPassword((show) => !show)}>{showConfirmNewPassword ? "Hide" : "Show"}</button></div></label>
  </div>
  <div className="profile-password-actions"><button type="button" className="ghost-button" disabled={profileSaving || resetEmailBusy} onClick={() => void sendResetLink()}>{resetEmailBusy ? "Sending..." : "Reset Password"}</button><button className="primary-button" disabled={profileLoading || profileSaving || resetEmailBusy}>{profileLoading ? "Loading..." : profileSaving ? "Saving..." : "Save Changes"}</button></div>
  {profileMessage && <p className={`auth-message auth-message-${profileMessage.kind}`} role={profileMessage.kind === "error" ? "alert" : "status"}>{profileMessage.text}</p>}
  </form></section></div>}<main className="dashboard"><div className="dashboard-header"><div><p className="eyebrow">{philippineDateTime && <>{philippineDateTime.split(" | ")[0]} | <span className="dashboard-time">{philippineDateTime.split(" | ")[1]}</span></>}</p><h1>{biometricsGreeting ?? "Good to see you"}{firstName ? <>, <span className="dashboard-greeting-name">{firstName}!</span></> : "!"}</h1></div><div className="status-pill"><span /> Secure session</div></div>{error && <div className="error-message">{error}</div>}{section === "appreciation" ? <AppreciationCertificate user={user} /> : section === "completion" ? <CompletionCertificate user={user} /> : section === "participation" ? <ParticipationCertificate user={user} /> : section === "certificate-of-appearance" ? <CertificateOfAppearance user={user} /> : section === "leave-application" ? <LeaveApplicationModule user={user} /> : section === "myar" ? <AccomplishmentReportModule user={user} /> : section === "nta" ? <NtaModule user={user} /> : section === "travel-orders" ? <TravelOrderModule user={user} /> : section === "whereabouts-calendar" ? <WhereaboutsCalendarModule user={user} /> : section === "permit-statistics" && isAdmin ? <PermitSlipAdmin user={user} mode="statistics" /> : section === "permit-status" && isAdmin ? <PermitSlipAdmin user={user} mode="status" focusNotificationKey={focusedPermitNotificationKey} /> : section === "permits" ? (view === "new" ? <PermitForm user={user} onSaved={(permit) => { setPermits([permit, ...permits]); setView("list"); }} onCancel={() => setView("list")} onError={setError} /> : <PermitList permits={permits} approvedPermitNumbers={approvedPermitNumbers} deletingId={deletingPermitId} onNew={() => { setError(""); setView("new"); }} onPrint={(permit) => { setSingleSlipPreview(false); setPreview(permit); }} onDelete={setPendingPermitDelete} />) : (view === "new" ? <SpecialOrderForm user={user} onSaved={(order) => { setSpecialOrders([order, ...specialOrders]); setView("list"); }} onCancel={() => setView("list")} onError={setError} /> : <SpecialOrderList orders={specialOrders} deletingId={deletingSpecialOrderId} onNew={() => { setError(""); setView("new"); }} onPrint={setSpecialOrderPreview} onDelete={setPendingSpecialOrderDelete} />)}</main><DeleteConfirmation open={Boolean(pendingPermitDelete)} title="Confirm Permit Slip Deletion?" description="Are you sure you want to delete this Permit Slip? This action cannot be undone." busy={Boolean(pendingPermitDelete && deletingPermitId === pendingPermitDelete.id)} onCancel={() => setPendingPermitDelete(null)} onConfirm={() => { if (pendingPermitDelete) void deletePermit(pendingPermitDelete); }} /><DeleteConfirmation open={Boolean(pendingSpecialOrderDelete)} title="Confirm Special Order Deletion?" description="Are you sure you want to delete this Special Order? This action cannot be undone." busy={Boolean(pendingSpecialOrderDelete && deletingSpecialOrderId === pendingSpecialOrderDelete.id)} onCancel={() => setPendingSpecialOrderDelete(null)} onConfirm={() => { if (pendingSpecialOrderDelete) void deleteSpecialOrder(pendingSpecialOrderDelete); }} />{preview && <PrintPreview permit={preview} approvedPermitNumbers={approvedPermitNumbers} singleSlip={singleSlipPreview} onClose={() => { setPreview(null); setSingleSlipPreview(false); }} />}{specialOrderPreview && <SpecialOrderPreview order={specialOrderPreview} onClose={() => setSpecialOrderPreview(null)} />}</div>;
}

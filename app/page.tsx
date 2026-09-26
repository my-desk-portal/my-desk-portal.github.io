"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "@/lib/firebase";
import NtaModule from "./Nta";
import TravelOrderModule from "./TravelOrder";
import WhereaboutsCalendarModule from "./WhereaboutsCalendar";
import PermitSlipAdmin, { isPermitAdmin } from "./PermitSlipAdmin";

type Unit = "AMIA" | "AGRISTAT" | "DRRM";
type PermitDecision = { status?: "Processing" | "Approved" | "Disapproved"; decidedAt?: unknown; signerName?: string; decidedBy?: string };
type Permit = { id: string; permitNo: string; permitNos?: string[]; date: string; names: string[]; unit: Unit; purpose: string; personStatuses?: Record<string, PermitDecision>; createdAt?: unknown };
type SpecialOrder = { id: string; subject: string; activityTitle: string; organizer: string; dateFrom: string; dateTo: string; venue: string; participants: string[]; createdAt?: unknown };

const units: Unit[] = ["AMIA", "AGRISTAT", "DRRM"];
const publicAsset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(new Date(`${date}T00:00:00`));
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
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
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
    if (registering && password !== confirmPassword) return;
    setBusy(true);
    onError("");
    try {
      if (registering) {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(credential.user, { displayName: `${firstName.trim()} ${lastName.trim()}` });
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
      const message = code === "invalid-credential"
        ? "Email or password is incorrect. Please check your details and try again."
        : code ? `${code}: ${firebaseError.message ?? "Unable to authenticate."}` : "Unable to authenticate.";
      setAuthMessage({ kind: "error", text: message });
      onError(message);
    } finally { setBusy(false); }
  }

  return <main className="auth-shell">
    <section className="auth-intro"><img className="brand-mark brand-logo" src="/my%20desk%20logo.png" alt="My Desk logo" /><p className="eyebrow">MD Administration</p><h1>Keep every<br /><em>movement</em> accounted for.</h1><p className="intro-copy">A clear, dependable desk for creating and retrieving official docs.</p><div className="intro-note"><span>01</span><p>Authenticated access for your unit</p></div></section>
    <section className="auth-panel"><div className="auth-form-wrap"><div className="mobile-brand"><img className="brand-mark brand-logo" src="/my%20desk%20logo.png" alt="My Desk logo" /><span>My Desk</span></div><p className="eyebrow">{registering ? "New account" : "Welcome back"}</p><h2>{registering ? "Create your account" : "Sign in to My Desk"}</h2><p className="muted">{registering ? "Create your account and verify your email to get started." : "Enter your details to continue."}</p>
      {authMessage && <div className={`auth-message auth-message-${authMessage.kind}`} role={authMessage.kind === "error" ? "alert" : "status"}>{authMessage.text}</div>}
      <form onSubmit={submit}>
        {registering && <div className="auth-name-fields"><label>First Name<input autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="First name" required /></label><label>Last Name<input autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="Last name" required /></label></div>}
        <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="your email here" required /></label>
        <label>Password<div className="password-field"><input type={showPassword ? "text" : "password"} autoComplete={registering ? "new-password" : "current-password"} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" required /><button type="button" className="password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide" : "Show"}</button></div></label>
        {registering && <label>Confirm Password<div className="password-field"><input type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" minLength={6} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Re-enter your password" required /><button type="button" className="password-toggle" aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"} onClick={() => setShowConfirmPassword(!showConfirmPassword)}>{showConfirmPassword ? "Hide" : "Show"}</button></div></label>}
        {registering && confirmPassword && confirmPassword !== password && <p className="auth-validation-message" role="alert">Passwords do not match.</p>}
        <button className="primary-button" disabled={busy}>{busy ? "Please wait..." : registering ? "Create account" : "Sign in"}</button>
      </form>
      <button className="text-button" onClick={() => { setRegistering(!registering); setConfirmPassword(""); setShowConfirmPassword(false); setAuthMessage(null); onError(""); }}>{registering ? "Already have an account? Sign in" : "Need an account? Register here"}</button>
    </div></section>
  </main>;
}
function PermitForm({ user, onSaved, onCancel, onError }: { user: User; onSaved: (permit: Permit) => void; onCancel: () => void; onError: (message: string) => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [names, setNames] = useState([""]);
  const [unit, setUnit] = useState<Unit>("AMIA");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!db) return;
    const firestore = db;
    setBusy(true); onError("");
    try {
      const nameList = names.map((person) => person.trim()).filter(Boolean);
      const year = new Date(`${date}T00:00:00`).getFullYear();
      const permit = await runTransaction(firestore, async (transaction) => {
        const counterRef = doc(firestore, "permitCounters", `${unit}-${year}`);
        const counterSnapshot = await transaction.get(counterRef);
        const firstNumber = (counterSnapshot.exists() ? counterSnapshot.data().lastNumber : 0) + 1;
        const permitNos = nameList.map((_, index) => `${unit}-${year}-${String(firstNumber + index).padStart(4, "0")}`);
        const lastNumber = firstNumber + nameList.length - 1;
        const permitRef = doc(collection(firestore, "permits"));
        const record = { permitNo: permitNos[0], permitNos, date, names: nameList, unit, purpose: purpose.trim(), ownerId: user.uid, createdAt: serverTimestamp() };
        transaction.set(counterRef, { lastNumber, unit, year });
        transaction.set(permitRef, record);
        return { id: permitRef.id, ...record } as Permit;
      });
      onSaved(permit);
    } catch (error) { onError(error instanceof Error ? error.message : "Unable to save permit."); }
    finally { setBusy(false); }
  }

  return <section className="content-section form-section"><div className="section-heading"><div><p className="eyebrow">New record</p><h2>Enter permit details</h2><p className="muted">The permit number is generated automatically when you save.</p></div><button className="ghost-button" onClick={onCancel}>Cancel</button></div><form className="permit-form" onSubmit={save}><label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><div className="participant-fields wide-field"><span>Full name</span>{names.map((person, index) => <div className="participant-input" key={index}><input aria-label={`Person ${index + 1}`} value={person} onChange={(event) => setNames(names.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} required={index === 0} placeholder={`Person ${index + 1}`} />{names.length > 1 && <button type="button" className="remove-participant" aria-label={`Remove person ${index + 1}`} onClick={() => setNames(names.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}</div>)}<button type="button" className="text-button add-participant" onClick={() => setNames([...names, ""])}>+ Add name</button></div><label>Unit<select value={unit} onChange={(event) => setUnit(event.target.value as Unit)}>{units.map((option) => <option key={option}>{option}</option>)}</select></label><label className="wide-field">Purpose<textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Why is this permit being requested?" rows={5} required /></label><div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save permit slip"}</button></div></form></section>;
}

function PermitList({ permits, onNew, onPrint }: { permits: Permit[]; onNew: () => void; onPrint: (permit: Permit) => void }) {
  return <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Your records</p><h2>Permit Slips</h2><p className="muted">{permits.length} {permits.length === 1 ? "slip" : "slips"} registered to your account.</p></div><button className="primary-button" onClick={onNew}>+ New permit</button></div>{permits.length === 0 ? <div className="empty-state"><span className="empty-number">00</span><h3>No permit slips yet</h3><p>Create your first record to see it here.</p><button className="text-button" onClick={onNew}>Create a permit slip</button></div> : <div className="permit-table"><div className="table-head"><span>Permit no.</span><span>Date</span><span>Name</span><span>Unit</span><span></span></div>{permits.map((permit) => <div className="table-row" key={permit.id}><strong>{permit.permitNos?.length ? `${permit.permitNos[0]}${permit.permitNos.length > 1 ? ` - ${permit.permitNos[permit.permitNos.length - 1]}` : ""}` : permit.permitNo}</strong><span>{formatDate(permit.date)}</span><span>{permit.names.join(", ")}</span><span><b className="unit-tag">{permit.unit}</b></span><button className="row-action" onClick={() => onPrint(permit)}>View</button></div>)}</div>}</section>;
}

function chunkNames(names: string[], size: number) {
  const chunks: string[][] = [];
  for (let index = 0; index < names.length; index += size) chunks.push(names.slice(index, index + size));
  return chunks;
}

function permitDecisionKey(permit: Permit, index: number) {
  return permit.permitNos?.[index] ?? (permit.names.length > 1 ? `${permit.permitNo}__person_${index + 1}` : permit.permitNo);
}

function PermitCard({ permit, name, permitNo, decisionKey }: { permit: Permit; name: string; permitNo: string; decisionKey: string }) {
  const decision = permit.personStatuses?.[decisionKey];
  const decisionTime = signatureTime(decision?.decidedAt);
  return <article className="permit-document">
    <header className="permit-header">
      <div className="permit-logos">
        <img src={publicAsset("/bagong-pilipinas-logo.webp")} alt="Bagong Pilipinas" className="permit-logo-left" />
        <div className="permit-seal-wrap">
          <img src={publicAsset("/da-caraga-logo.jpg")} alt="Department of Agriculture Caraga Region" className="permit-logo-right" />
        </div>
      </div>
      <h1 className="permit-heading">PERMIT SLIP</h1>
    </header>

    <section className="permit-metadata">
      <div className="permit-meta-row">
        <span className="permit-label">PS No.</span>
        <span className="permit-colon">:</span>
        <span className="permit-input-line">{permitNo}</span>
      </div>
      <div className="permit-meta-row">
        <span className="permit-label">Date</span>
        <span className="permit-colon">:</span>
        <span className="permit-input-line">{formatDate(permit.date)}</span>
      </div>
    </section>

    <h2 className="permit-banner">PERMIT TO LEAVE THE OFFICE IS GRANTED TO:</h2>
    <p className="permit-blank-line permit-blank-line-lg permit-name-line">{name}</p>

    <section className="permit-purpose-block">
      <h3>PURPOSE:</h3>
      <p className="permit-blank-line permit-filled-line">{permit.purpose}</p>
      <div className="permit-blank-line" />
    </section>

    <table className="permit-grid">
      <thead>
        <tr>
          <th>VISITED PLACES</th>
          <th>CERTIFYING OFFICER</th>
        </tr>
      </thead>
      <tbody>
        <tr><td /><td /></tr>
        <tr><td /><td /></tr>
        <tr><td /><td /></tr>
        <tr><td /><td /></tr>
        <tr><td /><td /></tr>
        <tr><td /><td /></tr>
      </tbody>
    </table>

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
      </div>
    </div>

    <div className="permit-approval">
      <div className="permit-approved-label">Approved:</div>
      {decision?.status === "Approved" && <div className="permit-digital-signature"><img src={publicAsset("/signature.png")} alt="Digital signature of Gerlie B. Antipaso" /><div><span>Digitally Signed By</span><strong>{decision.signerName || "GERLIE B. ANTIPASO"}</strong><span>Date: {signatureDate(decision.decidedAt)}</span><span>Time: {decisionTime}</span></div></div>}
      {decision?.status === "Disapproved" && <div className="permit-disapproved-stamp">Disapproved</div>}
      <div className="permit-approved-name">GERLIE B. ANTIPASO</div>
      <div className="permit-approved-role">DRRM/AMIA/AGRISTAT Head/Agriculturist II</div>
    </div>
  </article>;
}

function PrintPreview({ permit, onClose }: { permit: Permit; onClose: () => void }) {
  const sheetsRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const sheets = chunkNames(permit.names, 4);

  async function waitForImages(container: HTMLElement) {
    await Promise.all(Array.from(container.querySelectorAll("img")).map(async (image) => {
      if (!image.complete) await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("A permit logo could not be loaded.")); });
      if (image.decode) await image.decode();
    }));
  }

  async function downloadPdf() {
    if (!sheetsRef.current) return;
    setDownloading(true);
    setDownloadError("");
    try {
      await waitForImages(sheetsRef.current);
      const sheetElements = Array.from(sheetsRef.current.querySelectorAll<HTMLElement>(".permit-sheet"));
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      for (let index = 0; index < sheetElements.length; index += 1) {
        const canvas = await html2canvas(sheetElements[index], { backgroundColor: "#fff", logging: false, scale: 3, useCORS: true });
        if (index > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 210, 297);
      }
      pdf.save(`permit-${permit.permitNo}.pdf`);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Unable to create the PDF.");
    } finally {
      setDownloading(false);
    }
  }

  return <div className="preview-backdrop">
    <div className="preview-toolbar">
      <span>Permit preview</span>
      <button className="ghost-button" onClick={onClose}>Close</button>
      <button className="pdf-button" disabled={downloading} onClick={downloadPdf}>{downloading ? "Preparing PDF..." : "Download PDF"}</button>
      {downloadError && <small className="download-error">{downloadError}</small>}
    </div>
    <div ref={sheetsRef} className="permit-sheets">
      {sheets.map((sheetNames, sheetIndex) => <div className="permit-sheet" key={sheetIndex}>
        {sheetNames.map((name, nameIndex) => { const personIndex = sheetIndex * 4 + nameIndex; return <PermitCard permit={permit} name={name} permitNo={permit.permitNos?.[personIndex] ?? permit.permitNo} decisionKey={permitDecisionKey(permit, personIndex)} key={nameIndex} />; })}
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
  const [venue, setVenue] = useState("");
  const [participants, setParticipants] = useState([""]);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!db) return;
    setBusy(true); onError("");
    try {
      const participantList = participants.map((person) => person.trim()).filter(Boolean);
      const reference = await addDoc(collection(db, "specialOrders"), { subject: subject.trim(), activityTitle: activityTitle.trim(), organizer: organizer.trim(), dateFrom, dateTo: dateTo || dateFrom, venue: venue.trim(), participants: participantList, ownerId: user.uid, createdAt: serverTimestamp() });
      onSaved({ id: reference.id, subject: subject.trim(), activityTitle: activityTitle.trim(), organizer: organizer.trim(), dateFrom, dateTo: dateTo || dateFrom, venue: venue.trim(), participants: participantList });
    } catch (error) { onError(error instanceof Error ? error.message : "Unable to save special order."); }
    finally { setBusy(false); }
  }

  return <section className="content-section form-section"><div className="section-heading"><div><p className="eyebrow">New record</p><h2>Create special order</h2><p className="muted">Add the activity details and designated participants.</p></div><button className="ghost-button" onClick={onCancel}>Cancel</button></div><form className="permit-form" onSubmit={save}><label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} required /></label><label>Title of the Activity<input value={activityTitle} onChange={(event) => setActivityTitle(event.target.value)} required /></label><label>Organizer or Host<input value={organizer} onChange={(event) => setOrganizer(event.target.value)} required /></label><div className="date-range-field"><span>Date</span><div><input aria-label="Date from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} required /><span>to</span><input aria-label="Date to" type="date" min={dateFrom} value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div></div><label>Venue<input value={venue} onChange={(event) => setVenue(event.target.value)} required /></label><div className="participant-fields wide-field"><span>Designated Participant</span>{participants.map((participant, index) => <div className="participant-input" key={index}><input aria-label={`Designated participant ${index + 1}`} value={participant} onChange={(event) => setParticipants(participants.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} required={index === 0} placeholder={`Participant ${index + 1}`} />{participants.length > 1 && <button type="button" className="remove-participant" aria-label={`Remove participant ${index + 1}`} onClick={() => setParticipants(participants.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}</div>)}<button type="button" className="text-button add-participant" onClick={() => setParticipants([...participants, ""])}>+ Add participant</button></div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save special order"}</button></div></form></section>;
}

function SpecialOrderList({ orders, onNew, onPrint }: { orders: SpecialOrder[]; onNew: () => void; onPrint: (order: SpecialOrder) => void }) {
  return <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Your records</p><h2>Special Orders</h2><p className="muted">{orders.length} {orders.length === 1 ? "order" : "orders"} registered to your account.</p></div><button className="primary-button" onClick={onNew}>+ New order</button></div>{orders.length === 0 ? <div className="empty-state"><span className="empty-number">00</span><h3>No special orders yet</h3><p>Create your first order to see it here.</p><button className="text-button" onClick={onNew}>Create a special order</button></div> : <div className="permit-table"><div className="table-head"><span>Subject</span><span>Activity</span><span>Date</span><span>Participants</span><span></span></div>{orders.map((order) => <div className="table-row" key={order.id}><strong>{order.subject}</strong><span>{order.activityTitle}</span><span>{formatDate(order.dateFrom)}{order.dateTo !== order.dateFrom && ` - ${formatDate(order.dateTo)}`}</span><span>{order.participants.length}</span><button className="row-action" onClick={() => onPrint(order)}>View</button></div>)}</div>}</section>;
}

function SpecialOrderPreview({ order, onClose }: { order: SpecialOrder; onClose: () => void }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [firstPageCount, setFirstPageCount] = useState(order.participants.length);
  const [firstPageSaturated, setFirstPageSaturated] = useState(false);
  const [continuationSettings, setContinuationSettings] = useState<{ capacity: number; saturated: boolean }[]>([]);
  const [closingUnitsOnLastAttendeePage, setClosingUnitsOnLastAttendeePage] = useState(7);
  const [closingPageSettings, setClosingPageSettings] = useState<{ capacity: number; saturated: boolean }[]>([]);
  const [signatoryPulledBack, setSignatoryPulledBack] = useState(false);

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
    <footer className="special-order-signatory special-order-closing-unit" data-special-order-closing-unit key="signatory"><strong>ENGR. RICARDO M. OÑATE JR.</strong><span>Regional Executive Director</span></footer>,
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
  }, [closingContinuationPages.length, closingPageSettings, closingUnitsOnLastAttendeePage, continuationPages.length, continuationSettings, firstPageCount, firstPageSaturated, order.participants, signatoryPulledBack]);

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

  const pageParticipants = (participants: string[], continued: boolean, pageKey: string, className: string, includeClosing: boolean) => <>
    <section className={`special-order-participants ${className}`}>
      {!continued && <div className="special-order-spacer" aria-hidden="true" />}
      <h2>{continued ? "Designated Participants (continued):" : order.participants.length === 1 ? "Designated Participant:" : "Designated Participants:"}</h2>
      <ol>{participants.map((participant, index) => <li key={`${pageKey}-${index}`}>{participant}</li>)}</ol>
    </section>
    {includeClosing && renderClosingUnits(closingUnits.slice(0, closingUnitsOnLastAttendeePage))}
  </>;

  const firstPageHasAllParticipants = continuationPages.length === 0;
  return <div className="preview-backdrop"><div className="preview-toolbar"><span>Special Order preview</span><button className="ghost-button" onClick={onClose}>Close</button><button className="pdf-button" disabled={downloading} onClick={downloadPdf}>{downloading ? "Preparing PDF..." : "Download PDF"}</button>{downloadError && <small className="download-error">{downloadError}</small>}</div>
    <div ref={pagesRef} className="special-order-preview-pages">
      <article className="special-order-paper"><img className="special-order-letterhead" src={publicAsset("/Document-Header-Footer.jpg")} alt="" /><div className="special-order-content"><header className="special-order-heading"><h1>SPECIAL ORDER</h1><p>No. <span /></p><p>Series of {new Date().getFullYear()}</p></header><div className="special-order-flow"><section className="special-order-subject"><p><b>SUBJECT :</b><span>{order.subject}</span></p></section><p className="special-order-intro">In view of the unavailability of the undersigned and/or the absence of specified participants on the received communications, the following personnel is/are hereby designated to attend and represent this Office in the activity detailed below:</p><div className="special-order-body"><section className="special-order-details"><p><b>Title of the Activity :</b><span>{order.activityTitle}</span></p><p><b>Organizer/ Host :</b><span>{order.organizer}</span></p><p><b>Date :</b><span>{formatDate(order.dateFrom)}{order.dateTo !== order.dateFrom && ` to ${formatDate(order.dateTo)}`}</span></p><p><b>Venue :</b><span>{order.venue}</span></p></section>{(firstPageCount > 0 || order.participants.length === 0) && pageParticipants(order.participants.slice(0, firstPageCount), false, "first", "special-order-first-participants", firstPageHasAllParticipants)}</div></div></div></article>
      {continuationPages.map((participants, index) => {
        const isLastPage = index === continuationPages.length - 1;
        return <article className="special-order-paper special-order-continuation-page" key={`continuation-${index}`}><img className="special-order-letterhead" src={publicAsset("/Document-Header-Footer.jpg")} alt="" /><div className="special-order-content"><div className="special-order-flow special-order-flow-continued">{pageParticipants(participants, true, `continuation-${index}`, "special-order-continuation-participants", isLastPage)}</div></div></article>;
      })}
      {closingContinuationPages.map((units, index) => <article className="special-order-paper special-order-closing-page" key={`closing-${index}`}><img className="special-order-letterhead" src={publicAsset("/Document-Header-Footer.jpg")} alt="" /><div className="special-order-content"><div className="special-order-flow special-order-flow-continued">{renderClosingUnits(units)}</div></div></article>)}
    </div>
  </div>;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [specialOrders, setSpecialOrders] = useState<SpecialOrder[]>([]);
  const [view, setView] = useState<"list" | "new">("list");
  const [section, setSection] = useState<"permits" | "special-orders" | "nta" | "travel-orders" | "whereabouts-calendar" | "permit-statistics" | "permit-status">("whereabouts-calendar");
  const [preview, setPreview] = useState<Permit | null>(null);
  const [specialOrderPreview, setSpecialOrderPreview] = useState<SpecialOrder | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (!auth) { setLoading(false); return; } return onAuthStateChanged(auth, (currentUser) => { const verifiedUser = currentUser?.emailVerified ? currentUser : null; setUser(verifiedUser); if (verifiedUser) { setSection("whereabouts-calendar"); setView("list"); } setLoading(false); }); }, []);
  useEffect(() => { setPreview((currentPreview) => { if (!currentPreview) return currentPreview; return permits.find((permit) => permit.id === currentPreview.id) ?? currentPreview; }); }, [permits]);
  useEffect(() => { if (!user || !db) return; return onSnapshot(query(collection(db, "permits"), where("ownerId", "==", user.uid), orderBy("createdAt", "desc")), (snapshot) => setPermits(snapshot.docs.map((item) => {
    const data = item.data() as Record<string, unknown>;
    const names = Array.isArray(data.names) ? data.names as string[] : typeof data.name === "string" ? [data.name] : [];
    return { id: item.id, ...data, names } as Permit;
  })), () => setError("Could not load permits. If this is your first setup, deploy the Firestore index or refresh.")); }, [user]);
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

  if (loading) return <div className="loading-screen">Loading My Desk...</div>;
  if (!isFirebaseConfigured) return <div className="setup-screen"><div className="setup-card"><img className="brand-mark brand-logo" src="/my%20desk%20logo.png" alt="My Desk logo" /><p className="eyebrow">One setup step</p><h1>Connect your Firebase project</h1><p className="muted">Copy <strong>.env.example</strong> to <strong>.env.local</strong>, add your Firebase web app credentials, then restart the dev server.</p><code>NEXT_PUBLIC_FIREBASE_PROJECT_ID=...</code></div></div>;
  if (!user) return <Login onError={setError} />;

  const isAdmin = isPermitAdmin(user.email);
  return <div className="app-shell"><header className="topbar"><button type="button" className="brand brand-home" aria-label="My Desk home - Whereabouts Calendar" onClick={() => { setSection("whereabouts-calendar"); setView("list"); }}><img className="brand-mark brand-logo" src="/my%20desk%20logo.png" alt="" /><span>My Desk</span></button><nav className="main-nav"><button className={section === "permits" ? "nav-button active" : "nav-button"} onClick={() => { setSection("permits"); setView("list"); }}>Permit Slip</button><button className={section === "special-orders" ? "nav-button active" : "nav-button"} onClick={() => { setSection("special-orders"); setView("list"); }}>Special Order</button><button className={section === "travel-orders" ? "nav-button active" : "nav-button"} aria-label="Travel Order" title="Travel Order" onClick={() => { setSection("travel-orders"); setView("list"); }}>TO</button><button className={section === "nta" ? "nav-button active" : "nav-button"} onClick={() => { setSection("nta"); setView("list"); }}>NTA</button>{isAdmin && <><button className={section === "permit-statistics" ? "nav-button active" : "nav-button"} onClick={() => setSection("permit-statistics")}>Permit Slip Statistics</button><button className={section === "permit-status" ? "nav-button active" : "nav-button"} onClick={() => setSection("permit-status")}>Permit Slip Status</button></>}</nav><div className="user-menu"><span className="user-greeting">Masaganang Agrikultura{user.displayName?.trim() ? `, ${user.displayName.trim().split(/\s+/)[0]}` : ""}!</span><button type="button" className="text-button logout-button" aria-label="Log out" title="Log out" onClick={() => auth && signOut(auth)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></svg></button></div></header><main className="dashboard"><div className="dashboard-header"><div><p className="eyebrow">{new Intl.DateTimeFormat("en-PH", { dateStyle: "full" }).format(new Date())}</p><h1>Good to see you.</h1></div><div className="status-pill"><span /> Secure session</div></div>{error && <div className="error-message">{error}</div>}{section === "nta" ? <NtaModule user={user} /> : section === "travel-orders" ? <TravelOrderModule user={user} /> : section === "whereabouts-calendar" ? <WhereaboutsCalendarModule user={user} /> : section === "permit-statistics" && isAdmin ? <PermitSlipAdmin user={user} mode="statistics" /> : section === "permit-status" && isAdmin ? <PermitSlipAdmin user={user} mode="status" /> : section === "permits" ? (view === "new" ? <PermitForm user={user} onSaved={(permit) => { setPermits([permit, ...permits]); setView("list"); }} onCancel={() => setView("list")} onError={setError} /> : <PermitList permits={permits} onNew={() => { setError(""); setView("new"); }} onPrint={setPreview} />) : (view === "new" ? <SpecialOrderForm user={user} onSaved={(order) => { setSpecialOrders([order, ...specialOrders]); setView("list"); }} onCancel={() => setView("list")} onError={setError} /> : <SpecialOrderList orders={specialOrders} onNew={() => { setError(""); setView("new"); }} onPrint={setSpecialOrderPreview} />)}</main>{preview && <PrintPreview permit={preview} onClose={() => setPreview(null)} />}{specialOrderPreview && <SpecialOrderPreview order={specialOrderPreview} onClose={() => setSpecialOrderPreview(null)} />}</div>;
}

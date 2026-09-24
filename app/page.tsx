"use client";

import { useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "@/lib/firebase";

type Unit = "AMIA" | "AGRISTAT" | "DRRM";
type Permit = { id: string; permitNo: string; date: string; name: string; unit: Unit; purpose: string; createdAt?: unknown };
type SpecialOrder = { id: string; subject: string; activityTitle: string; organizer: string; dateFrom: string; dateTo: string; venue: string; participants: string[]; createdAt?: unknown };

const units: Unit[] = ["AMIA", "AGRISTAT", "DRRM"];
const publicAsset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(new Date(`${date}T00:00:00`));
}

function Login({ onError }: { onError: (message: string) => void }) {
  const [registering, setRegistering] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!auth) return;
    setBusy(true);
    onError("");
    try {
      if (registering) await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      const firebaseError = error as { code?: string; message?: string };
      const code = firebaseError.code?.replace("auth/", "");
      onError(code ? `${code}: ${firebaseError.message ?? "Unable to authenticate."}` : "Unable to authenticate.");
    } finally { setBusy(false); }
  }

  return <main className="auth-shell">
    <section className="auth-intro"><div className="brand-mark">PD</div><p className="eyebrow">Permit administration</p><h1>Keep every<br /><em>movement</em> accounted for.</h1><p className="intro-copy">A clear, dependable desk for creating and retrieving official permit slips.</p><div className="intro-note"><span>01</span><p>Authenticated access for your unit</p></div></section>
    <section className="auth-panel"><div className="auth-form-wrap"><div className="mobile-brand"><div className="brand-mark">PD</div><span>Permit Desk</span></div><p className="eyebrow">{registering ? "New account" : "Welcome back"}</p><h2>{registering ? "Create your account" : "Sign in to Permit Desk"}</h2><p className="muted">{registering ? "Start managing your permit slips." : "Enter your details to continue."}</p><form onSubmit={submit}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="your email here" required /></label><label>Password<input type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" required /></label><button className="primary-button" disabled={busy}>{busy ? "Please wait..." : registering ? "Create account" : "Sign in"}</button></form><button className="text-button" onClick={() => setRegistering(!registering)}>{registering ? "Already have an account? Sign in" : "Need an account? Register here"}</button></div></section>
  </main>;
}

function PermitForm({ user, onSaved, onCancel, onError }: { user: User; onSaved: (permit: Permit) => void; onCancel: () => void; onError: (message: string) => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<Unit>("AMIA");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!db) return;
    const firestore = db;
    setBusy(true); onError("");
    try {
      const year = new Date(`${date}T00:00:00`).getFullYear();
      const permit = await runTransaction(firestore, async (transaction) => {
        const counterRef = doc(firestore, "permitCounters", `${unit}-${year}`);
        const counterSnapshot = await transaction.get(counterRef);
        const nextNumber = (counterSnapshot.exists() ? counterSnapshot.data().lastNumber : 0) + 1;
        const permitRef = doc(collection(firestore, "permits"));
        const record = { permitNo: `${unit}-${year}-${String(nextNumber).padStart(4, "0")}`, date, name: name.trim(), unit, purpose: purpose.trim(), ownerId: user.uid, createdAt: serverTimestamp() };
        transaction.set(counterRef, { lastNumber: nextNumber, unit, year });
        transaction.set(permitRef, record);
        return { id: permitRef.id, ...record } as Permit;
      });
      onSaved(permit);
    } catch (error) { onError(error instanceof Error ? error.message : "Unable to save permit."); }
    finally { setBusy(false); }
  }

  return <section className="content-section form-section"><div className="section-heading"><div><p className="eyebrow">New record</p><h2>Enter permit details</h2><p className="muted">The permit number is generated automatically when you save.</p></div><button className="ghost-button" onClick={onCancel}>Cancel</button></div><form className="permit-form" onSubmit={save}><label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><label>Full name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter the requestor's name" required /></label><label>Unit<select value={unit} onChange={(event) => setUnit(event.target.value as Unit)}>{units.map((option) => <option key={option}>{option}</option>)}</select></label><label className="wide-field">Purpose<textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Why is this permit being requested?" rows={5} required /></label><div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save permit slip"}</button></div></form></section>;
}

function PermitList({ permits, onNew, onPrint }: { permits: Permit[]; onNew: () => void; onPrint: (permit: Permit) => void }) {
  return <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Your records</p><h2>Permit slips</h2><p className="muted">{permits.length} {permits.length === 1 ? "slip" : "slips"} registered to your account.</p></div><button className="primary-button" onClick={onNew}>+ New permit</button></div>{permits.length === 0 ? <div className="empty-state"><span className="empty-number">00</span><h3>No permit slips yet</h3><p>Create your first record to see it here.</p><button className="text-button" onClick={onNew}>Create a permit slip</button></div> : <div className="permit-table"><div className="table-head"><span>Permit no.</span><span>Date</span><span>Name</span><span>Unit</span><span></span></div>{permits.map((permit) => <div className="table-row" key={permit.id}><strong>{permit.permitNo}</strong><span>{formatDate(permit.date)}</span><span>{permit.name}</span><span><b className="unit-tag">{permit.unit}</b></span><button className="row-action" onClick={() => onPrint(permit)}>View / print</button></div>)}</div>}</section>;
}

function PrintPreview({ permit, onClose }: { permit: Permit; onClose: () => void }) {
  const permitRef = useRef<HTMLElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  async function downloadPermit() {
    if (!permitRef.current) return;
    setDownloading(true);
    setDownloadError("");
    try {
      await Promise.all(Array.from(permitRef.current.querySelectorAll("img")).map(async (image) => {
        if (!image.complete) await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("A permit logo could not be loaded.")); });
        if (image.decode) await image.decode();
      }));
      const canvas = await html2canvas(permitRef.current, { backgroundColor: "#fff", logging: false, scale: 3, useCORS: true });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
      if (!blob) throw new Error("Unable to create JPG download.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `permit-${permit.permitNo}.jpg`;
      link.href = url;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      window.setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 1000);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Unable to download the permit JPG.");
    } finally {
      setDownloading(false);
    }
  }

  return <div className="preview-backdrop">
    <div className="preview-toolbar">
      <span>Permit preview</span>
      <button className="ghost-button" onClick={onClose}>Close</button>
      <button className="primary-button" disabled={downloading} onClick={downloadPermit}>{downloading ? "Preparing JPG..." : "Download this Photo"}</button>
      {downloadError && <small className="download-error">{downloadError}</small>}
    </div>
    <article ref={permitRef} className="permit-paper permit-document">
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
          <span className="permit-input-line">{permit.permitNo}</span>
        </div>
        <div className="permit-meta-row">
          <span className="permit-label">Date</span>
          <span className="permit-colon">:</span>
          <span className="permit-input-line">{formatDate(permit.date)}</span>
        </div>
      </section>

      <h2 className="permit-banner">PERMIT TO LEAVE THE OFFICE IS GRANTED TO:</h2>
      <div className="permit-blank-line permit-blank-line-lg" />

      <section className="permit-purpose-block">
        <h3>PURPOSE:</h3>
        <div className="permit-blank-line" />
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
        </tbody>
      </table>

      <div className="permit-signature-row">
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
        <div className="permit-guard-signature">GUARD'S SIGNATURE</div>
      </div>

      <div className="permit-approval">
        <div className="permit-approved-label">Approved:</div>
        <div className="permit-approved-name">GERLIE B. ANTIPASO</div>
        <div className="permit-approved-role">DRRM/AMIA/AGRISTAT Head/Agriculturist II</div>
      </div>
    </article>
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
  return <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Your records</p><h2>Special orders</h2><p className="muted">{orders.length} {orders.length === 1 ? "order" : "orders"} registered to your account.</p></div><button className="primary-button" onClick={onNew}>+ New order</button></div>{orders.length === 0 ? <div className="empty-state"><span className="empty-number">00</span><h3>No special orders yet</h3><p>Create your first order to see it here.</p><button className="text-button" onClick={onNew}>Create a special order</button></div> : <div className="permit-table"><div className="table-head"><span>Subject</span><span>Activity</span><span>Date</span><span>Participants</span><span></span></div>{orders.map((order) => <div className="table-row" key={order.id}><strong>{order.subject}</strong><span>{order.activityTitle}</span><span>{formatDate(order.dateFrom)}{order.dateTo !== order.dateFrom && ` - ${formatDate(order.dateTo)}`}</span><span>{order.participants.length}</span><button className="row-action" onClick={() => onPrint(order)}>View / print</button></div>)}</div>}</section>;
}

function SpecialOrderPreview({ order, onClose }: { order: SpecialOrder; onClose: () => void }) {
  const orderRef = useRef<HTMLElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  async function downloadOrder() {
    if (!orderRef.current) return;
    setDownloading(true); setDownloadError("");
    try {
      const canvas = await html2canvas(orderRef.current, { backgroundColor: "#fff", logging: false, scale: 2, useCORS: true });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
      if (!blob) throw new Error("Unable to create JPG download.");
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.download = `special-order-${order.dateFrom}.jpg`; link.href = url; link.style.display = "none"; document.body.appendChild(link); link.click();
      window.setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 1000);
    } catch (error) { setDownloadError(error instanceof Error ? error.message : "Unable to download the special order."); }
    finally { setDownloading(false); }
  }

  function printA4() {
    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Special Order</title>
          <style>
            @page { size: A4; margin: 0; }
            * { box-sizing: border-box; }
            html, body { margin: 0; background: #fff; }
            body { display: flex; align-items: center; justify-content: center; font-family: Cambria, "Times New Roman", serif; color: #111; }
            .sheet { position: relative; width: 210mm; height: 297mm; background: #fff; overflow: hidden; }
            .sheet img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
            .content { position: relative; z-index: 1; padding: 15mm 12mm 10mm; }
            h1 { margin: 0 0 4px; font-size: 20px; letter-spacing: 0.03em; }
            .meta { margin: 0; font-size: 12px; }
            .meta span { display: inline-block; width: 1.3in; border-bottom: 1px solid #111; }
            .subject { margin-top: 20px; border-bottom: 1px solid #111; padding-bottom: 5px; display: grid; grid-template-columns: 31% 69%; gap: 10px; font-size: 12px; font-weight: 700; }
            .intro { margin-top: 18px; font-size: 12px; line-height: 1.4; }
            .details { margin-top: 20px; }
            .details p { display: grid; grid-template-columns: 31% 69%; gap: 10px; padding: 6px 0; border-bottom: 1px solid #111; margin: 0; font-size: 12px; }
            .details b { font-weight: 700; }
            .details span { display: block; overflow-wrap: anywhere; }
            .participants { margin-top: 18px; }
            .participants .spacer { height: calc(12px * 1.15); }
            .participants h2 { margin: 0 0 10px; font-size: 14px; font-weight: 700; }
            .participants ol { margin: 0; padding-left: 20px; font-size: 12px; }
            .obligations { margin-top: 20px; font-size: 12px; }
            .obligations ul { margin: 8px 0 0 18px; padding: 0; }
            .footer { margin-top: 18px; font-size: 11px; line-height: 1.5; }
            @media print { body { margin: 0; } .sheet { page-break-inside: avoid; break-inside: avoid; } }
          </style>
        </head>
        <body>
          <div class="sheet">
            <img src="${publicAsset("/Document-Header-Footer.jpg")}" alt="" />
            <div class="content">
              <header>
                <h1>SPECIAL ORDER</h1>
                <p class="meta">No. <span></span></p>
                <p class="meta">Series of ${new Date().getFullYear()}</p>
              </header>
              <section class="subject">
                <b>SUBJECT :</b>
                <span>${order.subject}</span>
              </section>
              <p class="intro">In view of the unavailability of the undersigned and/or the absence of specified participants on the received communications, the following personnel is/are hereby designated to attend and represent this Office in the activity detailed below:</p>
              <section class="details">
                <p><b>Title of the Activity :</b><span>${order.activityTitle}</span></p>
                <p><b>Organizer/ Host :</b><span>${order.organizer}</span></p>
                <p><b>Date</b><span>${formatDate(order.dateFrom)}${order.dateTo !== order.dateFrom ? ` to ${formatDate(order.dateTo)}` : ""}</span></p>
                <p><b>Venue</b><span>${order.venue}</span></p>
              </section>
              <section class="participants">
                <div class="spacer"></div>
                <h2>Designated Participant:</h2>
                <ol>${order.participants.map((participant) => `<li>${participant}</li>`).join("")}</ol>
              </section>
              <section class="obligations">
                <p>The above-named personnel shall actively participate in the said activity and are expected to:</p>
                <ul>
                  <li>Represent the office professionally;</li>
                  <li>Take note of important discussions, agreements, and action items;</li>
                  <li>Submit a brief report and/or feedback within <span>____</span> days after the activity.</li>
                </ul>
              </section>
              <div class="footer">
                Travel and other incidental expenses, if any, shall be charged against available funds subject to existing accounting and auditing rules and regulations.
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    const blob = new Blob([printContent], { type: "text/html" });
    const printUrl = URL.createObjectURL(blob);
    const printWindow = window.open(printUrl, "_blank", "width=1200,height=900");

    if (!printWindow) {
      setDownloadError("Please allow pop-ups to print the document.");
      URL.revokeObjectURL(printUrl);
      return;
    }

    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      setTimeout(() => URL.revokeObjectURL(printUrl), 1000);
    }, 300);
  }

  return <div className="preview-backdrop"><div className="preview-toolbar"><span>Special Order preview</span><button className="ghost-button" onClick={onClose}>Close</button><button className="ghost-button" onClick={printA4}>Print A4</button><button className="primary-button" disabled={downloading} onClick={downloadOrder}>{downloading ? "Preparing JPG..." : "Download this Photo"}</button>{downloadError && <small className="download-error">{downloadError}</small>}</div><article ref={orderRef} className="special-order-paper"><img className="special-order-letterhead" src={publicAsset("/Document-Header-Footer.jpg")} alt="" /><div className="special-order-content"><header className="special-order-heading"><h1>SPECIAL ORDER</h1><p>No. <span /></p><p>Series of {new Date().getFullYear()}</p></header><section className="special-order-subject"><p><b>SUBJECT :</b><span>{order.subject}</span></p></section><p className="special-order-intro">In view of the unavailability of the undersigned and/or the absence of specified participants on the received communications, the following personnel is/are hereby designated to attend and represent this Office in the activity detailed below:</p><section className="special-order-details"><p><b>Title of the Activity :</b><span>{order.activityTitle}</span></p><p><b>Organizer/ Host :</b><span>{order.organizer}</span></p><p><b>Date</b><span>{formatDate(order.dateFrom)}{order.dateTo !== order.dateFrom && ` to ${formatDate(order.dateTo)}`}</span></p><p><b>Venue</b><span>{order.venue}</span></p></section><section className="special-order-participants"><div className="special-order-spacer" aria-hidden="true" /><h2>Designated Participant:</h2><ol>{order.participants.map((participant) => <li key={participant}>{participant}</li>)}</ol></section><section className="special-order-obligations"><p>The above-named personnel shall actively participate in the said activity and are expected to:</p><ul><li>Represent the office professionally;</li><li>Take note of important discussions, agreements, and action items;</li><li>Submit a brief written report and/or feedback within ____ days after the activity.</li></ul></section><p className="special-order-expenses">Travel and other incidental expenses, if any, shall be charged against available funds subject to existing accounting and auditing rules and regulations.</p><p className="special-order-done">Done this ____ day of ____________, {new Date().getFullYear()}</p><footer className="special-order-signatory"><strong>ENGR. RICARDO M. OÑATE JR.</strong><span>Regional Executive Director</span></footer></div></article></div>;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [specialOrders, setSpecialOrders] = useState<SpecialOrder[]>([]);
  const [view, setView] = useState<"list" | "new">("list");
  const [section, setSection] = useState<"permits" | "special-orders">("permits");
  const [preview, setPreview] = useState<Permit | null>(null);
  const [specialOrderPreview, setSpecialOrderPreview] = useState<SpecialOrder | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (!auth) { setLoading(false); return; } return onAuthStateChanged(auth, (currentUser) => { setUser(currentUser); setLoading(false); }); }, []);
  useEffect(() => { if (!user || !db) return; getDocs(query(collection(db, "permits"), where("ownerId", "==", user.uid), orderBy("createdAt", "desc"))).then((snapshot) => setPermits(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Permit)))).catch(() => setError("Could not load permits. If this is your first setup, deploy the Firestore index or refresh.")); }, [user]);
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

  if (loading) return <div className="loading-screen">Loading Permit Desk...</div>;
  if (!isFirebaseConfigured) return <div className="setup-screen"><div className="setup-card"><div className="brand-mark">PD</div><p className="eyebrow">One setup step</p><h1>Connect your Firebase project</h1><p className="muted">Copy <strong>.env.example</strong> to <strong>.env.local</strong>, add your Firebase web app credentials, then restart the dev server.</p><code>NEXT_PUBLIC_FIREBASE_PROJECT_ID=...</code></div></div>;
  if (!user) return <Login onError={setError} />;

  return <div className="app-shell"><header className="topbar"><div className="brand"><div className="brand-mark">PD</div><span>Permit Desk</span></div><nav className="main-nav"><button className={section === "permits" ? "nav-button active" : "nav-button"} onClick={() => { setSection("permits"); setView("list"); }}>Permit slips</button><button className={section === "special-orders" ? "nav-button active" : "nav-button"} onClick={() => { setSection("special-orders"); setView("list"); }}>Special Order</button></nav><div className="user-menu"><span>{user.email}</span><button className="text-button" onClick={() => auth && signOut(auth)}>Log out</button></div></header><main className="dashboard"><div className="dashboard-header"><div><p className="eyebrow">{new Intl.DateTimeFormat("en-PH", { dateStyle: "full" }).format(new Date())}</p><h1>Good to see you.</h1></div><div className="status-pill"><span /> Secure session</div></div>{error && <div className="error-message">{error}</div>}{section === "permits" ? (view === "new" ? <PermitForm user={user} onSaved={(permit) => { setPermits([permit, ...permits]); setView("list"); }} onCancel={() => setView("list")} onError={setError} /> : <PermitList permits={permits} onNew={() => { setError(""); setView("new"); }} onPrint={setPreview} />) : (view === "new" ? <SpecialOrderForm user={user} onSaved={(order) => { setSpecialOrders([order, ...specialOrders]); setView("list"); }} onCancel={() => setView("list")} onError={setError} /> : <SpecialOrderList orders={specialOrders} onNew={() => { setError(""); setView("new"); }} onPrint={setSpecialOrderPreview} />)}</main>{preview && <PrintPreview permit={preview} onClose={() => setPreview(null)} />}{specialOrderPreview && <SpecialOrderPreview order={specialOrderPreview} onClose={() => setSpecialOrderPreview(null)} />}</div>;
}

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
      onError(error instanceof Error ? error.message.replace("Firebase: ", "") : "Unable to authenticate.");
    } finally { setBusy(false); }
  }

  return <main className="auth-shell">
    <section className="auth-intro"><div className="brand-mark">PD</div><p className="eyebrow">Permit administration</p><h1>Keep every<br /><em>movement</em> accounted for.</h1><p className="intro-copy">A clear, dependable desk for creating and retrieving official permit slips.</p><div className="intro-note"><span>01</span><p>Authenticated access for your unit</p></div></section>
    <section className="auth-panel"><div className="auth-form-wrap"><div className="mobile-brand"><div className="brand-mark">PD</div><span>Permit Desk</span></div><p className="eyebrow">{registering ? "New account" : "Welcome back"}</p><h2>{registering ? "Create your account" : "Sign in to Permit Desk"}</h2><p className="muted">{registering ? "Start managing your permit slips." : "Enter your details to continue."}</p><form onSubmit={submit}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@agency.gov" required /></label><label>Password<input type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" required /></label><button className="primary-button" disabled={busy}>{busy ? "Please wait..." : registering ? "Create account" : "Sign in"}</button></form><button className="text-button" onClick={() => setRegistering(!registering)}>{registering ? "Already have an account? Sign in" : "Need an account? Register here"}</button></div></section>
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

  return <div 
  className="preview-backdrop">
    <div className="preview-toolbar">
        <span>Permit preview</span>
        <button className="ghost-button" onClick={onClose}>Close</button>
        <button className="primary-button" disabled={downloading} onClick={downloadPermit}>{downloading ? "Preparing JPG..." : "Download this Photo"}</button>
        {downloadError && <small className="download-error">{downloadError}</small>}
        </div><article ref={permitRef} className="permit-paper permit-document">
            <header className="permit-header">
                <img src={publicAsset("/bagong-pilipinas-logo.webp")} alt="Bagong Pilipinas" />
                <div className="permit-heading"><h1>PERMIT SLIP</h1></div>
                <img src={publicAsset("/da-caraga-logo.jpg")} alt="Department of Agriculture Caraga Region" />
                </header><div className="permit-rule" /><section className="permit-identification">
                    <div><b>PS No.</b><span>{permit.permitNo}</span></div>
                    <div><b>Date</b><span>{formatDate(permit.date)}</span></div></section>
                    <section className="permit-body"><h2>PERMIT TO LEAVE THE OFFICE IS GRANTED TO:</h2><p className="permit-line permit-name-line">{permit.name}</p><h2>Purpose:</h2><p className="permit-line permit-purpose-line">{permit.purpose}</p></section>
                    <table className="permit-log"><thead><tr><th>VISITED PLACES</th><th>CERTIFYING OFFICER</th></tr></thead>
                    <tbody>
                        <tr><td /><td /></tr>
                        <tr><td /><td /></tr>
                        <tr><td /><td /></tr>
                        <tr><td /><td /></tr>
                        <tr><td /><td /></tr>
                        <tr><td /><td /></tr>
                    </tbody>
                    </table><section className="permit-times"><span className="permit-certifying-label"><b>GUARD SIGNATURE</b></span><div><b>TIME OUT</b><span>:</span><i /><span>:</span><i /></div><div><b>TIME IN</b><span>:</span><i /><span>:</span><i /></div></section><footer className="permit-approval"><span>Approved:</span><strong>GERLIE B. ANTIPASO</strong><em>DRRM / AMIA / AGRISTAT Head / Agriculturist II</em></footer></article></div>;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [view, setView] = useState<"list" | "new">("list");
  const [preview, setPreview] = useState<Permit | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (!auth) { setLoading(false); return; } return onAuthStateChanged(auth, (currentUser) => { setUser(currentUser); setLoading(false); }); }, []);
  useEffect(() => { if (!user || !db) return; getDocs(query(collection(db, "permits"), where("ownerId", "==", user.uid), orderBy("createdAt", "desc"))).then((snapshot) => setPermits(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Permit)))).catch(() => setError("Could not load permits. If this is your first setup, deploy the Firestore index or refresh.")); }, [user]);

  if (loading) return <div className="loading-screen">Loading Permit Desk...</div>;
  if (!isFirebaseConfigured) return <div className="setup-screen"><div className="setup-card"><div className="brand-mark">PD</div><p className="eyebrow">One setup step</p><h1>Connect your Firebase project</h1><p className="muted">Copy <strong>.env.example</strong> to <strong>.env.local</strong>, add your Firebase web app credentials, then restart the dev server.</p><code>NEXT_PUBLIC_FIREBASE_PROJECT_ID=...</code></div></div>;
  if (!user) return <Login onError={setError} />;

  return <div className="app-shell"><header className="topbar"><div className="brand"><div className="brand-mark">PD</div><span>Permit Desk</span></div><div className="user-menu"><span>{user.email}</span><button className="text-button" onClick={() => auth && signOut(auth)}>Log out</button></div></header><main className="dashboard"><div className="dashboard-header"><div><p className="eyebrow">{new Intl.DateTimeFormat("en-PH", { dateStyle: "full" }).format(new Date())}</p><h1>Good to see you.</h1></div><div className="status-pill"><span /> Secure session</div></div>{error && <div className="error-message">{error}</div>}{view === "new" ? <PermitForm user={user} onSaved={(permit) => { setPermits([permit, ...permits]); setView("list"); }} onCancel={() => setView("list")} onError={setError} /> : <PermitList permits={permits} onNew={() => { setError(""); setView("new"); }} onPrint={setPreview} />}</main>{preview && <PrintPreview permit={preview} onClose={() => setPreview(null)} />}</div>;
}

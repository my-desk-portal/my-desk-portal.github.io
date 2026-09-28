"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { addDoc, collection, getDocs, query, serverTimestamp, where } from "firebase/firestore";
import type { User } from "firebase/auth";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { db } from "@/lib/firebase";
import "./certificate-of-appearance.css";

type CertificateGender = "female" | "male" | "unspecified";
type CertificatePerson = { name: string; gender: CertificateGender; office?: string };
type CertificateRecord = {
  id: string;
  office?: string;
  eventTitle: string;
  destination: string;
  eventDateFrom?: string;
  eventDateTo?: string;
  eventDate?: string;
  people: CertificatePerson[];
  signatoryName: string;
  designation: string;
  division: string;
  ownerId: string;
  createdAt?: { toMillis?: () => number };
};

const publicAsset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
const blankCertificateAsset = publicAsset("/certificate-of-appearance-blank.jpg");
const newPerson = (): CertificatePerson => ({ name: "", gender: "unspecified", office: "" });

function displayDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function displayDateRange(from?: string, to?: string) {
  const startValue = from ?? "";
  const endValue = to ?? from ?? "";
  if (!startValue) return displayDate(endValue);
  if (!endValue || startValue === endValue) return displayDate(startValue);
  const startDate = new Date(`${startValue}T00:00:00`);
  const endDate = new Date(`${endValue}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return `${displayDate(startValue)} - ${displayDate(endValue)}`;
  const startMonth = new Intl.DateTimeFormat("en-PH", { month: "long" }).format(startDate);
  const endMonth = new Intl.DateTimeFormat("en-PH", { month: "long" }).format(endDate);
  if (startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth()) {
    return `${startMonth} ${startDate.getDate()} - ${endDate.getDate()}, ${endDate.getFullYear()}`;
  }
  if (startDate.getFullYear() === endDate.getFullYear()) {
    return `${displayDate(startValue)} - ${endMonth} ${endDate.getDate()}, ${endDate.getFullYear()}`;
  }
  return `${displayDate(startValue)} - ${displayDate(endValue)}`;
}

function eventPeriod(from?: string, to?: string) {
  const start = from ?? "";
  const end = to ?? from ?? "";
  return `on ${displayDateRange(start || end, end || start)}`;
}

function pronoun(gender: CertificateGender) {
  return gender === "female" ? "her" : gender === "male" ? "him" : "them";
}

export default function CertificateOfAppearance({ user }: { user: User }) {
  const [records, setRecords] = useState<CertificateRecord[]>([]);
  const [view, setView] = useState<"list" | "new">("list");
  const [preview, setPreview] = useState<CertificateRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");
  const pagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!db) { setLoading(false); setError("Certificate storage is unavailable."); return; }
    getDocs(query(collection(db, "certificatesOfAppearance"), where("ownerId", "==", user.uid)))
      .then((snapshot) => {
        const loaded = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as CertificateRecord));
        loaded.sort((first, second) => (second.createdAt?.toMillis?.() ?? 0) - (first.createdAt?.toMillis?.() ?? 0));
        setRecords(loaded);
      })
      .catch((cause) => {
        const code = (cause as { code?: string }).code;
        setError(code ? `Could not load certificates (${code}).` : "Could not load certificates. Refresh and try again.");
      })
      .finally(() => setLoading(false));
  }, [user.uid]);

  async function saveCertificate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!db) { setError("Certificate storage is unavailable."); return; }
    const form = new FormData(event.currentTarget);
    const personNames = form.getAll("person-name").map((name) => String(name).trim());
    const genders = form.getAll("person-gender").map((gender) => String(gender) as CertificateGender);
    const recordData = {
      eventTitle: String(form.get("event-title") ?? "").trim(),
      destination: String(form.get("destination") ?? "").trim(),
      eventDateFrom: String(form.get("event-date-from") ?? ""),
      eventDateTo: String(form.get("event-date-to") ?? ""),
      people: personNames.map((name, index) => ({ name, gender: genders[index] ?? "unspecified", office: String(form.getAll("person-office")[index] ?? "").trim() })),
      signatoryName: String(form.get("signatory-name") ?? "").trim(),
      designation: String(form.get("designation") ?? "").trim(),
      division: String(form.get("division") ?? "").trim(),
      ownerId: user.uid,
      createdAt: serverTimestamp(),
    };
    setSaving(true);
    try {
      const reference = await addDoc(collection(db, "certificatesOfAppearance"), recordData);
      setRecords((current) => [{ ...recordData, id: reference.id, createdAt: undefined }, ...current]);
      setView("list");
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code ? `Could not save the certificate (${code}).` : "Could not save the certificate. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function waitForImages() {
    if (!pagesRef.current) throw new Error("The certificate preview is unavailable.");
    await Promise.all(Array.from(pagesRef.current.querySelectorAll("img"), async (image) => {
      if (!image.complete) await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("The Certificate of Appearance blank could not be loaded."));
      });
      if (!image.naturalWidth) throw new Error("The Certificate of Appearance blank could not be loaded.");
      if (image.decode) await image.decode();
    }));
    if (document.fonts?.ready) await document.fonts.ready;
  }

  async function downloadPdf() {
    setDownloading(true);
    setError("");
    try {
      await waitForImages();
      const sheets = Array.from(pagesRef.current!.querySelectorAll<HTMLElement>(".coa-print-sheet"));
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      for (let index = 0; index < sheets.length; index += 1) {
        const canvas = await html2canvas(sheets[index], { backgroundColor: "#fff", logging: false, scale: 3, useCORS: true });
        if (index > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.96), "JPEG", 0, 0, 210, 297);
      }
      pdf.save(`certificate-of-appearance-${preview?.eventDateFrom || preview?.eventDate || "record"}.pdf`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the PDF.");
    } finally {
      setDownloading(false);
    }
  }

  async function printCertificates() {
    setPrinting(true);
    setError("");
    try {
      await waitForImages();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      window.print();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to prepare the certificates for printing.");
    } finally {
      setPrinting(false);
    }
  }

  if (preview) {
    const pages: CertificatePerson[][] = [];
    for (let index = 0; index < preview.people.length; index += 2) pages.push(preview.people.slice(index, index + 2));
    return <div className="preview-backdrop coa-preview-backdrop">
      <div className="preview-toolbar coa-preview-toolbar"><span>Certificate of Appearance preview</span><button type="button" className="ghost-button" onClick={() => { setPreview(null); setError(""); }}>Close</button><button type="button" className="pdf-button" disabled={downloading} onClick={() => void downloadPdf()}>{downloading ? "Preparing PDF..." : "Download PDF"}</button><button type="button" className="pdf-button" disabled={printing} onClick={() => void printCertificates()}>{printing ? "Preparing print..." : "Print"}</button></div>
      {error && <p className="coa-error" role="alert">{error}</p>}
      <div className="coa-preview-pages" ref={pagesRef}>{pages.map((people, pageIndex) => <section className="coa-print-sheet" key={`sheet-${pageIndex}`} aria-label={`A4 page ${pageIndex + 1}`}>
        {people.map((person, personIndex) => <CertificatePaper key={`${person.name}-${personIndex}`} record={preview} person={person} />)}
      </section>)}</div>
    </div>;
  }

  if (view === "new") return <CertificateForm onCancel={() => { setView("list"); setError(""); }} onSubmit={saveCertificate} saving={saving} error={error} />;

  return <section className="content-section form-section coa-list-section">
    <div className="section-heading"><div><p className="eyebrow">Document generator</p><h2>Certificate of Appearance Generated Reports</h2><p className="muted">Create a certificate for one person or a group.</p></div><button type="button" className="primary-button" onClick={() => { setError(""); setView("new"); }}>Add</button></div>
    {error && <p className="coa-error" role="alert">{error}</p>}
    {loading ? <p className="muted">Loading certificates...</p> : records.length === 0 ? <div className="empty-state"><span className="empty-number">00</span><h3>No certificates yet</h3><p>Add the appearance details to create your first certificate.</p><button type="button" className="text-button" onClick={() => setView("new")}>Add a Certificate of Appearance</button></div> : <div className="coa-record-list"><div className="coa-record-head"><span>Event&apos;s Title</span><span>Event&apos;s Destination</span><span>Event&apos;s Date</span><span></span></div>{records.map((record) => <div className="coa-record-row" key={record.id}><strong>{record.eventTitle}</strong><span>{record.destination}</span><span>{displayDateRange(record.eventDateFrom ?? record.eventDate, record.eventDateTo ?? record.eventDateFrom ?? record.eventDate)}</span><button type="button" className="row-action" onClick={() => { setError(""); setPreview(record); }}>Preview</button></div>)}</div>}
  </section>;
}

function CertificateForm({ onCancel, onSubmit, saving, error }: { onCancel: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; saving: boolean; error: string }) {
  const [people, setPeople] = useState([newPerson()]);
  const [eventDateFrom, setEventDateFrom] = useState("");
  return <section className="content-section form-section coa-form-section">
    <div className="section-heading"><div><p className="eyebrow">New record</p><h2>Create Certificate of Appearance</h2><p className="muted">Enter the event details and one or more attendees. Two certificates fit on each A4 page.</p></div><button type="button" className="ghost-button" onClick={onCancel}>Cancel</button></div>
    {error && <p className="coa-error" role="alert">{error}</p>}
    <form className="permit-form coa-form" onSubmit={onSubmit}>
      <label className="wide-field">Event&apos;s Title<input name="event-title" maxLength={240} required /></label>
      <label>Event&apos;s Destination<input name="destination" maxLength={180} required /></label>
      <div className="wide-field coa-date-range"><label>Event&apos;s Date (From)<input name="event-date-from" type="date" value={eventDateFrom} onChange={(event) => setEventDateFrom(event.target.value)} required /></label><span>to</span><label>Event&apos;s Date (To)<input name="event-date-to" type="date" min={eventDateFrom || undefined} required /></label></div>
      <fieldset className="wide-field coa-people-fieldset"><legend>Attendees</legend>{people.map((person, index) => <div className="coa-person-row" key={index}>
        <label>Name<input name="person-name" maxLength={160} value={person.name} onChange={(event) => setPeople((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} placeholder={`Person ${index + 1}`} required /></label>
        <label>Gender<select name="person-gender" value={person.gender} onChange={(event) => setPeople((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, gender: event.target.value as CertificateGender } : item))}><option value="unspecified">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option></select></label>
        <label>Office<input name="person-office" maxLength={180} value={person.office ?? ""} onChange={(event) => setPeople((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, office: event.target.value } : item))} required /></label>
        {people.length > 1 && <button type="button" className="remove-participant" onClick={() => setPeople((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}
      </div>)}<button type="button" className="text-button" onClick={() => setPeople((current) => [...current, newPerson()])}>+ Add person</button></fieldset>
      <label>Signatory Name<input name="signatory-name" maxLength={160} required /></label>
      <label>Designation<input name="designation" maxLength={160} required /></label>
      <label className="wide-field">Division<input name="division" maxLength={180} required /></label>
      <div className="form-actions"><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving..." : "Save certificate"}</button></div>
    </form>
  </section>;
}

function CertificatePaper({ record, person }: { record: CertificateRecord; person: CertificatePerson }) {
  return <article className="coa-certificate-card">
    <img className="coa-letterhead" src={blankCertificateAsset} alt="" />
    <h1 className="coa-title">CERTIFICATE OF APPEARANCE</h1>
    <div className="coa-copy">
      <p>This is to certify that <strong className="coa-name">{person.name}</strong> of the <strong className="coa-office">{person.office ?? record.office}</strong> has attended the <strong><em>“{record.eventTitle}”</em></strong> held in <strong>{record.destination}</strong> <strong>{eventPeriod(record.eventDateFrom ?? record.eventDate, record.eventDateTo ?? record.eventDateFrom ?? record.eventDate)}</strong>.</p>
      <p>This certification is issued upon the request of the above-named person for whatever legal purpose it may serve {pronoun(person.gender)} best.</p>
    </div>
    <footer className="coa-signatory"><strong>{record.signatoryName}</strong><div className="coa-signatory-role"><em>{record.designation},</em> <span>{record.division}</span></div></footer>
  </article>;
}

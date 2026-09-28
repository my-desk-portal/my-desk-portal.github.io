"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { addDoc, collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import type { User } from "firebase/auth";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { db } from "@/lib/firebase";
import { parseAppreciationImportWorkbook } from "@/lib/appreciation-import";
import "./appreciation.css";

type AppreciationGender = "female" | "male";
type AppreciationRecord = {
  id: string;
  unit: "DRRM";
  speakerName: string;
  speakerGender: AppreciationGender;
  speakerPosition: string;
  speakerOffice: string;
  eventTitle: string;
  eventDateFrom: string;
  eventDateTo: string;
  eventTimeFrom: string;
  eventTimeTo: string;
  eventDestination: string;
  distributionSameAsDestination: boolean;
  distributionPlace: string;
  ownerId: string;
  createdAt?: { toMillis?: () => number };
};

const asset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
const blankAppreciation = asset("/appreciation-drrm-blank.jpg");
const importTemplate = asset("/Appreciation_Importing_Template.xlsx");

function displayDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric" }).format(date);
}

function displayDateRange(from: string, to: string) {
  if (!from) return displayDate(to);
  if (!to || from === to) return displayDate(from);
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${displayDate(from)} - ${displayDate(to)}`;
  const month = new Intl.DateTimeFormat("en-PH", { month: "long" });
  const startMonth = month.format(start);
  const endMonth = month.format(end);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) return `${startMonth} ${start.getDate()} - ${end.getDate()}, ${end.getFullYear()}`;
  if (start.getFullYear() === end.getFullYear()) return `${displayDate(from)} - ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
  return `${displayDate(from)} - ${displayDate(to)}`;
}

function displayTime(value: string) {
  const [hourText, minutes] = value.split(":");
  const hourValue = Number(hourText);
  if (!Number.isFinite(hourValue) || !minutes) return value;
  return `${hourValue % 12 || 12}:${minutes} ${hourValue >= 12 ? "PM" : "AM"}`;
}

function ordinalDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return displayDate(value);
  const day = date.getDate();
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th";
  return <>{day}<sup className="appreciation-ordinal">{suffix}</sup> day of {new Intl.DateTimeFormat("en-PH", { month: "long" }).format(date)} {date.getFullYear()}</>;
}

function countryLocation(value: string) {
  return /philippines/i.test(value) ? value : `${value}, Philippines`;
}

export default function AppreciationCertificate({ user }: { user: User }) {
  const [records, setRecords] = useState<AppreciationRecord[]>([]);
  const [view, setView] = useState<"list" | "new">("list");
  const [preview, setPreview] = useState<AppreciationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const pagesRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!db) { setLoading(false); setError("Appreciation certificate storage is unavailable."); return; }
    getDocs(query(collection(db, "appreciationCertificates"), where("ownerId", "==", user.uid)))
      .then((snapshot) => {
        const loaded = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as AppreciationRecord));
        loaded.sort((left, right) => (right.createdAt?.toMillis?.() ?? 0) - (left.createdAt?.toMillis?.() ?? 0));
        setRecords(loaded);
      })
      .catch((cause) => {
        const code = (cause as { code?: string }).code;
        setError(code ? `Could not load Appreciation certificates (${code}).` : "Could not load Appreciation certificates. Refresh and try again.");
      })
      .finally(() => setLoading(false));
  }, [user.uid]);

  async function saveAppreciation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!db) { setError("Appreciation certificate storage is unavailable."); return; }
    const form = new FormData(event.currentTarget);
    const eventDestination = String(form.get("event-destination") ?? "").trim();
    const sameAsDestination = form.get("distribution-same") === "yes";
    const unit = String(form.get("unit") ?? "") as "AMIA" | "AGRISTAT" | "DRRM";
    if (unit !== "DRRM") { setError("Only the DRRM appreciation certificate is available right now."); return; }
    const distributionPlace = sameAsDestination ? eventDestination : String(form.get("distribution-place") ?? "").trim();
    const recordData = {
      unit,
      speakerName: String(form.get("speaker-name") ?? "").trim(),
      speakerGender: String(form.get("speaker-gender") ?? "") as AppreciationGender,
      speakerPosition: String(form.get("speaker-position") ?? "").trim(),
      speakerOffice: String(form.get("speaker-office") ?? "").trim(),
      eventTitle: String(form.get("event-title") ?? "").trim(),
      eventDateFrom: String(form.get("event-date-from") ?? ""),
      eventDateTo: String(form.get("event-date-to") ?? ""),
      eventTimeFrom: String(form.get("event-time-from") ?? ""),
      eventTimeTo: String(form.get("event-time-to") ?? ""),
      eventDestination,
      distributionSameAsDestination: sameAsDestination,
      distributionPlace,
      ownerId: user.uid,
      createdAt: serverTimestamp(),
    };
    setSaving(true);
    try {
      const reference = await addDoc(collection(db, "appreciationCertificates"), recordData);
      setRecords((current) => [{ ...recordData, id: reference.id, createdAt: undefined } as AppreciationRecord, ...current]);
      setView("list");
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code ? `Could not save the Appreciation certificate (${code}).` : "Could not save the Appreciation certificate. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function importAppreciations(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setError("");
    setImportMessage("");
    if (!db) { setError("Appreciation certificate storage is unavailable."); return; }
    if (!file.name.toLowerCase().endsWith(".xlsx")) { setError("Choose the Appreciation_Importing_Template.xlsx workbook (.xlsx)."); return; }

    setImporting(true);
    let imported: AppreciationRecord[] = [];
    try {
      const parsed = parseAppreciationImportWorkbook(new Uint8Array(await file.arrayBuffer()));
      const target = collection(db, "appreciationCertificates");
      for (let offset = 0; offset < parsed.length; offset += 450) {
        const batch = writeBatch(db);
        const chunk: AppreciationRecord[] = parsed.slice(offset, offset + 450).map((record) => {
          const reference = doc(target);
          const data = { ...record, ownerId: user.uid, createdAt: serverTimestamp() };
          batch.set(reference, data);
          return { ...data, id: reference.id, createdAt: undefined } as AppreciationRecord;
        });
        await batch.commit();
        imported = [...imported, ...chunk];
        setRecords((current) => [...chunk, ...current]);
      }
      setImportMessage(`Imported ${imported.length} Appreciation ${imported.length === 1 ? "certificate" : "certificates"}. Distribution dates use the event end date.`);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Check the template and try again.";
      setError(imported.length ? `${detail} ${imported.length} ${imported.length === 1 ? "certificate was" : "certificates were"} imported before the error.` : detail);
    } finally {
      setImporting(false);
    }
  }

  async function waitForBlank() {
    const image = pagesRef.current?.querySelector<HTMLImageElement>(".appreciation-blank");
    if (!image) throw new Error("The Appreciation certificate preview is unavailable.");
    if (!image.complete) await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The DRRM Appreciation blank could not be loaded."));
    });
    if (!image.naturalWidth) throw new Error("The DRRM Appreciation blank could not be loaded.");
    if (image.decode) await image.decode();
    if (document.fonts?.ready) await document.fonts.ready;
  }

  async function downloadPdf() {
    setDownloading(true);
    setError("");
    let paper: HTMLElement | null = null;
    let originalPaperWidth = "";
    let originalPaperMaxWidth = "";
    try {
      await waitForBlank();
      paper = pagesRef.current?.querySelector<HTMLElement>(".appreciation-print-sheet") ?? null;
      if (!paper) throw new Error("The Appreciation certificate preview is unavailable.");
      originalPaperWidth = paper.style.width;
      originalPaperMaxWidth = paper.style.maxWidth;
      paper.style.width = "11in";
      paper.style.maxWidth = "none";
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const canvas = await html2canvas(paper, { backgroundColor: "#fff", logging: false, scale: 3, useCORS: true });
      const pdf = new jsPDF({ orientation: "landscape", unit: "in", format: "letter" });
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.97), "JPEG", 0, 0, 11, 8.5);
      const filename = preview!.speakerName.trim().replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "") || "speaker";
      pdf.save(`appreciation-certificate-${filename}.pdf`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the Appreciation certificate PDF.");
    } finally {
      if (paper) {
        paper.style.width = originalPaperWidth;
        paper.style.maxWidth = originalPaperMaxWidth;
      }
      setDownloading(false);
    }
  }

  async function printCertificate() {
    setPrinting(true);
    setError("");
    try {
      await waitForBlank();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      window.print();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to prepare the Appreciation certificate for printing.");
    } finally {
      setPrinting(false);
    }
  }

  if (preview) return <div className="preview-backdrop appreciation-preview-backdrop">
    <div className="preview-toolbar appreciation-preview-toolbar"><span>Appreciation certificate preview</span><button type="button" className="ghost-button" onClick={() => { setPreview(null); setError(""); }}>Close</button><button type="button" className="pdf-button" disabled={downloading} onClick={() => void downloadPdf()}>{downloading ? "Preparing PDF..." : "Download PDF"}</button><button type="button" className="pdf-button" disabled={printing} onClick={() => void printCertificate()}>{printing ? "Preparing print..." : "Print"}</button></div>
    {error && <p className="appreciation-error" role="alert">{error}</p>}
    <div className="appreciation-preview-pages" ref={pagesRef}><section className="appreciation-print-sheet" aria-label={`Letter landscape Appreciation certificate for ${preview.speakerName}`}><AppreciationPaper record={preview} /></section></div>
  </div>;

  if (view === "new") return <AppreciationForm onCancel={() => { setView("list"); setError(""); }} onSubmit={saveAppreciation} saving={saving} error={error} />;

  return <section className="content-section appreciation-section">
    <div className="section-heading"><div><p className="eyebrow">Document generator</p><h2>Certificate of Appreciation Generated Reports</h2><p className="muted">Create certificates manually or import the <a className="appreciation-template-link" href={importTemplate} download="Appreciation_Importing_Template.xlsx">Appreciation_Importing_Template.xlsx</a>.</p></div><div className="appreciation-list-actions"><button type="button" className="primary-button" onClick={() => { setError(""); setView("new"); }}>Add</button><button type="button" className="ghost-button" disabled={importing} onClick={() => { setError(""); setImportMessage(""); importInputRef.current?.click(); }}>{importing ? "Importing..." : "Import"}</button></div></div>
    <input ref={importInputRef} className="appreciation-import-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void importAppreciations(event)} aria-label="Import Appreciation certificate workbook" />
    {error && <p className="appreciation-error" role="alert">{error}</p>}
    {importMessage && <p className="appreciation-success" role="status">{importMessage}</p>}
    {loading ? <p className="muted">Loading Appreciation certificates...</p> : records.length === 0 ? <div className="empty-state"><span className="empty-number">00</span><h3>No Appreciation certificates yet</h3><p>Add the speaker and event details manually or import the completed Appreciation_Importing_Template.xlsx workbook.</p><div className="appreciation-empty-actions"><button type="button" className="text-button" onClick={() => { setError(""); setView("new"); }}>Add an Appreciation Certificate</button><button type="button" className="text-button" disabled={importing} onClick={() => { setError(""); setImportMessage(""); importInputRef.current?.click(); }}>{importing ? "Importing..." : "Import certificates"}</button></div></div> : <div className="appreciation-record-list"><div className="appreciation-record-head"><span>Unit</span><span>Resource Speaker</span><span>Event&apos;s Title</span><span>Event Dates</span><span></span></div>{records.map((record) => <div className="appreciation-record-row" key={record.id}><span><span className="appreciation-unit-tag">{record.unit}</span></span><strong>{record.speakerName}</strong><span>{record.eventTitle}</span><span>{displayDateRange(record.eventDateFrom, record.eventDateTo)}</span><div className="appreciation-record-actions"><button type="button" className="row-action" onClick={() => { setError(""); setPreview(record); }}>Preview</button></div></div>)}</div>}
  </section>;
}

function AppreciationForm({ onCancel, onSubmit, saving, error }: { onCancel: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; saving: boolean; error: string }) {
  const [eventDateFrom, setEventDateFrom] = useState("");
  const [eventDateTo, setEventDateTo] = useState("");
  const [eventDestination, setEventDestination] = useState("");
  const [sameLocation, setSameLocation] = useState(false);
  const [distributionPlace, setDistributionPlace] = useState("");

  return <section className="content-section appreciation-section appreciation-form-section">
    <div className="section-heading"><div><p className="eyebrow">New record</p><h2>Create Certificate of Appreciation</h2><p className="muted">Enter the resource speaker and event details. The certificate prints on landscape Letter paper.</p></div><button type="button" className="ghost-button" onClick={onCancel}>Cancel</button></div>
    {error && <p className="appreciation-error" role="alert">{error}</p>}
    <form className="permit-form appreciation-form" onSubmit={onSubmit}>
      <label className="wide-field">Unit<select name="unit" defaultValue="DRRM"><option value="AMIA" disabled>AMIA</option><option value="AGRISTAT" disabled>AGRISTAT</option><option value="DRRM">DRRM</option></select><small>AMIA and AGRISTAT templates are on hold for now.</small></label>
      <label>Resource Speaker&apos;s Name<input name="speaker-name" maxLength={180} required /></label>
      <label>Resource Speaker&apos;s Gender<select name="speaker-gender" defaultValue="" required><option value="" disabled>Select gender</option><option value="female">Female</option><option value="male">Male</option></select></label>
      <label>Resource Speaker&apos;s Position<input name="speaker-position" maxLength={180} required /></label>
      <label>Resource Speaker&apos;s Office<input name="speaker-office" maxLength={240} required /></label>
      <label className="wide-field">Event&apos;s Title<input name="event-title" maxLength={240} required /></label>
      <div className="wide-field appreciation-schedule">
        <div className="appreciation-date-range"><label>Event&apos;s Date (From)<input name="event-date-from" type="date" value={eventDateFrom} onChange={(event) => { setEventDateFrom(event.target.value); if (eventDateTo && eventDateTo < event.target.value) setEventDateTo(""); }} required /></label><span>to</span><label>Event&apos;s Date (To)<input name="event-date-to" type="date" min={eventDateFrom || undefined} value={eventDateTo} onChange={(event) => setEventDateTo(event.target.value)} required /></label></div>
        <div className="appreciation-time-range"><label>Time Conducted (From)<input name="event-time-from" type="time" required /></label><span>to</span><label>Time Conducted (To)<input name="event-time-to" type="time" required /></label></div>
      </div>
      <label className="wide-field">Event&apos;s Destination<input name="event-destination" maxLength={240} value={eventDestination} onChange={(event) => setEventDestination(event.target.value)} required /></label>
      <label className="wide-field appreciation-checkbox"><input name="distribution-same" type="checkbox" value="yes" checked={sameLocation} onChange={(event) => setSameLocation(event.target.checked)} />Event destination is also the certificate distribution place</label>
      {!sameLocation && <label className="wide-field">Certificate Distribution Place<input name="distribution-place" maxLength={240} value={distributionPlace} onChange={(event) => setDistributionPlace(event.target.value)} required placeholder="Enter distribution place" /></label>}
      <label className="wide-field">Certificate Distribution Date<input type="text" value={eventDateTo ? displayDate(eventDateTo) : "Set the event end date"} readOnly /><small>Automatically set to the last day of the event.</small></label>
      <div className="form-actions"><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving..." : "Save"}</button></div>
    </form>
  </section>;
}

function AppreciationPaper({ record }: { record: AppreciationRecord }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const objectPronoun = record.speakerGender === "female" ? "her" : "his";

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let active = true;

    const fitBodyText = () => {
      if (!active) return;
      let low = 0.65;
      let high = 2;
      let best = low;
      const requiredHeight = () => {
        const items = Array.from(body.children) as HTMLElement[];
        const gap = Number.parseFloat(window.getComputedStyle(body).rowGap) || 0;
        return items.reduce((height, item) => height + item.getBoundingClientRect().height, 0) + Math.max(0, items.length - 1) * gap;
      };

      for (let step = 0; step < 14; step += 1) {
        const size = (low + high) / 2;
        body.style.setProperty("--appreciation-body-size", `${size}cqi`);
        if (requiredHeight() <= body.clientHeight + 1) {
          best = size;
          low = size;
        } else {
          high = size;
        }
      }

      body.style.setProperty("--appreciation-body-size", `${best}cqi`);
    };

    const observer = new ResizeObserver(fitBodyText);
    observer.observe(body);
    fitBodyText();
    void document.fonts.ready.then(fitBodyText);

    return () => {
      active = false;
      observer.disconnect();
    };
  }, [record]);

  return <article className="appreciation-paper">
    <img className="appreciation-blank" src={blankAppreciation} alt="" />
    <div className="appreciation-speaker-name">{record.speakerName}</div>
    <div className="appreciation-speaker-role"><em>{record.speakerPosition}</em>, {record.speakerOffice}</div>
    <div className="appreciation-body" ref={bodyRef}>
      <p>For {objectPronoun} exemplary service, commitment, and valuable shared insights as <strong>RESOURCE SPEAKER</strong> for <strong>{record.eventTitle}</strong> held on <strong>{displayDateRange(record.eventDateFrom, record.eventDateTo)}</strong> from <strong>{displayTime(record.eventTimeFrom)}</strong> to <strong>{displayTime(record.eventTimeTo)}</strong> at <strong>{countryLocation(record.eventDestination)}</strong>.</p>
      <p>Given this <strong>{ordinalDate(record.eventDateTo)}</strong> at <strong>{countryLocation(record.distributionPlace)}</strong>.</p>
      <footer className="appreciation-signatory"><strong>ENGR. RICARDO M. O&#209;ATE JR.</strong><em>Regional Executive Director</em></footer>
    </div>

  </article>;
}

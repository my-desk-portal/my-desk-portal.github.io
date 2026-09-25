"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { addDoc, collection, getDocs, query, serverTimestamp, where } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import "./nta.css";

type NtaMode = "individual" | "batch";
type NtaAttendee = { name: string; office: string };
type NtaBatch = {
  number: string;
  dateFrom: string;
  dateTo: string;
  timeFrom: string;
  timeTo: string;
  venueType: "physical" | "virtual";
  venue: string;
  link: string;
  attendees: NtaAttendee[];
};
type NtaRecord = {
  id: string;
  mode: NtaMode;
  to?: string;
  subject: string;
  activityTitle: string;
  organizer: string;
  dateFrom?: string;
  dateTo?: string;
  venueType?: "physical" | "virtual";
  venue?: string;
  link?: string;
  batches?: NtaBatch[];
  createdAt?: unknown;
};

const asset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
const formatDate = (date: string) => date ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(new Date(`${date}T12:00:00+08:00`)) : "";
const formatDateRange = (from: string, to: string) => from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
const initialBatch = (): NtaBatch => ({ number: "1", dateFrom: "", dateTo: "", timeFrom: "", timeTo: "", venueType: "physical", venue: "", link: "", attendees: [{ name: "", office: "" }] });

function NtaForm({ user, onSaved, onCancel }: { user: User; onSaved: (record: NtaRecord) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<NtaMode>("individual");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [activityTitle, setActivityTitle] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [venueType, setVenueType] = useState<"physical" | "virtual">("physical");
  const [venue, setVenue] = useState("");
  const [link, setLink] = useState("");
  const [batches, setBatches] = useState<NtaBatch[]>([initialBatch()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function updateBatch(index: number, update: Partial<NtaBatch>) {
    setBatches((current) => current.map((batch, itemIndex) => itemIndex === index ? { ...batch, ...update } : batch));
  }
  function updateAttendee(batchIndex: number, attendeeIndex: number, update: Partial<NtaAttendee>) {
    setBatches((current) => current.map((batch, index) => index === batchIndex ? { ...batch, attendees: batch.attendees.map((attendee, row) => row === attendeeIndex ? { ...attendee, ...update } : attendee) } : batch));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!db) { setError("Database is not configured."); return; }
    setBusy(true); setError("");
    const common = { mode, subject: subject.trim(), activityTitle: activityTitle.trim(), organizer: organizer.trim(), ownerId: user.uid, createdAt: serverTimestamp() };
    try {
      const data = mode === "individual"
        ? { ...common, to: to.trim(), dateFrom, dateTo, venueType, venue: venue.trim(), link: venueType === "virtual" ? link.trim() : "" }
        : { ...common, batches: batches.map((batch) => ({ ...batch, venue: batch.venue.trim(), link: batch.venueType === "virtual" ? batch.link.trim() : "", attendees: batch.attendees.map((attendee) => ({ name: attendee.name.trim(), office: attendee.office.trim() })) })) };
      const reference = await addDoc(collection(db, "ntaRecords"), data);
      onSaved({ id: reference.id, ...data, createdAt: undefined } as NtaRecord);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save Notice to Attend.");
    } finally { setBusy(false); }
  }

  return <section className="content-section form-section nta-form-section">
    <div className="section-heading"><div><p className="eyebrow">New record</p><h2>Create Notice to Attend</h2><p className="muted">Choose an individual notice or a batch schedule.</p></div><button type="button" className="ghost-button" onClick={onCancel}>Cancel</button></div>
    {error && <p className="error-message nta-error">{error}</p>}
    <form className="permit-form" onSubmit={save}>
      <label className="wide-field">Notice type<select value={mode} onChange={(event) => setMode(event.target.value as NtaMode)}><option value="individual">Individual</option><option value="batch">Batch</option></select></label>
      {mode === "individual" ? <>
        <label>TO<input value={to} onChange={(event) => setTo(event.target.value)} required /></label>
        <label>SUBJECT<input value={subject} onChange={(event) => setSubject(event.target.value)} required /></label>
        <label>Title of Activity<input value={activityTitle} onChange={(event) => setActivityTitle(event.target.value)} required /></label>
        <label>Organizer / Host<input value={organizer} onChange={(event) => setOrganizer(event.target.value)} required /></label>
        <div className="date-range-field"><span>Date (From – To)</span><div><input aria-label="Date from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} required /><span>to</span><input aria-label="Date to" type="date" min={dateFrom} value={dateTo} onChange={(event) => setDateTo(event.target.value)} required /></div></div>
        <label>Venue type<select value={venueType} onChange={(event) => setVenueType(event.target.value as "physical" | "virtual")}><option value="physical">Physical venue</option><option value="virtual">Virtual platform</option></select></label>
        <label>{venueType === "virtual" ? "Platform name" : "Venue address"}<input value={venue} onChange={(event) => setVenue(event.target.value)} placeholder={venueType === "virtual" ? "Google Meet, Zoom, etc." : "Street, city, or building"} required /></label>
        {venueType === "virtual" && <label className="wide-field">Meeting link<input type="url" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://" required /></label>}
      </> : <>
        <label className="wide-field">SUBJECT<input value={subject} onChange={(event) => setSubject(event.target.value)} required /></label>
        <label>Title of Activity<input value={activityTitle} onChange={(event) => setActivityTitle(event.target.value)} required /></label>
        <label>Organizer / Host<input value={organizer} onChange={(event) => setOrganizer(event.target.value)} required /></label>
        <div className="wide-field nta-batches">{batches.map((batch, batchIndex) => <fieldset className="nta-batch-fieldset" key={batchIndex}><legend>Batch {batch.number || batchIndex + 1}</legend>
          <label>Batch number<input value={batch.number} onChange={(event) => updateBatch(batchIndex, { number: event.target.value })} required /></label>
          <div className="date-range-field"><span>Date (From – To)</span><div><input aria-label={`Batch ${batchIndex + 1} date from`} type="date" value={batch.dateFrom} onChange={(event) => updateBatch(batchIndex, { dateFrom: event.target.value })} required /><span>to</span><input aria-label={`Batch ${batchIndex + 1} date to`} type="date" min={batch.dateFrom} value={batch.dateTo} onChange={(event) => updateBatch(batchIndex, { dateTo: event.target.value })} required /></div></div>
          <div className="date-range-field"><span>Time</span><div><input aria-label={`Batch ${batchIndex + 1} time from`} type="time" value={batch.timeFrom} onChange={(event) => updateBatch(batchIndex, { timeFrom: event.target.value })} required /><span>to</span><input aria-label={`Batch ${batchIndex + 1} time to`} type="time" value={batch.timeTo} onChange={(event) => updateBatch(batchIndex, { timeTo: event.target.value })} required /></div></div>
          <label>Venue type<select value={batch.venueType} onChange={(event) => updateBatch(batchIndex, { venueType: event.target.value as "physical" | "virtual" })}><option value="physical">Physical venue</option><option value="virtual">Virtual meeting</option></select></label>
          <label>{batch.venueType === "virtual" ? "Platform" : "Place"}<input value={batch.venue} onChange={(event) => updateBatch(batchIndex, { venue: event.target.value })} required /></label>
          {batch.venueType === "virtual" && <label className="wide-field">Meeting link<input type="url" value={batch.link} onChange={(event) => updateBatch(batchIndex, { link: event.target.value })} placeholder="https://" required /></label>}
          <div className="nta-attendee-fields"><span>Personnel attending this batch</span>{batch.attendees.map((attendee, attendeeIndex) => <div className="nta-attendee-input" key={attendeeIndex}><input aria-label={`Batch ${batch.number} person ${attendeeIndex + 1} name`} placeholder="Name" value={attendee.name} onChange={(event) => updateAttendee(batchIndex, attendeeIndex, { name: event.target.value })} required /><input aria-label={`Batch ${batch.number} person ${attendeeIndex + 1} office`} placeholder="Office" value={attendee.office} onChange={(event) => updateAttendee(batchIndex, attendeeIndex, { office: event.target.value })} required />{batch.attendees.length > 1 && <button type="button" className="remove-participant" onClick={() => updateBatch(batchIndex, { attendees: batch.attendees.filter((_, index) => index !== attendeeIndex) })}>Remove</button>}</div>)}<button type="button" className="text-button" onClick={() => updateBatch(batchIndex, { attendees: [...batch.attendees, { name: "", office: "" }] })}>+ Add person</button></div>
          {batches.length > 1 && <button type="button" className="remove-participant nta-remove-batch" onClick={() => setBatches((current) => current.filter((_, index) => index !== batchIndex))}>Remove batch</button>}
        </fieldset>)}<button type="button" className="text-button" onClick={() => setBatches((current) => [...current, { ...initialBatch(), number: String(current.length + 1) }])}>+ Add batch</button></div>
      </>}
      <div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save NTA"}</button></div>
    </form>
  </section>;
}

function NtaList({ records, onNew, onPreview }: { records: NtaRecord[]; onNew: () => void; onPreview: (record: NtaRecord) => void }) {
  return <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Your records</p><h2>Notices to Attend</h2><p className="muted">{records.length} {records.length === 1 ? "notice" : "notices"} registered to your account.</p></div><button className="primary-button" onClick={onNew}>+ Add NTA</button></div>{records.length === 0 ? <div className="empty-state"><span className="empty-number">00</span><h3>No notices to attend yet</h3><p>Create an individual or batch notice.</p><button className="text-button" onClick={onNew}>Add an NTA</button></div> : <div className="permit-table"><div className="table-head nta-list-head"><span>Type</span><span>Subject</span><span>Activity</span><span>Schedule</span><span></span></div>{records.map((record) => <div className="table-row nta-list-row" key={record.id}><strong>{record.mode === "individual" ? "Individual" : "Batch"}</strong><span>{record.subject}</span><span>{record.activityTitle}</span><span>{record.mode === "individual" ? formatDate(record.dateFrom ?? "") : `${record.batches?.length ?? 0} batches`}</span><button className="row-action" onClick={() => onPreview(record)}>Preview</button></div>)}</div>}</section>;
}

type NtaRosterSection = { batch: NtaBatch; batchIndex: number; attendees: NtaAttendee[]; startIndex: number; continued: boolean };
type NtaRosterPageSetting = { capacity: number; saturated: boolean };
type NtaIndividualClosingUnit = "feedback" | "expenses" | "issued" | "signatory";
const ntaIndividualClosingUnits: NtaIndividualClosingUnit[] = ["feedback", "expenses", "issued", "signatory"];

function buildRosterPages(batches: NtaBatch[], firstPageRows: number, pageSettings: NtaRosterPageSetting[]): NtaRosterSection[][] {
  const remaining = batches.flatMap((batch, batchIndex) => batch.attendees.slice(batchIndex === 0 ? firstPageRows : 0).map((attendee, index) => ({ batch, batchIndex, attendee, attendeeIndex: index + (batchIndex === 0 ? firstPageRows : 0) })));
  const pageRows: typeof remaining[] = [];
  let pageIndex = 0;
  while (remaining.length) {
    const pageCapacity = Math.max(1, pageSettings[pageIndex]?.capacity ?? 10);
    pageRows.push(remaining.splice(0, pageCapacity));
    pageIndex += 1;
  }
  return pageRows.map((rows) => rows.reduce<NtaRosterSection[]>((sections, row) => {
    const last = sections[sections.length - 1];
    if (last?.batchIndex === row.batchIndex) last.attendees.push(row.attendee);
    else sections.push({ batch: row.batch, batchIndex: row.batchIndex, attendees: [row.attendee], startIndex: row.attendeeIndex, continued: row.attendeeIndex > 0 });
    return sections;
  }, []));
}

function NtaPage({ record, page, rosterSections = [], showFixedCopy = false, hideFixedCopy = false, firstPageRows = 0, individualClosingUnits = [], individualSignatoryPulledBack = false }: { record: NtaRecord; page: "individual" | "individual-continuation" | "batch-overview" | "batch-attendees" | "batch-copy"; rosterSections?: NtaRosterSection[]; showFixedCopy?: boolean; hideFixedCopy?: boolean; firstPageRows?: number; individualClosingUnits?: NtaIndividualClosingUnit[]; individualSignatoryPulledBack?: boolean }) {
  const batches = record.batches ?? [];
  const individual = page === "individual";
  const batchOverview = page === "batch-overview";
  return <article className="nta-document-page"><img className="nta-letterhead" src={asset("/Document-Header-Footer.jpg")} alt="" /><div className={`nta-document-content ${page}${showFixedCopy ? " nta-roster-copy-page" : ""}${hideFixedCopy ? " nta-roster-copy-hidden" : ""}`}>
    {(individual || batchOverview) && <header className="nta-doc-title"><h1>NOTICE TO ATTEND</h1><p>No. ____________________</p><p>Series of {new Date().getFullYear()}</p></header>}
    {page === "batch-copy" ? <NtaFixedCopy /> : page === "individual-continuation" ? <NtaIndividualClosing units={individualClosingUnits} continuation /> : individual ? <>
      <section className="nta-to-subject"><p><b>TO</b><strong>:</strong><strong>{record.to?.toUpperCase()}</strong></p><p><b>SUBJECT</b><strong>:</strong><strong>{record.subject.toUpperCase()}</strong></p></section>
      <hr className="nta-rule" /><p className="nta-directed">You are hereby directed to attend the activity with the following details:</p>
      <dl className="nta-details"><div><dt>Title of Activity</dt><b>:</b><dd>{record.activityTitle}</dd></div><div><dt>Organizer / Host</dt><b>:</b><dd>{record.organizer}</dd></div><div><dt>Date(s)</dt><b>:</b><dd>{formatDateRange(record.dateFrom ?? "", record.dateTo ?? "")}</dd></div><div><dt>Venue / Platform</dt><b>:</b><dd>{record.venue}</dd></div>{record.venueType === "virtual" && <div><dt>Link</dt><b>:</b><dd className="nta-link">{record.link}</dd></div>}</dl>
      <NtaIndividualClosing units={individualClosingUnits} signatoryPulledBack={individualSignatoryPulledBack} />
    </> : batchOverview ? <>
      <section className="nta-to-subject"><p><b>TO</b><strong>:</strong><strong>ALL CONCERNED PERSONNEL</strong></p><p className="nta-office-line"><span /> <strong>This Office</strong></p><p><b>SUBJECT</b><strong>:</strong><strong>{record.subject.toUpperCase()}</strong></p></section>
      <hr className="nta-rule" /><p className="nta-directed">You are hereby directed to attend the activity with the following details:</p>
      <dl className="nta-details nta-batch-overview">{[
        ["Title", <strong key="title">{record.activityTitle}</strong>],
        ["Organizer / Host", <strong key="organizer">{record.organizer}</strong>],
        ["Date", batches.map((batch) => <strong key={batch.number}>Batch {batch.number} – {formatDateRange(batch.dateFrom, batch.dateTo)}</strong>)],
        ["Time", batches.map((batch) => <strong key={batch.number}>Batch {batch.number} – {formatTime(batch.timeFrom)} – {formatTime(batch.timeTo)}</strong>)],
        ["Venue / Platform", batches.map((batch) => <strong key={batch.number}>Batch {batch.number} – {batch.venue}{batch.venueType === "virtual" && batch.link ? ` (${batch.link})` : ""}</strong>)],
      ].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><b>:</b><dd>{value}</dd></div>)}</dl>
      <p className="nta-attendance-intro">The said concerned personnel are as follows:</p><div className="nta-batch-tables nta-first-page-attendees">{firstPageRows > 0 && batches.slice(0, 1).map((batch) => <NtaBatchTable batch={{ ...batch, attendees: batch.attendees.slice(0, firstPageRows) }} key={batch.number} />)}</div>
      {showFixedCopy && <NtaFixedCopy />}
    </> : <>
      <div className="nta-batch-tables">{rosterSections.map((section) => <NtaBatchTable batch={{ ...section.batch, attendees: section.attendees }} startIndex={section.startIndex} showCaption={!section.continued} key={`${section.batchIndex}-${section.startIndex}`} />)}</div>
      {showFixedCopy && <NtaFixedCopy />}
    </>}
    {(showFixedCopy && (page === "batch-overview" || page === "batch-attendees" || page === "batch-copy")) && <footer className="nta-signatory"><strong>MELODY M. GUIMARY</strong><span>Chief, Field Operations Division</span></footer>}
  </div></article>;
}

function NtaIndividualClosing({ units, signatoryPulledBack = false, continuation = false }: { units: NtaIndividualClosingUnit[]; signatoryPulledBack?: boolean; continuation?: boolean }) {
  if (units.length === 0) return null;
  return <div className={`nta-individual-closing${continuation ? " nta-individual-closing-continuation" : ""}${signatoryPulledBack ? " nta-individual-closing-pulled" : ""}`}>
    {units.map((unit) => {
      if (unit === "signatory") return <footer className="nta-signatory nta-individual-closing-unit" data-nta-individual-closing-unit key={unit}><strong>MELODY M. GUIMARY</strong><span>Chief, Field Operations Division</span></footer>;
      const copy = {
        feedback: "As a representative, you are expected to actively participate and note key discussions and agreements. A brief report of feedback shall be submitted within ____ days after the activity.",
        expenses: "Travel and other incidental expenses, if any, shall be subject to existing accounting and auditing rules and regulations.",
        issued: `Issued this ____ day of ______________, ${new Date().getFullYear()}.`,
      }[unit];
      return <p className="nta-individual-closing-unit" data-nta-individual-closing-unit key={unit}>{copy}</p>;
    })}
  </div>;
}

function NtaBatchTable({ batch, startIndex = 0, showCaption = true }: { batch: NtaBatch; startIndex?: number; showCaption?: boolean }) {
  return <section className="nta-attendance-batch">{showCaption && <p className="nta-batch-caption">Batch {batch.number} – {batch.venue}{batch.venueType === "virtual" && batch.link ? ` – ${batch.link}` : ""} ({formatDateRange(batch.dateFrom, batch.dateTo)} | {formatTime(batch.timeFrom)} – {formatTime(batch.timeTo)})</p>}<table><thead><tr><th>No.</th><th>Name</th><th>Office</th></tr></thead><tbody>{batch.attendees.map((attendee, index) => <tr key={`${attendee.name}-${index}`}><td>{startIndex + index + 1}</td><td>{attendee.name}</td><td>{attendee.office}</td></tr>)}</tbody></table></section>;
}

function formatTime(value: string) {
  if (!value) return "";
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

function NtaFixedCopy() {
  return <div className="nta-fixed-copy"><p>As a representative, you are expected to actively participate and note key discussions and agreements. A brief report of feedback shall be submitted within ____ days after the activity.</p><p>Travel and other incidental expenses, if any, shall be subject to existing accounting and auditing rules and regulations.</p><p>Issued this ____ day of ______________, {new Date().getFullYear()}.</p></div>;
}

function NtaPreview({ record, onClose }: { record: NtaRecord; onClose: () => void }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [measuredFirstPageRows, setMeasuredFirstPageRows] = useState<number | null>(null);
  const [rosterPageSettings, setRosterPageSettings] = useState<NtaRosterPageSetting[]>([{ capacity: 10, saturated: false }]);
  const [copyOnSeparatePage, setCopyOnSeparatePage] = useState(false);
  const [individualClosingCount, setIndividualClosingCount] = useState(ntaIndividualClosingUnits.length);
  const [individualClosingSaturated, setIndividualClosingSaturated] = useState(false);
  const [individualSignatoryPulledBack, setIndividualSignatoryPulledBack] = useState(false);
  const batches = record.batches ?? [];
  const firstPageRows = measuredFirstPageRows ?? batches[0]?.attendees.length ?? 0;
  const rosterPages = record.mode === "batch" ? buildRosterPages(batches, firstPageRows, rosterPageSettings) : [];
  let safeIndividualClosingCount = individualClosingCount;
  if (ntaIndividualClosingUnits.length - safeIndividualClosingCount === 1 && ntaIndividualClosingUnits[safeIndividualClosingCount] === "signatory") safeIndividualClosingCount = Math.max(0, safeIndividualClosingCount - 1);
  const individualFirstPageClosing = ntaIndividualClosingUnits.slice(0, safeIndividualClosingCount);
  const individualContinuationClosing = ntaIndividualClosingUnits.slice(safeIndividualClosingCount);
  useEffect(() => {
    if (record.mode !== "individual") return;
    const recalculateClosingLayout = () => {
      setIndividualClosingCount(ntaIndividualClosingUnits.length);
      setIndividualClosingSaturated(false);
      setIndividualSignatoryPulledBack(false);
    };
    window.addEventListener("resize", recalculateClosingLayout);
    return () => window.removeEventListener("resize", recalculateClosingLayout);
  }, [record.id, record.mode]);
  useLayoutEffect(() => {
    if (!pagesRef.current) return;
    const pageLimit = (page: HTMLElement) => {
      const rect = page.getBoundingClientRect();
      return rect.bottom - rect.width * .121;
    };
    if (record.mode === "individual") {
      const firstPageContent = pagesRef.current.querySelector<HTMLElement>(".nta-document-content.individual");
      const firstPage = firstPageContent?.closest<HTMLElement>(".nta-document-page");
      if (!firstPage || !firstPageContent) return;
      if (safeIndividualClosingCount !== individualClosingCount) {
        setIndividualClosingCount(safeIndividualClosingCount);
        setIndividualClosingSaturated(true);
        return;
      }
      const units = Array.from(firstPageContent.querySelectorAll<HTMLElement>("[data-nta-individual-closing-unit]"));
      const fitCount = units.filter((unit) => unit.getBoundingClientRect().bottom <= pageLimit(firstPage)).length;
      const signatureOnlyOverflows = units[units.length - 1]?.classList.contains("nta-signatory") && fitCount === units.length - 1;
      if (signatureOnlyOverflows && individualClosingCount === ntaIndividualClosingUnits.length && !individualSignatoryPulledBack) {
        setIndividualSignatoryPulledBack(true);
        return;
      }
      if (signatureOnlyOverflows && individualSignatoryPulledBack) {
        setIndividualClosingCount(Math.max(0, fitCount - 1));
        setIndividualClosingSaturated(true);
        setIndividualSignatoryPulledBack(false);
        return;
      }
      if (fitCount < units.length) {
        if (fitCount !== safeIndividualClosingCount) setIndividualClosingCount(fitCount);
        setIndividualClosingSaturated(true);
        if (individualSignatoryPulledBack) setIndividualSignatoryPulledBack(false);
        return;
      }
      if (safeIndividualClosingCount < ntaIndividualClosingUnits.length && !individualClosingSaturated) {
        const nextCount = safeIndividualClosingCount + 1;
        if (ntaIndividualClosingUnits.length - nextCount === 1 && ntaIndividualClosingUnits[nextCount] === "signatory") {
          setIndividualClosingSaturated(true);
          return;
        }
        setIndividualClosingCount(nextCount);
      }
      return;
    }
    if (record.mode !== "batch") return;
    const firstPageContent = pagesRef.current.querySelector<HTMLElement>(".nta-document-content.batch-overview");
    const firstPage = firstPageContent?.closest<HTMLElement>(".nta-document-page");
    if (!firstPage) return;
    const bottomLimit = pageLimit(firstPage);
    const rows = Array.from(firstPage.querySelectorAll<HTMLElement>(".nta-first-page-attendees tbody tr"));
    const rowsThatFit = rows.filter((row) => row.getBoundingClientRect().bottom <= bottomLimit).length;
    setMeasuredFirstPageRows(rowsThatFit);
    const copyContent = pagesRef.current.querySelector<HTMLElement>(".nta-document-content.nta-roster-copy-page");
    const copyPage = copyContent?.closest<HTMLElement>(".nta-document-page");
    if (copyContent && copyPage && !copyContent.classList.contains("batch-copy")) {
      const copyBottomLimit = pageLimit(copyPage);
      const fixedCopy = copyContent.querySelector<HTMLElement>(".nta-fixed-copy");
      const signatory = copyContent.querySelector<HTMLElement>(".nta-signatory");
      const requiredBottom = Math.max(fixedCopy?.getBoundingClientRect().bottom ?? 0, signatory?.getBoundingClientRect().bottom ?? 0);
      const shouldSeparateCopy = requiredBottom > copyBottomLimit;
      if (shouldSeparateCopy !== copyOnSeparatePage) setCopyOnSeparatePage(shouldSeparateCopy);
    }
    const continuationPages = Array.from(pagesRef.current.querySelectorAll<HTMLElement>(".nta-document-content.batch-attendees"));
    const nextSettings = [...rosterPageSettings];
    let settingsChanged = false;
    for (let pageIndex = 0; pageIndex < continuationPages.length; pageIndex += 1) {
      const content = continuationPages[pageIndex];
      const currentSetting = nextSettings[pageIndex] ?? { capacity: 10, saturated: false };
      const page = content.closest<HTMLElement>(".nta-document-page");
      if (!page) continue;
      const limit = pageLimit(page);
      const tableRows = Array.from(content.querySelectorAll<HTMLElement>("tbody tr"));
      const fitCount = tableRows.filter((row) => row.getBoundingClientRect().bottom <= limit).length;
      if (fitCount < tableRows.length) {
        const fittedCapacity = Math.max(1, fitCount);
        if (fittedCapacity !== currentSetting.capacity || !currentSetting.saturated) {
          nextSettings[pageIndex] = { capacity: fittedCapacity, saturated: true };
          for (let laterPage = pageIndex + 1; laterPage < nextSettings.length; laterPage += 1) {
            const laterSetting = nextSettings[laterPage] ?? { capacity: 10, saturated: false };
            nextSettings[laterPage] = { ...laterSetting, saturated: false };
          }
          settingsChanged = true;
          break;
        }
      } else if (pageIndex < continuationPages.length - 1 && tableRows.length === currentSetting.capacity && !currentSetting.saturated) {
        nextSettings[pageIndex] = { capacity: currentSetting.capacity + 1, saturated: false };
        for (let laterPage = pageIndex + 1; laterPage < nextSettings.length; laterPage += 1) {
          const laterSetting = nextSettings[laterPage] ?? { capacity: 10, saturated: false };
          nextSettings[laterPage] = { ...laterSetting, saturated: false };
        }
        settingsChanged = true;
        break;
      }
    }
    if (settingsChanged) setRosterPageSettings(nextSettings);
  }, [record, firstPageRows, rosterPageSettings, rosterPages.length, copyOnSeparatePage, individualClosingCount, individualClosingSaturated, individualSignatoryPulledBack, safeIndividualClosingCount]);
  async function downloadPdf() {
    if (!pagesRef.current) return;
    setDownloading(true); setError("");
    try {
      await Promise.all(Array.from(pagesRef.current.querySelectorAll("img")).map(async (img) => { if (!img.complete) await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("The notice letterhead could not be loaded.")); }); if (img.decode) await img.decode(); }));
      const pageElements = Array.from(pagesRef.current.querySelectorAll<HTMLElement>(".nta-document-page"));
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      for (let index = 0; index < pageElements.length; index += 1) {
        const canvas = await html2canvas(pageElements[index], { backgroundColor: "#fff", logging: false, scale: 3, useCORS: true });
        if (index) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/jpeg", .95), "JPEG", 0, 0, 210, 297);
      }
      pdf.save(`notice-to-attend-${record.mode}-${record.id}.pdf`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create the PDF."); }
    finally { setDownloading(false); }
  }
  return <div className="preview-backdrop nta-preview-backdrop"><div className="preview-toolbar"><span>NTA preview · {record.mode}</span><button className="ghost-button" onClick={onClose}>Close</button><button className="pdf-button" disabled={downloading} onClick={downloadPdf}>{downloading ? "Preparing PDF..." : "Download PDF"}</button>{error && <small className="download-error">{error}</small>}</div><div ref={pagesRef} className="nta-preview-pages">{record.mode === "individual" ? <><NtaPage record={record} page="individual" individualClosingUnits={individualFirstPageClosing} individualSignatoryPulledBack={individualSignatoryPulledBack} />{individualContinuationClosing.length > 0 && <NtaPage record={record} page="individual-continuation" individualClosingUnits={individualContinuationClosing} />}</> : <><NtaPage record={record} page="batch-overview" firstPageRows={firstPageRows} showFixedCopy={rosterPages.length === 0} hideFixedCopy={copyOnSeparatePage} />{rosterPages.map((sections, index) => <NtaPage key={`batch-attendees-${index}`} record={record} page="batch-attendees" rosterSections={sections} showFixedCopy={index === rosterPages.length - 1} hideFixedCopy={index === rosterPages.length - 1 && copyOnSeparatePage} />)}{copyOnSeparatePage && <NtaPage record={record} page="batch-copy" showFixedCopy />}</>}</div></div>;
}

export default function NtaModule({ user }: { user: User }) {
  const [records, setRecords] = useState<NtaRecord[]>([]);
  const [view, setView] = useState<"list" | "new">("list");
  const [preview, setPreview] = useState<NtaRecord | null>(null);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    if (!db) return;
    getDocs(query(collection(db, "ntaRecords"), where("ownerId", "==", user.uid))).then((snapshot) => {
      const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as NtaRecord));
      rows.sort((a, b) => ((b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0) - ((a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0));
      setRecords(rows);
    }).catch(() => setLoadError("Could not load Notices to Attend. Refresh and try again."));
  }, [user.uid]);
  return <>{loadError && <div className="error-message">{loadError}</div>}{view === "new" ? <NtaForm user={user} onSaved={(record) => { setRecords((current) => [record, ...current]); setView("list"); }} onCancel={() => setView("list")} /> : <NtaList records={records} onNew={() => setView("new")} onPreview={setPreview} />}{preview && <NtaPreview record={preview} onClose={() => setPreview(null)} />}</>;
}

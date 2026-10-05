"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import { loadPersonnel as loadAccountPersonnel, type PersonnelEntry } from "@/lib/personnel";
import { getDocumentNotificationReferences, makeDocumentNotification } from "@/lib/document-notifications";
import DeleteConfirmation from "./DeleteConfirmation";
import "./nta.css";

type NtaMode = "individual" | "batch";
type NtaAttendee = { name: string; position?: string; office: string; userId?: string; manual?: boolean };
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
  toUserId?: string;
  positionDesignation?: string;
  subject: string;
  activityTitle: string;
  organizer: string;
  signatoryName?: string;
  signatoryDesignation?: string;
  dateFrom?: string;
  dateTo?: string;
  venueType?: "physical" | "virtual";
  venue?: string;
  link?: string;
  batches?: NtaBatch[];
  recipientIds?: string[];
  createdAt?: unknown;
};

const asset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
const ntaSignatories = [
  { name: "ENGR. RICARDO P. OÑATE JR.", designation: "Regional Executive Director" },
  { name: "REBECCA R. ATEGA", designation: "RTD for Operations" },
] as const;
const legacySignatoryName = "MELODY M. GUIMARY";
const legacySignatoryDesignation = "Chief, Field Operations Division";
const formatDate = (date: string) => date ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(new Date(`${date}T12:00:00+08:00`)) : "";
const formatDateRange = (from: string, to: string) => from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
const initialBatch = (): NtaBatch => ({ number: "1", dateFrom: "", dateTo: "", timeFrom: "", timeTo: "", venueType: "physical", venue: "", link: "", attendees: [{ name: "", position: "", office: "", userId: "", manual: false }] });

function NtaForm({ user, onSaved, onCancel }: { user: User; onSaved: (record: NtaRecord) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<NtaMode>("individual");
  const [to, setTo] = useState("");
  const [toUserId, setToUserId] = useState("");
  const [positionDesignation, setPositionDesignation] = useState("");
  const [manualRecipient, setManualRecipient] = useState(false);
  const [subject, setSubject] = useState("");
  const [activityTitle, setActivityTitle] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [signatoryName, setSignatoryName] = useState("");
  const selectedSignatory = ntaSignatories.find((signatory) => signatory.name === signatoryName);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [venueType, setVenueType] = useState<"physical" | "virtual">("physical");
  const [venue, setVenue] = useState("");
  const [link, setLink] = useState("");
  const [batches, setBatches] = useState<NtaBatch[]>([initialBatch()]);
  const [personnel, setPersonnel] = useState<PersonnelEntry[]>([]);
  const [personnelStatus, setPersonnelStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadPersonnel() {
      try {
        const loadedPersonnel = await loadAccountPersonnel();
        if (!loadedPersonnel.length) throw new Error("No registered accounts have a name.");
        if (!cancelled) {
          setPersonnel(loadedPersonnel);
          setPersonnelStatus("ready");
        }
      } catch {
        if (!cancelled) setPersonnelStatus("error");
      }
    }
    void loadPersonnel();
    return () => { cancelled = true; };
  }, []);

  function updateBatch(index: number, update: Partial<NtaBatch>) {
    setBatches((current) => current.map((batch, itemIndex) => itemIndex === index ? { ...batch, ...update } : batch));
  }
  function updateAttendee(batchIndex: number, attendeeIndex: number, update: Partial<NtaAttendee>) {
    setBatches((current) => current.map((batch, index) => index === batchIndex ? { ...batch, attendees: batch.attendees.map((attendee, row) => row === attendeeIndex ? { ...attendee, ...update } : attendee) } : batch));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!db) { setError("Database is not configured."); return; }
    if (!selectedSignatory) { setError("Select a signatory."); return; }
    setBusy(true); setError("");
    const schedulesByRecipient = new Map<string, Array<{ dateFrom: string; dateTo: string; venue: string }>>();
    if (mode === "individual" && !manualRecipient && toUserId) schedulesByRecipient.set(toUserId, [{ dateFrom, dateTo, venue: venue.trim() }]);
    if (mode === "batch") batches.forEach((batch) => batch.attendees.forEach((attendee) => {
      if (!attendee.userId) return;
      schedulesByRecipient.set(attendee.userId, [...(schedulesByRecipient.get(attendee.userId) ?? []), { dateFrom: batch.dateFrom, dateTo: batch.dateTo, venue: batch.venue.trim() }]);
    }));
    const recipientIds = [...schedulesByRecipient.keys()].filter((id) => id !== user.uid);
    const common = { mode, subject: subject.trim(), activityTitle: activityTitle.trim(), organizer: organizer.trim(), signatoryName: selectedSignatory.name, signatoryDesignation: selectedSignatory.designation, recipientIds, ownerId: user.uid, createdAt: serverTimestamp() };
    try {
      const data = mode === "individual"
        ? { ...common, to: to.trim(), toUserId: manualRecipient ? "" : toUserId, positionDesignation: positionDesignation.trim(), dateFrom, dateTo, venueType, venue: venue.trim(), link: venueType === "virtual" ? link.trim() : "" }
        : { ...common, batches: batches.map((batch) => ({ ...batch, venue: batch.venue.trim(), link: batch.venueType === "virtual" ? batch.link.trim() : "", attendees: batch.attendees.map((attendee) => { const selectedPerson = attendee.manual ? undefined : personnel.find((person) => person.userId === attendee.userId); return { ...attendee, userId: attendee.manual ? "" : attendee.userId ?? "", name: attendee.manual ? attendee.name.trim() : selectedPerson?.name ?? attendee.name.trim(), position: attendee.manual ? attendee.position?.trim() ?? "" : selectedPerson?.position ?? attendee.position?.trim() ?? "", office: attendee.manual ? attendee.office.trim() : selectedPerson?.unit ?? attendee.office.trim() }; }) })) };
      const firestore = db;
      const recordRef = doc(collection(firestore, "ntaRecords"));
      const batch = writeBatch(firestore);
      batch.set(recordRef, data);
      recipientIds.forEach((recipientId) => {
        const schedules = schedulesByRecipient.get(recipientId) ?? [];
        const notification = makeDocumentNotification(firestore, { recipientId, ownerId: user.uid, documentId: recordRef.id, documentType: "Notice to Attend", activityTitle: data.activityTitle, schedules });
        batch.set(notification.reference, notification.data);
      });
      await batch.commit();
      onSaved({ id: recordRef.id, ...data, createdAt: undefined } as NtaRecord);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save Notice to Attend.");
    } finally { setBusy(false); }
  }

  return <section className="content-section form-section nta-form-section">
    <div className="section-heading"><div><p className="eyebrow">New record</p><h2>Create Notice to Attend</h2><p className="muted">Choose an individual notice or a group schedule.</p></div><button type="button" className="ghost-button" onClick={onCancel}>Cancel</button></div>
    {error && <p className="error-message nta-error">{error}</p>}
    <form className="permit-form" onSubmit={save}>
      <label className="wide-field">Notice type<select value={mode} onChange={(event) => setMode(event.target.value as NtaMode)}><option value="individual">Individual</option><option value="batch">Group</option></select></label>
      {mode === "individual" ? <>
        <div className="wide-field nta-recipient-fields"><div className="nta-recipient-field-grid">{manualRecipient ? <>
          <label>Personnel Name<input value={to} onChange={(event) => setTo(event.target.value)} required /></label>
          <label>Personnel Position<input value={positionDesignation} onChange={(event) => setPositionDesignation(event.target.value)} required /></label>
        </> : <label>Personnel Name<select value={toUserId} onChange={(event) => { const selectedId = event.target.value; const selectedPerson = personnel.find((person) => person.userId === selectedId); setToUserId(selectedId); setTo(selectedPerson?.name ?? ""); setPositionDesignation(selectedPerson?.position ?? ""); }} required disabled={personnelStatus !== "ready"}><option value="" disabled>{personnelStatus === "loading" ? "Loading personnel..." : personnelStatus === "error" ? "Personnel list unavailable" : "Select a personnel"}</option>{personnel.map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}</select>{personnelStatus === "error" && <span className="nta-personnel-error" role="alert">Unable to load personnel from user accounts. Use manual input or reload to try again.</span>}</label>}<label className="nta-manual-recipient-toggle"><input type="checkbox" aria-label="Enter personnel and position manually" checked={manualRecipient} onChange={(event) => { const enabled = event.target.checked; setManualRecipient(enabled); setToUserId(""); if (!enabled) { setTo(""); setPositionDesignation(""); } }} />Manual input</label></div></div>
        <label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} required /></label>
        <label>Title of Activity<input value={activityTitle} onChange={(event) => setActivityTitle(event.target.value)} required /></label>
        <label>Organizer / Host<input value={organizer} onChange={(event) => setOrganizer(event.target.value)} required /></label>
        <div className="date-range-field"><span>Date (From – To)</span><div><input aria-label="Date from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} required /><span>to</span><input aria-label="Date to" type="date" min={dateFrom} value={dateTo} onChange={(event) => setDateTo(event.target.value)} required /></div></div>
        <label>Venue type<select value={venueType} onChange={(event) => setVenueType(event.target.value as "physical" | "virtual")}><option value="physical">Physical venue</option><option value="virtual">Virtual platform</option></select></label>
        <label>{venueType === "virtual" ? "Platform name" : "Venue address"}<input value={venue} onChange={(event) => setVenue(event.target.value)} placeholder={venueType === "virtual" ? "Google Meet, Zoom, etc." : "Street, city, or building"} required /></label>
        {venueType === "virtual" && <label className="wide-field">Meeting link<input type="url" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://" required /></label>}
      </> : <>
        <label className="wide-field">Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} required /></label>
        <label>Title of Activity<input value={activityTitle} onChange={(event) => setActivityTitle(event.target.value)} required /></label>
        <label>Organizer / Host<input value={organizer} onChange={(event) => setOrganizer(event.target.value)} required /></label>
        <div className="wide-field nta-batches">{batches.map((batch, batchIndex) => <fieldset className="nta-batch-fieldset" key={batchIndex}><legend>Group {batch.number || batchIndex + 1}</legend>
          <div className="date-range-field"><span>Date (From – To)</span><div><input aria-label={`Group ${batchIndex + 1} date from`} type="date" value={batch.dateFrom} onChange={(event) => updateBatch(batchIndex, { dateFrom: event.target.value })} required /><span>to</span><input aria-label={`Group ${batchIndex + 1} date to`} type="date" min={batch.dateFrom} value={batch.dateTo} onChange={(event) => updateBatch(batchIndex, { dateTo: event.target.value })} required /></div></div>
          <div className="date-range-field"><span>Time</span><div><input aria-label={`Group ${batchIndex + 1} time from`} type="time" value={batch.timeFrom} onChange={(event) => updateBatch(batchIndex, { timeFrom: event.target.value })} required /><span>to</span><input aria-label={`Group ${batchIndex + 1} time to`} type="time" value={batch.timeTo} onChange={(event) => updateBatch(batchIndex, { timeTo: event.target.value })} required /></div></div>
          <label>Venue type<select value={batch.venueType} onChange={(event) => updateBatch(batchIndex, { venueType: event.target.value as "physical" | "virtual" })}><option value="physical">Physical venue</option><option value="virtual">Virtual meeting</option></select></label>
          <label>{batch.venueType === "virtual" ? "Platform" : "Place"}<input value={batch.venue} onChange={(event) => updateBatch(batchIndex, { venue: event.target.value })} required /></label>
          {batch.venueType === "virtual" && <label className="wide-field">Meeting link<input type="url" value={batch.link} onChange={(event) => updateBatch(batchIndex, { link: event.target.value })} placeholder="https://" required /></label>}
          <div className="nta-attendee-fields"><span>Personnel attending this group</span>{batch.attendees.map((attendee, attendeeIndex) => <div className={attendee.manual ? "nta-attendee-input nta-attendee-input-manual" : "nta-attendee-input nta-attendee-input-dropdown"} key={attendeeIndex}>{attendee.manual ? <div className="nta-attendee-manual-fields"><input aria-label={`Group ${batch.number} person ${attendeeIndex + 1} personnel name`} placeholder="Personnel Name" value={attendee.name} onChange={(event) => updateAttendee(batchIndex, attendeeIndex, { name: event.target.value })} required /><input aria-label={`Group ${batch.number} person ${attendeeIndex + 1} personnel position`} placeholder="Personnel Position" value={attendee.position ?? ""} onChange={(event) => updateAttendee(batchIndex, attendeeIndex, { position: event.target.value })} required /><input aria-label={`Group ${batch.number} person ${attendeeIndex + 1} personnel office`} placeholder="Personnel Office" value={attendee.office} onChange={(event) => updateAttendee(batchIndex, attendeeIndex, { office: event.target.value })} required /></div> : <><select aria-label={`Group ${batch.number} person ${attendeeIndex + 1} personnel name`} value={attendee.userId ?? ""} onChange={(event) => { const selectedId = event.target.value; const selected = personnel.find((person) => person.userId === selectedId); updateAttendee(batchIndex, attendeeIndex, { userId: selectedId, name: selected?.name ?? "", position: selected?.position ?? "", office: selected?.unit ?? "" }); }} required disabled={personnelStatus !== "ready"}><option value="" disabled>{personnelStatus === "loading" ? "Loading personnel..." : personnelStatus === "error" ? "Personnel list unavailable" : "Select a personnel"}</option>{personnel.map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}</select></>}<label className="nta-manual-attendee-toggle"><input type="checkbox" aria-label={`Enter group ${batch.number} personnel details manually`} checked={Boolean(attendee.manual)} onChange={(event) => { const enabled = event.target.checked; updateAttendee(batchIndex, attendeeIndex, enabled ? { manual: true, userId: "" } : { manual: false, userId: "", name: "", position: "", office: "" }); }} />Manual input</label>{batch.attendees.length > 1 && <button type="button" className="remove-participant" aria-label={`Delete attendee ${attendeeIndex + 1} from group ${batch.number}`} onClick={() => updateBatch(batchIndex, { attendees: batch.attendees.filter((_, index) => index !== attendeeIndex) })}>Delete</button>}</div>)}{personnelStatus === "error" && <span className="nta-personnel-error" role="alert">Unable to load personnel from user accounts. Use manual input or reload to try again.</span>}<button type="button" className="text-button add-item-text-button" onClick={() => updateBatch(batchIndex, { attendees: [...batch.attendees, { name: "", position: "", office: "", userId: "", manual: false }] })}>+ Add personnel</button></div>
          {batches.length > 1 && <button type="button" className="remove-participant nta-remove-batch" aria-label={`Delete group ${batch.number}`} onClick={() => setBatches((current) => current.filter((_, index) => index !== batchIndex))}>Delete</button>}
        </fieldset>)}<button type="button" className="text-button add-item-text-button" onClick={() => setBatches((current) => [...current, { ...initialBatch(), number: String(current.length + 1) }])}>+ Add group</button></div>
      </>}
      <label>Signatory Name<select value={signatoryName} onChange={(event) => setSignatoryName(event.target.value)} required><option value="" disabled>Select a signatory</option>{ntaSignatories.map((signatory) => <option key={signatory.name} value={signatory.name}>{signatory.name}</option>)}</select></label>
      <label>Signatory Designation<input value={selectedSignatory?.designation ?? ""} readOnly required /></label>
      <div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save"}</button></div>
    </form>
  </section>;
}

function NtaEditor({ record, userId, onCancel, onSaved, onRemove }: { record: NtaRecord; userId: string; onCancel: () => void; onSaved: (record: NtaRecord) => void; onRemove: () => void }) {
  const [to, setTo] = useState(record.to ?? "");
  const [toUserId, setToUserId] = useState(record.toUserId ?? record.recipientIds?.[0] ?? "");
  const [positionDesignation, setPositionDesignation] = useState(record.positionDesignation ?? "");
  const [manualRecipient, setManualRecipient] = useState(!(record.toUserId ?? record.recipientIds?.[0]));
  const [batches, setBatches] = useState<NtaBatch[]>(() => (record.batches ?? []).map((batch) => ({ ...batch, attendees: batch.attendees.map((attendee) => ({ ...attendee, manual: attendee.manual ?? !attendee.userId })) })));
  const [personnel, setPersonnel] = useState<PersonnelEntry[]>([]);
  const [personnelStatus, setPersonnelStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadPersonnel() {
      try {
        const entries = await loadAccountPersonnel();
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

  function updateAttendee(batchIndex: number, attendeeIndex: number, update: Partial<NtaAttendee>) {
    setBatches((current) => current.map((batch, index) => index === batchIndex ? { ...batch, attendees: batch.attendees.map((attendee, row) => row === attendeeIndex ? { ...attendee, ...update } : attendee) } : batch));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!db) { setError("Database is not configured."); return; }
    const cleanedBatches = batches.map((batch) => ({ ...batch, attendees: batch.attendees.map((attendee) => { const selected = attendee.manual ? undefined : personnel.find((person) => person.userId === attendee.userId); return { ...attendee, userId: attendee.manual ? "" : attendee.userId ?? "", name: attendee.manual ? attendee.name.trim() : selected?.name ?? attendee.name.trim(), position: attendee.manual ? attendee.position?.trim() ?? "" : selected?.position ?? attendee.position?.trim() ?? "", office: attendee.manual ? attendee.office.trim() : selected?.unit ?? attendee.office.trim() }; }) }));
    const selectedPerson = !manualRecipient ? personnel.find((person) => person.userId === toUserId) : undefined;
    const individualName = manualRecipient ? to.trim() : selectedPerson?.name ?? to.trim();
    const individualPosition = manualRecipient ? positionDesignation.trim() : selectedPerson?.position ?? positionDesignation.trim();
    if (record.mode === "individual" && (manualRecipient ? (!individualName || !individualPosition) : (!toUserId || !individualName))) { setError("Select a personnel or enter a personnel name and position."); return; }
    if (record.mode === "batch" && (!cleanedBatches.length || cleanedBatches.some((batch) => batch.attendees.length === 0 || batch.attendees.some((attendee) => !attendee.name || !attendee.office || (attendee.manual && !attendee.position))))) { setError("Each group needs a personnel name and office; manual entries also need a position."); return; }
    setBusy(true); setError("");
    try {
      const schedulesByRecipient = new Map<string, Array<{ dateFrom: string; dateTo: string; venue: string }>>();
      if (record.mode === "individual") {
        const recipientId = manualRecipient ? "" : toUserId;
        if (recipientId && recipientId !== userId) schedulesByRecipient.set(recipientId, [{ dateFrom: record.dateFrom ?? "", dateTo: record.dateTo ?? record.dateFrom ?? "", venue: record.venue ?? "" }]);
      } else {
        cleanedBatches.forEach((batch) => batch.attendees.forEach((attendee) => {
          if (!attendee.userId || attendee.userId === userId) return;
          schedulesByRecipient.set(attendee.userId, [...(schedulesByRecipient.get(attendee.userId) ?? []), { dateFrom: batch.dateFrom, dateTo: batch.dateTo, venue: batch.venue }]);
        }));
      }
      const recipientIds = [...schedulesByRecipient.keys()];
      const notificationDrafts = new Map<string, Parameters<typeof makeDocumentNotification>[1]>();
      schedulesByRecipient.forEach((schedules, recipientId) => {
        notificationDrafts.set(recipientId, { recipientId, ownerId: userId, documentId: record.id, documentType: "Notice to Attend", activityTitle: record.activityTitle, schedules });
      });
      const updates = record.mode === "individual"
        ? { to: individualName, toUserId: manualRecipient ? "" : toUserId, positionDesignation: individualPosition, recipientIds }
        : { batches: cleanedBatches, recipientIds };
      const firestore = db;
      const batch = writeBatch(firestore);
      batch.update(doc(firestore, "ntaRecords", record.id), updates);
      const existingNotifications = await getDocs(query(collection(firestore, "documentNotifications"), where("ownerId", "==", userId), where("documentId", "==", record.id)));
      const matchingRecipients = new Set<string>();
      existingNotifications.docs.forEach((notification) => {
        const data = notification.data();
        const recipientId = data.recipientId as string;
        const draft = notificationDrafts.get(recipientId);
        const sameSchedules = JSON.stringify(data.schedules ?? []) === JSON.stringify(draft?.schedules ?? []);
        const matchesDraft = Boolean(draft)
          && data.documentType === draft?.documentType
          && data.activityTitle === draft?.activityTitle
          && data.dateFrom === draft?.dateFrom
          && data.dateTo === draft?.dateTo
          && data.venue === draft?.venue
          && sameSchedules;
        if (draft && matchesDraft && !matchingRecipients.has(recipientId)) matchingRecipients.add(recipientId);
        else batch.delete(notification.ref);
      });
      notificationDrafts.forEach((draft, recipientId) => {
        if (matchingRecipients.has(recipientId)) return;
        const notification = makeDocumentNotification(firestore, draft);
        batch.set(notification.reference, notification.data);
      });
      await batch.commit();
      onSaved({ ...record, ...updates } as NtaRecord);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the Notice to Attend.");
    } finally { setBusy(false); }
  }

  return <section className="content-section form-section nta-form-section"><div className="section-heading"><div><p className="eyebrow">Edit record</p><h2>Edit {record.mode === "individual" ? "individual notice" : "group notice"}</h2><p className="muted">{record.mode === "individual" ? "Update the personnel name and position, or remove this notice." : "Update or remove personnel names, positions, and offices."}</p></div><button type="button" className="ghost-button" onClick={onCancel}>Cancel</button></div>{error && <p className="error-message nta-error">{error}</p>}<form className="permit-form" onSubmit={save}>{record.mode === "individual" ? <><div className="wide-field nta-recipient-fields"><div className="nta-recipient-field-grid">{manualRecipient ? <><label>Personnel Name<input value={to} onChange={(event) => setTo(event.target.value)} required /></label><label>Personnel Position<input value={positionDesignation} onChange={(event) => setPositionDesignation(event.target.value)} required /></label></> : <label>Personnel Name<select value={toUserId} onChange={(event) => { const selectedId = event.target.value; const selected = personnel.find((person) => person.userId === selectedId); setToUserId(selectedId); setTo(selected?.name ?? ""); setPositionDesignation(selected?.position ?? ""); }} required disabled={personnelStatus !== "ready"}><option value="" disabled>{personnelStatus === "loading" ? "Loading personnel..." : personnelStatus === "error" ? "Personnel list unavailable" : "Select a personnel"}</option>{personnel.map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}</select>{personnelStatus === "error" && <span className="nta-personnel-error" role="alert">Unable to load personnel from user accounts. Use manual input or reload to try again.</span>}</label>}<label className="nta-manual-recipient-toggle"><input type="checkbox" aria-label="Enter personnel and position manually" checked={manualRecipient} onChange={(event) => { const enabled = event.target.checked; setManualRecipient(enabled); setToUserId(""); if (!enabled) { setTo(""); setPositionDesignation(""); } }} />Manual input</label></div></div></> : <div className="wide-field nta-batches">{batches.map((batch, batchIndex) => <fieldset className="nta-batch-fieldset" key={batchIndex}><legend>Group {batch.number || batchIndex + 1}</legend><div className="nta-attendee-fields"><span>Personnel attending this group</span>{batch.attendees.map((attendee, attendeeIndex) => <div className={attendee.manual ? "nta-attendee-input nta-attendee-input-manual" : "nta-attendee-input nta-attendee-input-dropdown"} key={attendeeIndex}>{attendee.manual ? <div className="nta-attendee-manual-fields"><input aria-label={`Group ${batch.number} person ${attendeeIndex + 1} personnel name`} placeholder="Personnel Name" value={attendee.name} onChange={(event) => updateAttendee(batchIndex, attendeeIndex, { name: event.target.value })} required /><input aria-label={`Group ${batch.number} person ${attendeeIndex + 1} personnel position`} placeholder="Personnel Position" value={attendee.position ?? ""} onChange={(event) => updateAttendee(batchIndex, attendeeIndex, { position: event.target.value })} required /><input aria-label={`Group ${batch.number} person ${attendeeIndex + 1} personnel office`} placeholder="Personnel Office" value={attendee.office} onChange={(event) => updateAttendee(batchIndex, attendeeIndex, { office: event.target.value })} required /></div> : <><select aria-label={`Group ${batch.number} person ${attendeeIndex + 1} personnel name`} value={attendee.userId ?? ""} onChange={(event) => { const selectedId = event.target.value; const selected = personnel.find((person) => person.userId === selectedId); updateAttendee(batchIndex, attendeeIndex, { userId: selectedId, name: selected?.name ?? "", position: selected?.position ?? "", office: selected?.unit ?? "" }); }} required disabled={personnelStatus !== "ready"}><option value="" disabled>{personnelStatus === "loading" ? "Loading personnel..." : personnelStatus === "error" ? "Personnel list unavailable" : "Select a personnel"}</option>{personnel.map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}</select></>}<label className="nta-manual-attendee-toggle"><input type="checkbox" aria-label={`Enter group ${batch.number} personnel details manually`} checked={Boolean(attendee.manual)} onChange={(event) => { const enabled = event.target.checked; updateAttendee(batchIndex, attendeeIndex, enabled ? { manual: true, userId: "" } : { manual: false, userId: "", name: "", position: "", office: "" }); }} />Manual input</label>{batch.attendees.length > 1 && <button type="button" className="remove-participant remove-action" aria-label={`Remove personnel ${attendeeIndex + 1} from group ${batch.number}`} onClick={() => setBatches((current) => current.map((item, index) => index === batchIndex ? { ...item, attendees: item.attendees.filter((_, row) => row !== attendeeIndex) } : item))}>Remove</button>}</div>)}{personnelStatus === "error" && <span className="nta-personnel-error" role="alert">Unable to load personnel from user accounts. Use manual input or reload to try again.</span>}<button type="button" className="text-button add-item-text-button" onClick={() => updateBatch(batchIndex, { attendees: [...batch.attendees, { name: "", position: "", office: "", userId: "", manual: false }] })}>+ Add personnel</button></div></fieldset>)}</div>}<div className="form-actions nta-edit-actions">{record.mode === "individual" && <button type="button" className="remove-participant nta-remove-notice remove-action" onClick={onRemove}>Remove notice</button>}<button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save changes"}</button></div></form></section>;
}

function NtaList({ records, deletingId, onNew, onEdit, onPreview, onDelete }: { records: NtaRecord[]; deletingId: string | null; onNew: () => void; onEdit: (record: NtaRecord) => void; onPreview: (record: NtaRecord) => void; onDelete: (record: NtaRecord) => void }) {
  return <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Your records</p><h2>Notices to Attend</h2><p className="muted">{records.length} {records.length === 1 ? "notice" : "notices"} registered to your account.</p></div><button className="primary-button" onClick={onNew}>Add</button></div>{records.length === 0 ? <div className="empty-state"><span className="empty-number">00</span><h3>No notices to attend yet</h3><p>Create an individual or group notice.</p><button className="text-button plain-action document-create-action" onClick={onNew}>Add a Notice To Attend</button></div> : <div className="permit-table"><div className="table-head nta-list-head"><span>Type</span><span>Subject</span><span>Activity</span><span>Schedule</span><span></span></div>{records.map((record) => { const batchCount = record.batches?.length ?? 0; return <div className="table-row nta-list-row" key={record.id}><strong>{record.mode === "individual" ? "Individual" : "Group"}</strong><span>{record.subject}</span><span>{record.activityTitle}</span><span>{record.mode === "individual" ? formatDate(record.dateFrom ?? "") : `${batchCount} ${batchCount === 1 ? "Group" : "Groups"}`}</span><span className="nta-list-actions"><button type="button" className="row-action" onClick={() => onEdit(record)}>Edit</button><button type="button" className="row-action" onClick={() => onPreview(record)}>View</button><button type="button" className="delete-button" disabled={deletingId !== null} onClick={() => onDelete(record)}>{deletingId === record.id ? "Deleting..." : "Delete"}</button></span></div>; })}</div>}</section>;
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
  const signatoryName = record.signatoryName || legacySignatoryName;
  const signatoryDesignation = record.signatoryDesignation || legacySignatoryDesignation;
  return <article className="nta-document-page"><img className="nta-letterhead" src={asset("/Document-Header-Footer.jpg")} alt="" /><div className={`nta-document-content ${page}${showFixedCopy ? " nta-roster-copy-page" : ""}${hideFixedCopy ? " nta-roster-copy-hidden" : ""}`}>
    {(individual || batchOverview) && <header className="nta-doc-title"><h1>NOTICE TO ATTEND</h1><p>No. ____________________</p><p>Series of {new Date().getFullYear()}</p></header>}
    {page === "batch-copy" ? <NtaFixedCopy /> : page === "individual-continuation" ? <NtaIndividualClosing units={individualClosingUnits} signatoryName={signatoryName} signatoryDesignation={signatoryDesignation} continuation /> : individual ? <>
      <section className="nta-to-subject"><div className="nta-to-recipient"><p><b>TO</b><strong>:</strong><strong>{record.to?.toUpperCase()}</strong></p>{record.positionDesignation && <p className="nta-position-line"><span aria-hidden="true" /><span aria-hidden="true" /><span>{record.positionDesignation}</span></p>}</div><p><b>SUBJECT</b><strong>:</strong><strong>{record.subject.toUpperCase()}</strong></p></section>
      <hr className="nta-rule" /><p className="nta-directed">You are hereby directed to attend the activity with the following details:</p>
      <dl className="nta-details"><div><dt>Title of Activity</dt><b>:</b><dd>{record.activityTitle}</dd></div><div><dt>Organizer / Host</dt><b>:</b><dd>{record.organizer}</dd></div><div><dt>Date(s)</dt><b>:</b><dd>{formatDateRange(record.dateFrom ?? "", record.dateTo ?? "")}</dd></div><div><dt>Venue / Platform</dt><b>:</b><dd>{record.venue}</dd></div>{record.venueType === "virtual" && <div><dt>Link</dt><b>:</b><dd className="nta-link">{record.link}</dd></div>}</dl>
      <NtaIndividualClosing units={individualClosingUnits} signatoryName={signatoryName} signatoryDesignation={signatoryDesignation} signatoryPulledBack={individualSignatoryPulledBack} />
    </> : batchOverview ? <>
      <section className="nta-to-subject"><p><b>TO</b><strong>:</strong><strong>ALL CONCERNED PERSONNEL</strong></p><p className="nta-office-line"><span /> <strong>This Office</strong></p><p><b>SUBJECT</b><strong>:</strong><strong>{record.subject.toUpperCase()}</strong></p></section>
      <hr className="nta-rule" /><p className="nta-directed">You are hereby directed to attend the activity with the following details:</p>
      <dl className="nta-details nta-batch-overview">{[
        ["Title", <strong key="title">{record.activityTitle}</strong>],
        ["Organizer / Host", <strong key="organizer">{record.organizer}</strong>],
        ["Date", batches.map((batch) => <strong key={batch.number}>Group – {formatDateRange(batch.dateFrom, batch.dateTo)}</strong>)],
        ["Time", batches.map((batch) => <strong key={batch.number}>Group – {formatTime(batch.timeFrom)} – {formatTime(batch.timeTo)}</strong>)],
        ["Venue / Platform", batches.map((batch) => <strong key={batch.number}>Group – {batch.venue}{batch.venueType === "virtual" && batch.link ? ` (${batch.link})` : ""}</strong>)],
      ].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><b>:</b><dd>{value}</dd></div>)}</dl>
      <p className="nta-attendance-intro">The said concerned personnel are as follows:</p><div className="nta-batch-tables nta-first-page-attendees">{firstPageRows > 0 && batches.slice(0, 1).map((batch) => <NtaBatchTable batch={{ ...batch, attendees: batch.attendees.slice(0, firstPageRows) }} key={batch.number} />)}</div>
      {showFixedCopy && <NtaFixedCopy />}
    </> : <>
      <div className="nta-batch-tables">{rosterSections.map((section) => <NtaBatchTable batch={{ ...section.batch, attendees: section.attendees }} startIndex={section.startIndex} showCaption={!section.continued} key={`${section.batchIndex}-${section.startIndex}`} />)}</div>
      {showFixedCopy && <NtaFixedCopy />}
    </>}
    {(showFixedCopy && (page === "batch-overview" || page === "batch-attendees" || page === "batch-copy")) && <footer className="nta-signatory"><strong>{signatoryName}</strong><span>{signatoryDesignation === legacySignatoryDesignation ? <><i>Chief</i>, Field Operations Division</> : signatoryDesignation}</span></footer>}
  </div></article>;
}

function NtaIndividualClosing({ units, signatoryName, signatoryDesignation, signatoryPulledBack = false, continuation = false }: { units: NtaIndividualClosingUnit[]; signatoryName: string; signatoryDesignation: string; signatoryPulledBack?: boolean; continuation?: boolean }) {
  if (units.length === 0) return null;
  return <div className={`nta-individual-closing${continuation ? " nta-individual-closing-continuation" : ""}${signatoryPulledBack ? " nta-individual-closing-pulled" : ""}`}>
    {units.map((unit) => {
      if (unit === "signatory") return <footer className="nta-signatory nta-individual-closing-unit" data-nta-individual-closing-unit key={unit}><strong>{signatoryName}</strong><span>{signatoryDesignation === legacySignatoryDesignation ? <><i>Chief</i>, Field Operations Division</> : signatoryDesignation}</span></footer>;
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
  return <section className="nta-attendance-batch">{showCaption && <p className="nta-batch-caption">Group – {batch.venue}{batch.venueType === "virtual" && batch.link ? ` – ${batch.link}` : ""} ({formatDateRange(batch.dateFrom, batch.dateTo)} | {formatTime(batch.timeFrom)} – {formatTime(batch.timeTo)})</p>}<table><thead><tr><th>No.</th><th>Personnel</th><th>Office</th></tr></thead><tbody>{batch.attendees.map((attendee, index) => <tr key={`${attendee.name}-${index}`}><td>{startIndex + index + 1}</td><td><strong>{attendee.name}</strong>{attendee.position && <> - <em>{attendee.position}</em></>}</td><td>{attendee.office}</td></tr>)}</tbody></table></section>;
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
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");
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

  async function printPreview() {
    if (!pagesRef.current) return;
    setPrinting(true);
    setPrintError("");
    try {
      await Promise.all(Array.from(pagesRef.current.querySelectorAll("img")).map(async (image) => {
        if (!image.complete) await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("The notice letterhead could not be loaded."));
        });
        if (image.naturalWidth === 0) throw new Error("The notice letterhead could not be loaded.");
        if (image.decode) await image.decode();
      }));
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      window.print();
    } catch (cause) {
      setPrintError(cause instanceof Error ? cause.message : "Unable to prepare the NTA for printing.");
    } finally {
      setPrinting(false);
    }
  }

  return <div className="preview-backdrop nta-preview-backdrop"><div className="preview-toolbar"><span>NTA preview</span><button type="button" className="ghost-button" onClick={onClose}>Close</button><button type="button" className="pdf-button" disabled={downloading} onClick={downloadPdf}>{downloading ? "Preparing PDF..." : "Download PDF"}</button><button type="button" className="pdf-button" disabled={printing} onClick={printPreview}>{printing ? "Preparing print..." : "Print"}</button>{error && <small className="download-error">{error}</small>}{printError && <small className="download-error" role="alert">{printError}</small>}</div><div ref={pagesRef} className="nta-preview-pages">{record.mode === "individual" ? <><NtaPage record={record} page="individual" individualClosingUnits={individualFirstPageClosing} individualSignatoryPulledBack={individualSignatoryPulledBack} />{individualContinuationClosing.length > 0 && <NtaPage record={record} page="individual-continuation" individualClosingUnits={individualContinuationClosing} />}</> : <><NtaPage record={record} page="batch-overview" firstPageRows={firstPageRows} showFixedCopy={rosterPages.length === 0} hideFixedCopy={copyOnSeparatePage} />{rosterPages.map((sections, index) => <NtaPage key={`batch-attendees-${index}`} record={record} page="batch-attendees" rosterSections={sections} showFixedCopy={index === rosterPages.length - 1} hideFixedCopy={index === rosterPages.length - 1 && copyOnSeparatePage} />)}{copyOnSeparatePage && <NtaPage record={record} page="batch-copy" showFixedCopy />}</>}</div></div>;
}

export default function NtaModule({ user }: { user: User }) {
  const [records, setRecords] = useState<NtaRecord[]>([]);
  const [view, setView] = useState<"list" | "new">("list");
  const [editingRecord, setEditingRecord] = useState<NtaRecord | null>(null);
  const [preview, setPreview] = useState<NtaRecord | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<NtaRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  useEffect(() => {
    if (!db) return;
    getDocs(query(collection(db, "ntaRecords"), where("ownerId", "==", user.uid))).then((snapshot) => {
      const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as NtaRecord));
      rows.sort((a, b) => ((b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0) - ((a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0));
      setRecords(rows);
    }).catch(() => setLoadError("Could not load Notices to Attend. Refresh and try again."));
  }, [user.uid]);
  async function deleteRecord(record: NtaRecord) {
    if (!db) return;
    setDeletingId(record.id);
    setLoadError("");
    try {
      const firestore = db;
      const notificationReferences = await getDocumentNotificationReferences(firestore, user.uid, record.id);
      const batch = writeBatch(firestore);
      notificationReferences.forEach((reference) => batch.delete(reference));
      batch.delete(doc(firestore, "ntaRecords", record.id));
      await batch.commit();
      setRecords((current) => current.filter((item) => item.id !== record.id));
      setPreview((current) => current?.id === record.id ? null : current);
      setEditingRecord((current) => current?.id === record.id ? null : current);
      setPendingDelete(null);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setLoadError(code ? `Could not delete the NTA (${code}).` : "Could not delete the NTA.");
      setPendingDelete(null);
    } finally {
      setDeletingId(null);
    }
  }
  return <>{loadError && <div className="error-message">{loadError}</div>}{editingRecord ? <NtaEditor record={editingRecord} userId={user.uid} onCancel={() => setEditingRecord(null)} onSaved={(updatedRecord) => { setRecords((current) => current.map((item) => item.id === updatedRecord.id ? updatedRecord : item)); setEditingRecord(null); }} onRemove={() => { if (editingRecord) setPendingDelete(editingRecord); }} /> : view === "new" ? <NtaForm user={user} onSaved={(record) => { setRecords((current) => [record, ...current]); setView("list"); }} onCancel={() => setView("list")} /> : <NtaList records={records} deletingId={deletingId} onNew={() => setView("new")} onEdit={setEditingRecord} onPreview={setPreview} onDelete={setPendingDelete} />}{preview && <NtaPreview record={preview} onClose={() => setPreview(null)} />}<DeleteConfirmation open={Boolean(pendingDelete)} title="Confirm NTA Deletion?" description="Are you sure you want to delete this Notice to Attend? This action cannot be undone." busy={Boolean(pendingDelete && deletingId === pendingDelete.id)} onCancel={() => setPendingDelete(null)} onConfirm={() => { if (pendingDelete) void deleteRecord(pendingDelete); }} /></>;
}

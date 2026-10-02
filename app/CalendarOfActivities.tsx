"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { collection, deleteField, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch, type DocumentReference } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import DeleteConfirmation from "./DeleteConfirmation";
import "./calendar-activities-large.css";
import "./calendar-activities-mobile.css";

export type CalendarActivityReminder = {
  dateFrom: string;
  dateTo: string;
  activity: string;
  location: string;
};

export type CalendarActivityNotification = {
  id: string;
  recipientId: string;
  calendarId: string;
  unit: string;
  month: string;
  activities: CalendarActivityReminder[];
  read: boolean;
  createdAt?: unknown;
};

export type CalendarActivityApprovalNotification = {
  id: string;
  calendarId: string;
  ownerId: string;
  unit: string;
  month: string;
  preparedName: string;
  status: "Approved";
  readBy: string[];
  createdAt?: unknown;
};

type Unit = "AMIA" | "AGRISTAT" | "DRRM";
type CalendarStatus = "Pending" | "Approved";
type ResponsiblePerson = { userId: string; name: string };
type ActivityDraft = CalendarActivityReminder & { responsiblePeople: ResponsiblePerson[]; nextResponsibleId: string };
type CalendarActivityRow = CalendarActivityReminder & { responsiblePeople: ResponsiblePerson[] };
type CalendarOfActivities = {
  id: string;
  ownerId: string;
  unit: Unit;
  month: string;
  status?: CalendarStatus;
  activities: CalendarActivityRow[];
  preparedName: string;
  preparedPosition: string;
  createdAt?: unknown;
};
type Profile = { name: string; position: string; unit: Unit };
type Account = { id: string; name: string };

const unitLabel = (unit: Unit) => `FOD-${unit}`;
const calendarStatus = (calendar: CalendarOfActivities): CalendarStatus => calendar.status === "Approved" ? "Approved" : "Pending";
const unitDescription: Record<Unit, string> = {
  AMIA: "FOD - Adaptation Initiative and Mitigation in Agriculture",
  AGRISTAT: "FOD - Agricultural Statistics",
  DRRM: "FOD - Disaster Risk Reduction and Management",
};
const checkedRoleByUnit: Record<Unit, string> = {
  AGRISTAT: "Agricultural Statistics Focal Person",
  AMIA: "Regional AMIA Project Leader",
  DRRM: "Regional DRRM Alternate Focal Person",
};
const fixedCalendarSignatories = [
  { label: "Checked:", name: "GERLIE B. ANTIPASO", position: "DRRM Alternate Focal Person / Agriculturist II" },
  { label: "Noted:", name: "MELODY C. GUIMARY", position: "Chief, Field Operations Division" },
  { label: "Approved:", name: "REBECCA R. ATEGA", position: "RTD for Operations" },
];
const asset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
const emptyActivity = (): ActivityDraft => ({ dateFrom: "", dateTo: "", activity: "", location: "", responsiblePeople: [], nextResponsibleId: "" });
const pageSize = 6;
const maximumActivities = 100;

function formatDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function formatDateRange(from: string, to: string) {
  if (!from) return "";
  const endValue = to || from;
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${endValue}T00:00:00Z`);
  const formatMonthAndDay = (date: Date) => new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", timeZone: "UTC" }).format(date);
  const formatMonthOnly = (date: Date) => new Intl.DateTimeFormat("en-PH", { month: "long", timeZone: "UTC" }).format(date);
  if (from === endValue) return formatMonthAndDay(start);
  if (from.slice(0, 7) === endValue.slice(0, 7)) return `${formatMonthOnly(start)} ${start.getUTCDate()}-${end.getUTCDate()}`;
  return `${formatDate(from)} to ${formatDate(endValue)}`;
}

function formatMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  return new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

function monthDateBounds(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return null;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const prefix = `${match[1]}-${match[2]}`;
  return { first: `${prefix}-01`, last: `${prefix}-${String(lastDay).padStart(2, "0")}` };
}

function moveDateToMonth(value: string, month: string) {
  if (!value) return "";
  const bounds = monthDateBounds(month);
  if (!bounds) return "";
  const day = Number(value.slice(-2));
  if (!Number.isInteger(day) || day < 1) return "";
  const lastDay = Number(bounds.last.slice(-2));
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function timestampMillis(value: unknown) {
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") return value.toMillis() as number;
  if (value instanceof Date) return value.getTime();
  return 0;
}

function activityPages(activities: CalendarActivityRow[]) {
  const chronologicalActivities = [...activities].sort((first, second) => first.dateFrom.localeCompare(second.dateFrom) || first.dateTo.localeCompare(second.dateTo));
  const pages: CalendarActivityRow[][] = [];
  for (let index = 0; index < chronologicalActivities.length; index += pageSize) pages.push(chronologicalActivities.slice(index, index + pageSize));
  return pages;
}

function CalendarActivityPaper({ calendar, activities, pageNumber, pageCount }: { calendar: CalendarOfActivities; activities: CalendarActivityRow[]; pageNumber: number; pageCount: number }) {
  const isLastPage = pageNumber === pageCount;
  return <article className="calendar-activity-paper">
    <header className="calendar-paper-heading">
      <img src={asset("/da-caraga-logo.jpg")} alt="Department of Agriculture Caraga Region" />
      <div><p>Republic of the Philippines</p><strong>DEPARTMENT OF AGRICULTURE</strong><span>Caraga Region</span><small>Capitol Site, Butuan City 8600</small><small>Tel No. (085) 342-4092, Telefax No. (085) 341-2114</small></div>
    </header>
    <div className="calendar-paper-rule" />
    <div className="calendar-paper-title"><h1>CALENDAR OF ACTIVITIES</h1><p className="calendar-paper-unit">{unitDescription[calendar.unit]}</p><p className="calendar-paper-month">{formatMonth(calendar.month)}</p></div>
    <table className="calendar-paper-table"><thead><tr><th>Date</th><th>Activity</th><th>Location</th><th>Responsible Person</th></tr></thead><tbody>
      {activities.map((activity, index) => <tr key={`${activity.dateFrom}-${activity.activity}-${index}`}><td className="calendar-paper-date">{formatDateRange(activity.dateFrom, activity.dateTo)}</td><td>{activity.activity}</td><td>{activity.location}</td><td><div className="calendar-paper-responsible">{activity.responsiblePeople.map((person, personIndex) => <span key={person.userId}>{personIndex + 1}) {person.name}</span>)}</div></td></tr>)}
    </tbody></table>
    <footer className="calendar-paper-footer">
      {isLastPage && <>
        <div className="calendar-paper-signatory"><span>Prepared:</span><strong>{calendar.preparedName}</strong><em>{calendar.preparedPosition}</em></div>
        {fixedCalendarSignatories.map((signatory) => <div className="calendar-paper-signatory" key={signatory.label}><span>{signatory.label}</span><strong>{signatory.name}</strong><em>{signatory.label === "Checked:" ? `${checkedRoleByUnit[calendar.unit]} / Agriculturist II` : signatory.position}</em></div>)}
      </>}
    </footer>
  </article>;
}

function CalendarActivityPreview({ calendar, onClose }: { calendar: CalendarOfActivities; onClose: () => void }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");
  const pages = activityPages(calendar.activities);

  async function waitForImages() {
    if (!pagesRef.current) throw new Error("The Calendar of Activities preview is unavailable.");
    await Promise.all(Array.from(pagesRef.current.querySelectorAll("img")).map(async (image) => {
      if (!image.complete) await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("The DA Caraga logo could not be loaded."));
      });
      if (!image.naturalWidth) throw new Error("The DA Caraga logo could not be loaded.");
      if (image.decode) await image.decode();
    }));
    if (document.fonts?.ready) await document.fonts.ready;
  }

  async function downloadPdf() {
    setDownloading(true);
    setError("");
    try {
      await waitForImages();
      const paperPages = Array.from(pagesRef.current!.querySelectorAll<HTMLElement>(".calendar-activity-paper"));
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      for (let index = 0; index < paperPages.length; index += 1) {
        const canvas = await html2canvas(paperPages[index], { backgroundColor: "#fff", logging: false, scale: 3, useCORS: true });
        if (index) pdf.addPage("a4", "landscape");
        pdf.addImage(canvas.toDataURL("image/jpeg", .97), "JPEG", 0, 0, 297, 210);
      }
      pdf.save(`calendar-of-activities-${calendar.month}.pdf`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the Calendar of Activities PDF.");
    } finally { setDownloading(false); }
  }

  async function printDocument() {
    setPrinting(true);
    setError("");
    let printPageStyle: HTMLStyleElement | null = null;
    try {
      await waitForImages();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      printPageStyle = document.createElement("style");
      printPageStyle.textContent = "@media print{@page{size:A4 landscape;margin:0}}";
      document.head.appendChild(printPageStyle);
      window.print();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to prepare the Calendar of Activities for printing.");
    } finally {
      printPageStyle?.remove();
      setPrinting(false);
    }
  }

  return <div className="calendar-activity-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="preview-toolbar calendar-activity-preview-toolbar"><span>{formatMonth(calendar.month)} · {pages.length} {pages.length === 1 ? "page" : "pages"}</span><button type="button" className="ghost-button" onClick={onClose}>Close</button><button type="button" className="pdf-button" onClick={() => void downloadPdf()} disabled={downloading}>{downloading ? "Preparing PDF…" : "Download PDF"}</button><button type="button" className="pdf-button" onClick={() => void printDocument()} disabled={printing}>{printing ? "Preparing print…" : "Print"}</button>{error && <small role="alert">{error}</small>}</div>
    <div className="calendar-activity-preview-pages" ref={pagesRef}>{pages.map((activities, index) => <CalendarActivityPaper key={`${calendar.id}-${index}`} calendar={calendar} activities={activities} pageNumber={index + 1} pageCount={pages.length} />)}</div>
  </div>;
}

function CalendarActivityForm({ user, profile, accounts, calendar, onSaved, onCancel, onError }: { user: User; profile: Profile; accounts: Account[]; calendar?: CalendarOfActivities; onSaved: (calendar: CalendarOfActivities) => void; onCancel: () => void; onError: (message: string) => void }) {
  const [month, setMonth] = useState(() => calendar?.month ?? "");
  const [activities, setActivities] = useState<ActivityDraft[]>(() => calendar ? calendar.activities.map((activity) => ({ ...activity, responsiblePeople: activity.responsiblePeople.map((person) => ({ ...person })), nextResponsibleId: "" })) : [emptyActivity()]);
  const [saving, setSaving] = useState(false);
  const dateBounds = monthDateBounds(month);

  function updateMonth(nextMonth: string) {
    setMonth(nextMonth);
    setActivities((current) => current.map((activity) => {
      const dateFrom = moveDateToMonth(activity.dateFrom, nextMonth);
      let dateTo = moveDateToMonth(activity.dateTo, nextMonth);
      if (dateFrom && dateTo && dateTo < dateFrom) dateTo = dateFrom;
      return { ...activity, dateFrom, dateTo };
    }));
  }

  function updateActivity(index: number, update: Partial<ActivityDraft>) {
    setActivities((current) => current.map((activity, row) => row === index ? { ...activity, ...update } : activity));
  }

  function addResponsiblePerson(index: number) {
    const account = accounts.find((entry) => entry.id === activities[index].nextResponsibleId);
    if (!account || activities[index].responsiblePeople.some((entry) => entry.userId === account.id)) return;
    updateActivity(index, { responsiblePeople: [...activities[index].responsiblePeople, { userId: account.id, name: account.name }], nextResponsibleId: "" });
  }

  function removeResponsiblePerson(activityIndex: number, userId: string) {
    updateActivity(activityIndex, { responsiblePeople: activities[activityIndex].responsiblePeople.filter((person) => person.userId !== userId) });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const firestore = db;
    if (!firestore) { onError("Firebase is not configured."); return; }
    if (!month) { onError("Select the calendar month and year."); return; }
    if (activities.length > maximumActivities) { onError(`A calendar can contain up to ${maximumActivities} activities.`); return; }
    if (activities.some((activity) => !activity.dateFrom || !activity.dateTo || !activity.activity.trim() || !activity.location.trim() || !activity.responsiblePeople.length)) {
      onError("Complete every activity row and select at least one responsible person for each activity.");
      return;
    }
    if (activities.some((activity) => activity.dateTo < activity.dateFrom)) {
      onError("Each activity end date must be on or after its start date.");
      return;
    }
    if (!dateBounds || activities.some((activity) => activity.dateFrom < dateBounds.first || activity.dateFrom > dateBounds.last || activity.dateTo < dateBounds.first || activity.dateTo > dateBounds.last)) {
      onError("Each activity date must fall within the selected month and year.");
      return;
    }
    setSaving(true);
    onError("");
    const rows: CalendarActivityRow[] = activities.map(({ dateFrom, dateTo, activity, location, responsiblePeople }) => ({ dateFrom, dateTo, activity: activity.trim(), location: location.trim(), responsiblePeople }));
    const calendarData: Omit<CalendarOfActivities, "id"> = {
      ownerId: user.uid,
      unit: profile.unit,
      month,
      status: "Pending",
      activities: rows,
      preparedName: profile.name.trim(),
      preparedPosition: profile.position.trim(),
      createdAt: serverTimestamp(),
    };
    const activityByAccount = new Map<string, CalendarActivityReminder[]>();
    rows.forEach((row) => row.responsiblePeople.forEach((person) => {
      const notices = activityByAccount.get(person.userId) ?? [];
      notices.push({ dateFrom: row.dateFrom, dateTo: row.dateTo, activity: row.activity, location: row.location });
      activityByAccount.set(person.userId, notices);
    }));
    let createdCalendarRef: DocumentReference | null = null;
    let calendarUpdateCommitted = false;
    try {
      if (calendar) {
        const calendarRef = doc(firestore, "calendarOfActivities", calendar.id);
        const notificationSnapshot = await getDocs(query(collection(firestore, "calendarActivityNotifications"), where("calendarId", "==", calendar.id), where("ownerId", "==", user.uid)));
        const existingByRecipient = new Map<string, typeof notificationSnapshot.docs>();
        notificationSnapshot.docs.forEach((notification) => {
          const recipientId = String(notification.data().recipientId ?? "");
          if (!recipientId) return;
          existingByRecipient.set(recipientId, [...(existingByRecipient.get(recipientId) ?? []), notification]);
        });
        const notificationChanges: Array<{ kind: "update" | "delete" | "create"; reference: (typeof notificationSnapshot.docs)[number]["ref"]; data?: Record<string, unknown> }> = [];
        for (const [recipientId, notices] of activityByAccount) {
          const existing = existingByRecipient.get(recipientId) ?? [];
          if (existing.length) {
            notificationChanges.push({
              kind: "update",
              reference: existing[0].ref,
              data: { month, activities: notices, read: false, readAt: deleteField(), createdAt: serverTimestamp() },
            });
            existing.slice(1).forEach((notification) => notificationChanges.push({ kind: "delete", reference: notification.ref }));
            existingByRecipient.delete(recipientId);
          } else {
            notificationChanges.push({
              kind: "create",
              reference: doc(collection(firestore, "calendarActivityNotifications")),
              data: { recipientId, ownerId: user.uid, calendarId: calendar.id, unit: profile.unit, month, activities: notices, read: false, createdAt: serverTimestamp() },
            });
          }
        }
        existingByRecipient.forEach((notifications) => notifications.forEach((notification) => notificationChanges.push({ kind: "delete", reference: notification.ref })));

        for (let start = 0; start < notificationChanges.length; start += 17) {
          const batch = writeBatch(firestore);
          if (start === 0) batch.update(calendarRef, { activities: rows });
          notificationChanges.slice(start, start + 17).forEach((change) => {
            if (change.kind === "delete") batch.delete(change.reference);
            else if (change.kind === "update") batch.update(change.reference, change.data!);
            else batch.set(change.reference, change.data!);
          });
          await batch.commit();
          if (start === 0) calendarUpdateCommitted = true;
        }
        onSaved({ ...calendar, activities: rows });
      } else {
        const calendarRef = doc(collection(firestore, "calendarOfActivities"));
        createdCalendarRef = calendarRef;
        const calendarToSave = { ...calendarData, createdAt: serverTimestamp() };
        const notificationDocuments = [...activityByAccount].map(([recipientId, notices]) => ({
          reference: doc(collection(firestore, "calendarActivityNotifications")),
          data: { recipientId, ownerId: user.uid, calendarId: calendarRef.id, unit: profile.unit, month, activities: notices, read: false, createdAt: serverTimestamp() },
        }));
        for (let start = 0; start < notificationDocuments.length; start += 18) {
          const batch = writeBatch(firestore);
          if (start === 0) batch.set(calendarRef, calendarToSave);
          notificationDocuments.slice(start, start + 18).forEach((notification) => batch.set(notification.reference, notification.data));
          await batch.commit();
        }
        onSaved({ id: calendarRef.id, ...calendarData, activities: rows });
      }
    } catch (cause) {
      if (calendar) {
        const code = (cause as { code?: string }).code;
        if (calendarUpdateCommitted) onSaved({ ...calendar, activities: rows });
        onError(calendarUpdateCommitted
          ? `Activity details were saved, but some responsible-person notifications could not be updated${code ? ` (${code})` : ""}. Save again to retry the notifications.`
          : code ? `Could not update the Calendar of Activities (${code}).` : "Could not update the Calendar of Activities.");
        setSaving(false);
        return;
      }
      let cleanupSucceeded = false;
      try {
        if (!createdCalendarRef) throw new Error("The new calendar was not created.");
        const notificationSnapshot = await getDocs(query(collection(firestore, "calendarActivityNotifications"), where("calendarId", "==", createdCalendarRef.id), where("ownerId", "==", user.uid)));
        const references = notificationSnapshot.docs.map((notification) => notification.ref);
        if (references.length > 0) references.push(createdCalendarRef);
        for (let start = 0; start < references.length; start += 450) {
          const cleanupBatch = writeBatch(firestore);
          references.slice(start, start + 450).forEach((reference) => cleanupBatch.delete(reference));
          await cleanupBatch.commit();
        }
        cleanupSucceeded = true;
      } catch { /* Preserve the original save error if cleanup is unavailable. */ }
      const code = (cause as { code?: string }).code;
      const detail = code ? ` (${code})` : "";
      onError(cleanupSucceeded ? `Could not save the Calendar of Activities${detail}.` : `Could not save the Calendar of Activities${detail}. Refresh the page to check for a partially saved record.`);
    } finally { setSaving(false); }
  }

  return <section className="content-section form-section calendar-activity-form-section">
    <div className="section-heading"><div><p className="eyebrow">{calendar ? "Edit record" : "New record"}</p><h2>{calendar ? "Edit Calendar of Activities" : "Calendar of Activities"}</h2><p className="muted">{calendar ? "Update the date, activity, location, or responsible people for this calendar." : `Add one or more activities for ${unitLabel(profile.unit)}. Selected colleagues receive an in-app notification with each activity’s dates, activity, and location.`}</p></div><button type="button" className="ghost-button" onClick={onCancel}>Cancel</button></div>
    <form className="permit-form travel-order-form calendar-activity-form" onSubmit={save}>
      <div className="calendar-activity-meta wide-field"><label>Unit<input value={unitLabel(calendar?.unit ?? profile.unit)} readOnly /></label><label>Month and Year<input type="month" value={month} onChange={(event) => updateMonth(event.target.value)} disabled={Boolean(calendar)} required /></label></div>
      <div className="calendar-activity-rows wide-field"><div className="calendar-activity-rows-heading"><strong>Activities</strong><span>Set one responsible person or add several for each row.</span></div>
        {activities.map((activity, index) => <fieldset className="calendar-activity-row" key={index}>
          <legend>Activity {index + 1}</legend>
          <div className="calendar-activity-dates"><label>Date From<input type="date" min={dateBounds?.first} max={dateBounds?.last} value={activity.dateFrom} disabled={!dateBounds} onChange={(event) => {
            const value = event.target.value;
            if (dateBounds && value && (value < dateBounds.first || value > dateBounds.last)) return;
            updateActivity(index, { dateFrom: value, dateTo: activity.dateTo && value > activity.dateTo ? value : activity.dateTo });
          }} required /></label><label>Date To<input type="date" min={activity.dateFrom || dateBounds?.first} max={dateBounds?.last} value={activity.dateTo} disabled={!dateBounds} onChange={(event) => {
            const value = event.target.value;
            if (dateBounds && value && (value < dateBounds.first || value > dateBounds.last)) return;
            updateActivity(index, { dateTo: value });
          }} required /></label></div>
          <label className="calendar-activity-entry">Activity<textarea rows={1} maxLength={400} value={activity.activity} onChange={(event) => updateActivity(index, { activity: event.target.value })} required /></label>
          <label className="calendar-activity-entry calendar-activity-location">Location<input maxLength={180} value={activity.location} onChange={(event) => updateActivity(index, { location: event.target.value })} required /></label>
          <div className="calendar-responsible-field"><span className="calendar-responsible-label">Responsible Person</span><div className="calendar-responsible-add"><select aria-label={`Choose responsible person for activity ${index + 1}`} value={activity.nextResponsibleId} onChange={(event) => updateActivity(index, { nextResponsibleId: event.target.value })} disabled={!accounts.length}><option value="">{accounts.length ? "Select a person" : "No other accounts listed under this unit"}</option>{accounts.filter((account) => !activity.responsiblePeople.some((person) => person.userId === account.id)).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><button type="button" className="ghost-button" onClick={() => addResponsiblePerson(index)} disabled={!activity.nextResponsibleId}>Add person</button></div>
            {activity.responsiblePeople.length > 0 && <ul className="calendar-responsible-list">{activity.responsiblePeople.map((person) => <li key={person.userId}><span>{person.name}</span><button type="button" aria-label={`Remove ${person.name}`} onClick={() => removeResponsiblePerson(index, person.userId)}>Remove</button></li>)}</ul>}
          </div>
          {activities.length > 1 && <button type="button" className="remove-participant" onClick={() => setActivities((current) => current.filter((_, row) => row !== index))}>Remove activity</button>}
        </fieldset>)}
        <button type="button" className="text-button" disabled={activities.length >= maximumActivities} onClick={() => setActivities((current) => current.length < maximumActivities ? [...current, emptyActivity()] : current)}>+ Add another activity</button>
        {activities.length >= maximumActivities && <small className="calendar-activity-limit-note">A calendar can contain up to {maximumActivities} activities.</small>}
      </div>
      <div className="calendar-activity-prepared-summary wide-field"><span>Prepared by</span><strong>{calendar?.preparedName ?? profile.name}</strong><em>{calendar?.preparedPosition ?? (profile.position || "Position not set in Profile")}</em></div>
      <div className="form-actions"><button className="primary-button" disabled={saving}>{saving ? "Saving…" : calendar ? "Save changes" : "Save"}</button></div>
    </form>
  </section>;
}

function CalendarOfActivitiesList({ calendars, onNew, onEdit, onView, onDelete, onStatusChange, deletingId, updatingStatusId, adminRecordsOnly = false }: { calendars: CalendarOfActivities[]; onNew: () => void; onEdit: (calendar: CalendarOfActivities) => void; onView: (calendar: CalendarOfActivities) => void; onDelete: (calendar: CalendarOfActivities) => void; onStatusChange: (calendar: CalendarOfActivities, status: CalendarStatus) => void; deletingId: string | null; updatingStatusId: string | null; adminRecordsOnly?: boolean }) {
  return <section className="content-section calendar-activity-list-section">
    <div className="section-heading"><div><p className="eyebrow">{adminRecordsOnly ? "Approved records" : "Your records"}</p><h2>{adminRecordsOnly ? "Calendar of Activities Records" : "Calendar of Activities"}</h2><p className="muted">{adminRecordsOnly ? `${calendars.length} approved ${calendars.length === 1 ? "calendar" : "calendars"}.` : `${calendars.length} ${calendars.length === 1 ? "calendar" : "calendars"} registered to your account.`}</p></div>{!adminRecordsOnly && <button type="button" className="primary-button" onClick={onNew}>Add</button>}</div>
    {calendars.length === 0 ? <div className="empty-state"><span className="empty-number">00</span><h3>{adminRecordsOnly ? "No approved Calendars of Activities yet" : "No Calendars of Activities yet"}</h3>{!adminRecordsOnly && <><p>Create a monthly activity calendar and notify responsible colleagues in your unit.</p><button className="text-button" onClick={onNew}>Add a Calendar of Activities</button></>}</div> : <div className="permit-table calendar-activity-list">
      <div className="table-head calendar-activity-list-head"><span>Month and Year</span><span>Unit</span><span>Activities</span><span>Prepared by</span><span>Status</span></div>
      {calendars.map((calendar) => {
        const status = calendarStatus(calendar);
        return <div className="table-row calendar-activity-list-row" key={calendar.id}>
          <strong>{formatMonth(calendar.month)}</strong>
          <span className="calendar-list-unit">{unitLabel(calendar.unit)}</span>
          <span className="calendar-list-count">{calendar.activities.length}</span>
          <span className="calendar-list-prepared">{calendar.preparedName}</span>
          {adminRecordsOnly ? <span className="travel-order-status calendar-list-status"><span className="sr-only">Status</span><strong className="calendar-status-badge is-approved">Approved</strong></span> : <label className={`travel-order-status travel-order-status-${status.toLowerCase()} calendar-list-status`}><span className="sr-only">Status</span><select aria-label={`Status for ${unitLabel(calendar.unit)}, ${formatMonth(calendar.month)}`} value={status} disabled={updatingStatusId !== null || deletingId !== null} onChange={(event) => onStatusChange(calendar, event.target.value as CalendarStatus)}><option value="Pending">Pending</option><option value="Approved">Approved</option></select></label>}
          <span className="travel-order-row-actions calendar-activity-row-actions">{adminRecordsOnly ? <button type="button" className="row-action" onClick={() => onView(calendar)}>View</button> : <><button type="button" className="row-action" disabled={updatingStatusId !== null || deletingId !== null} onClick={() => onEdit(calendar)}>Edit</button><button type="button" className="row-action" disabled={deletingId !== null} onClick={() => onView(calendar)}>View</button><button type="button" className="delete-button" disabled={updatingStatusId !== null || deletingId !== null} onClick={() => onDelete(calendar)}>{deletingId === calendar.id ? "Deleting…" : "Delete"}</button></>}</span>
        </div>;
      })}
    </div>}
  </section>;
}

export default function CalendarOfActivitiesModule({ user, mode = "prepared" }: { user: User; mode?: "prepared" | "approved-records" }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [calendars, setCalendars] = useState<CalendarOfActivities[]>([]);
  const [view, setView] = useState<"list" | "new" | "edit">("list");
  const [editingCalendar, setEditingCalendar] = useState<CalendarOfActivities | null>(null);
  const [preview, setPreview] = useState<CalendarOfActivities | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CalendarOfActivities | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const firestore = db;
      if (!firestore) { setError("Firebase is not configured."); setLoading(false); return; }
      setLoading(true);
      setError("");
      try {
        if (mode === "approved-records") {
          const calendarsSnapshot = await getDocs(query(collection(firestore, "calendarOfActivities"), where("status", "==", "Approved")));
          const rows = calendarsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as CalendarOfActivities));
          rows.sort((first, second) => second.month.localeCompare(first.month) || timestampMillis(second.createdAt) - timestampMillis(first.createdAt));
          if (!cancelled) setCalendars(rows);
          return;
        }
        const [profileSnapshot, calendarsSnapshot] = await Promise.all([
          getDoc(doc(firestore, "users", user.uid)),
          getDocs(query(collection(firestore, "calendarOfActivities"), where("ownerId", "==", user.uid))),
        ]);
        if (!profileSnapshot.exists()) throw new Error("Complete your name, position, and unit in Profile before creating a calendar.");
        const profileData = profileSnapshot.data();
        if (typeof profileData.name !== "string" || !profileData.name.trim() || typeof profileData.position !== "string" || !profileData.position.trim() || !["AMIA", "AGRISTAT", "DRRM"].includes(profileData.unit)) throw new Error("Complete your name, position, and unit in Profile before creating a calendar.");
        const loadedProfile: Profile = { name: profileData.name, position: profileData.position, unit: profileData.unit as Unit };
        const accountSnapshot = await getDocs(query(collection(firestore, "users"), where("unit", "==", loadedProfile.unit)));
        const colleagues = accountSnapshot.docs.filter((item) => item.id !== user.uid).map((item) => ({ id: item.id, name: String(item.data().name ?? "") })).filter((account) => account.name).sort((first, second) => first.name.localeCompare(second.name, "en", { sensitivity: "base" }));
        const rows = calendarsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as CalendarOfActivities));
        rows.sort((first, second) => timestampMillis(second.createdAt) - timestampMillis(first.createdAt));
        if (!cancelled) { setProfile(loadedProfile); setAccounts(colleagues); setCalendars(rows); }
      } catch (cause) {
        if (!cancelled) {
          const code = (cause as { code?: string }).code;
          setError(cause instanceof Error && !code ? cause.message : code ? `Could not load Calendars of Activities (${code}).` : "Could not load Calendars of Activities.");
        }
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [user.uid, mode]);

  async function updateCalendarStatus(calendar: CalendarOfActivities, status: CalendarStatus) {
    if (!db || updatingStatusId || calendarStatus(calendar) === status) return;
    setUpdatingStatusId(calendar.id);
    setError("");
    try {
      const firestore = db;
      const calendarRef = doc(firestore, "calendarOfActivities", calendar.id);
      const batch = writeBatch(firestore);
      batch.update(calendarRef, { status });
      if (status === "Approved") {
        const notificationRef = doc(collection(firestore, "calendarActivityApprovalNotifications"));
        batch.set(notificationRef, {
          calendarId: calendar.id,
          ownerId: user.uid,
          unit: calendar.unit,
          month: calendar.month,
          preparedName: calendar.preparedName,
          status,
          readBy: [],
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
      setCalendars((current) => current.map((item) => item.id === calendar.id ? { ...item, status } : item));
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code ? `Could not update the Calendar of Activities status (${code}).` : "Could not update the Calendar of Activities status.");
    } finally { setUpdatingStatusId(null); }
  }

  async function deleteCalendar(calendar: CalendarOfActivities) {
    const firestore = db;
    if (!firestore) return;
    setDeletingId(calendar.id);
    setError("");
    try {
      const notificationSnapshot = await getDocs(query(collection(firestore, "calendarActivityNotifications"), where("calendarId", "==", calendar.id), where("ownerId", "==", user.uid)));
      const batch = writeBatch(firestore);
      notificationSnapshot.docs.forEach((notification) => batch.delete(notification.ref));
      batch.delete(doc(firestore, "calendarOfActivities", calendar.id));
      await batch.commit();
      setCalendars((current) => current.filter((item) => item.id !== calendar.id));
      setPreview((current) => current?.id === calendar.id ? null : current);
      setPendingDelete(null);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code ? `Could not delete the Calendar of Activities (${code}).` : "Could not delete the Calendar of Activities.");
      setPendingDelete(null);
    } finally { setDeletingId(null); }
  }

  return <>
    {error && <div className="error-message calendar-activity-error" role="alert">{error}</div>}
    {loading ? <section className="content-section"><p className="muted">Loading Calendars of Activities…</p></section> : mode === "prepared" && !profile ? <section className="content-section calendar-activity-profile-notice"><h2>Profile details needed</h2><p>Add your name, position, and unit in Profile before preparing a Calendar of Activities.</p></section> : mode === "prepared" && (view === "new" || (view === "edit" && editingCalendar)) ? <CalendarActivityForm key={view === "edit" ? editingCalendar!.id : "new"} user={user} profile={profile!} accounts={accounts} calendar={view === "edit" ? editingCalendar! : undefined} onSaved={(calendar) => { if (view === "edit") setCalendars((current) => current.map((item) => item.id === calendar.id ? calendar : item)); else setCalendars((current) => [calendar, ...current]); setEditingCalendar(null); setView("list"); }} onCancel={() => { setEditingCalendar(null); setView("list"); }} onError={setError} /> : <CalendarOfActivitiesList calendars={calendars} onNew={() => { setError(""); setEditingCalendar(null); setView("new"); }} onEdit={(calendar) => { setError(""); setEditingCalendar(calendar); setView("edit"); }} onView={setPreview} onDelete={setPendingDelete} onStatusChange={(calendar, status) => void updateCalendarStatus(calendar, status)} deletingId={deletingId} updatingStatusId={updatingStatusId} adminRecordsOnly={mode === "approved-records"} />}
    <DeleteConfirmation open={Boolean(pendingDelete)} title="Confirm Calendar Deletion?" description="Are you sure you want to delete this Calendar of Activities? This action cannot be undone, and its activity notifications will also be removed." busy={Boolean(pendingDelete && deletingId === pendingDelete.id)} onCancel={() => setPendingDelete(null)} onConfirm={() => { if (pendingDelete) void deleteCalendar(pendingDelete); }} />
    {preview && <CalendarActivityPreview calendar={preview} onClose={() => setPreview(null)} />}
  </>;
}

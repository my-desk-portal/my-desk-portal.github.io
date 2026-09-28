"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type Ref } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import type { User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import "./myar.css";

type Unit = "AMIA" | "AGRISTAT" | "DRRM";
type Profile = { name: string; position: string; unit: Unit };
type Report = {
  id: string;
  ownerId: string;
  month: string;
  cycle: 1 | 2;
  startDay: number;
  endDay: number;
  activities: string[];
  unit: Unit;
  preparedName: string;
  preparedPosition: string;
  createdAt?: unknown;
};

const MAX_ACTIVITIES = 30;
const asset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

function lastDayOfMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return year && monthNumber ? new Date(year, monthNumber, 0).getDate() : 31;
}

function monthName(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return year && monthNumber
    ? new Intl.DateTimeFormat("en-PH", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, monthNumber - 1, 1)))
    : "";
}

function reportPeriod(report: Pick<Report, "month" | "startDay" | "endDay">) {
  const [year] = report.month.split("-");
  return `${monthName(report.month)} ${report.startDay}-${report.endDay}, ${year}`;
}

function reportMonth(month: string) {
  return `${monthName(month)} ${month.split("-")[0]}`;
}

function reportUnit(unit: Unit) {
  const unitNames: Record<Unit, string> = {
    AMIA: "Adaptation and Mitigation Initiative in Agriculture - Caraga",
    AGRISTAT: "Agricultural Statistics - Caraga",
    DRRM: "Disaster Risk Reduction and Management",
  };
  return unitNames[unit];
}

function createdTime(value: unknown) {
  return value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function"
    ? value.toMillis() as number
    : 0;
}

function AccomplishmentReportDocument({ report, pageRef }: { report: Report; pageRef?: Ref<HTMLElement> }) {
  const estimatedActivityLines = report.activities.reduce((total, activity) => total + activity.split(/\r?\n/).reduce((lineTotal, line) => lineTotal + Math.max(1, Math.ceil(line.length / 90)), 0), 0);
  const activityDensity = Math.min(1, Math.max(0, (estimatedActivityLines - 5) / 25));
  const documentStyle = {
    "--ar-unit-top": `${5.1 - activityDensity * 3.4}cqi`,
    "--ar-activity-top": `${3.3 - activityDensity * 2.5}cqi`,
  } as CSSProperties;
  return <article ref={pageRef} className="ar-document">
    <img className="ar-document-letterhead" src={asset("/Document-Header-Footer.jpg")} alt="" />
    <div className="ar-document-content" style={documentStyle}>
      <header className="ar-document-heading"><h1>ACCOMPLISHMENT REPORT</h1><p>{reportPeriod(report)}</p></header>
      <p className="ar-document-unit">{reportUnit(report.unit)}</p>
      <ol className="ar-document-activities">{report.activities.map((activity, index) => <li key={`${index}-${activity}`}>{activity}</li>)}</ol>
      <section className="ar-document-prepared"><p>Prepared:</p><div><strong>{report.preparedName.toLocaleUpperCase("en-PH")}</strong><em>{report.preparedPosition}</em></div></section>
      <section className="ar-document-noted"><p>Noted:</p><div><strong>MELODY M. GUIMARY</strong><span><em>Chief,</em> Field Operations Division</span></div></section>
    </div>
  </article>;
}

function AccomplishmentReportPreview({ report, onClose }: { report: Report; onClose: () => void }) {
  const pageRef = useRef<HTMLElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  async function downloadPdf() {
    const page = pageRef.current;
    if (!page) return;
    setDownloading(true);
    setDownloadError("");
    try {
      await Promise.all(Array.from(page.querySelectorAll("img")).map(async (image) => {
        if (!image.complete) await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("The accomplishment report letterhead could not be loaded."));
        });
        if (image.naturalWidth === 0) throw new Error("The accomplishment report letterhead could not be loaded.");
        if (image.decode) await image.decode();
      }));
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const canvas = await html2canvas(page, { backgroundColor: "#fff", logging: false, scale: 3, useCORS: true });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.96), "JPEG", 0, 0, 210, 297);
      pdf.save(`myar-${report.month}-${report.startDay}-${report.endDay}.pdf`);
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : "Unable to create the accomplishment report PDF.");
    } finally {
      setDownloading(false);
    }
  }

  return <div className="ar-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="ar-preview-window" role="dialog" aria-modal="true" aria-label="Accomplishment report preview">
      <div className="ar-preview-actions">
        <button type="button" className="ghost-button" onClick={onClose}>Close</button>
        <button type="button" className="pdf-button" disabled={downloading} onClick={downloadPdf}>{downloading ? "Preparing PDF..." : "Download PDF"}</button>
        <button type="button" className="pdf-button" onClick={() => window.print()}>Print</button>
        {downloadError && <small className="download-error" role="alert">{downloadError}</small>}
      </div>
      <AccomplishmentReportDocument report={report} pageRef={pageRef} />
    </div>
  </div>;
}

export default function AccomplishmentReportModule({ user }: { user: User }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [month, setMonth] = useState(currentMonth);
  const [cycle, setCycle] = useState<1 | 2>(1);
  const [activities, setActivities] = useState([""]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [editingReport, setEditingReport] = useState<Report | null>(null);
  const lastDay = lastDayOfMonth(month);
  const startDay = cycle === 1 ? 1 : 16;
  const endDay = cycle === 1 ? 15 : lastDay;
  const preparedProfile = editingReport ? {
    name: editingReport.preparedName,
    position: editingReport.preparedPosition,
    unit: editingReport.unit,
  } : profile;
  const duplicateReport = !editingReport && reports.some((report) => report.month === month && report.cycle === cycle);

  function startNewReport() {
    setEditingReport(null);
    setMonth(currentMonth());
    setCycle(1);
    setActivities([""]);
    setMessage(null);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function editActivities(report: Report) {
    setEditingReport(report);
    setMonth(report.month);
    setCycle(report.cycle);
    setActivities([...report.activities]);
    setMessage(null);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingReport(null);
    setMonth(currentMonth());
    setCycle(1);
    setActivities([""]);
    setMessage(null);
    setShowForm(false);
  }

  function previewEditedReport() {
    if (!editingReport) return;
    const updatedActivities = activities.map((activity) => activity.trim()).filter(Boolean);
    if (updatedActivities.length === 0) {
      setMessage({ kind: "error", text: "Add at least one activity before previewing the report." });
      return;
    }
    setSelectedReport({ ...editingReport, activities: updatedActivities });
  }

  useEffect(() => {
    let current = true;
    async function load() {
      if (!db) {
        setMessage({ kind: "error", text: "Database is not configured." });
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [profileSnapshot, reportSnapshot] = await Promise.all([
          getDoc(doc(db, "users", user.uid)),
          getDocs(query(collection(db, "accomplishmentReports"), where("ownerId", "==", user.uid))),
        ]);
        if (!current) return;
        if (profileSnapshot.exists()) {
          const data = profileSnapshot.data();
          if (typeof data.name === "string" && typeof data.position === "string" && ["AMIA", "AGRISTAT", "DRRM"].includes(data.unit)) {
            setProfile({ name: data.name, position: data.position, unit: data.unit as Unit });
          }
        }
        const ownReports = reportSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() } as Report));
        ownReports.sort((left, right) => right.month.localeCompare(left.month) || right.cycle - left.cycle || createdTime(right.createdAt) - createdTime(left.createdAt));
        setReports(ownReports);
      } catch (cause) {
        if (current) setMessage({ kind: "error", text: cause instanceof Error ? `Could not load your reports. ${cause.message}` : "Could not load your reports. Try again." });
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => { current = false; };
  }, [user.uid]);

  async function saveReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!db) {
      setMessage({ kind: "error", text: "Database is not configured." });
      return;
    }
    if (!editingReport && reports.some((report) => report.month === month && report.cycle === cycle)) {
      setMessage({ kind: "error", text: `A report for ${reportPeriod({ month, startDay, endDay })} is already saved. Edit the existing report instead.` });
      return;
    }
    if (!preparedProfile?.name.trim() || !preparedProfile.position.trim() || !preparedProfile.unit) {
      setMessage({ kind: "error", text: "Complete your name, position, and unit in Profile before creating a report." });
      return;
    }
    const cleanActivities = activities.map((activity) => activity.trim());
    if (cleanActivities.length === 0 || cleanActivities.length > MAX_ACTIVITIES || cleanActivities.some((activity) => !activity)) {
      setMessage({ kind: "error", text: `Enter at least one activity. Each activity is required, up to ${MAX_ACTIVITIES}.` });
      return;
    }
    setSaving(true);
    try {
      if (editingReport) {
        await updateDoc(doc(db, "accomplishmentReports", editingReport.id), { activities: cleanActivities });
        setReports((current) => current.map((report) => report.id === editingReport.id ? { ...report, activities: cleanActivities } : report));
        setEditingReport(null);
        setActivities([""]);
        setShowForm(false);
        setMessage({ kind: "success", text: "Report activities updated." });
        return;
      }
      const data = {
        ownerId: user.uid,
        month,
        cycle,
        startDay,
        endDay,
        activities: cleanActivities,
        unit: preparedProfile.unit,
        preparedName: preparedProfile.name.trim().replace(/\s+/g, " "),
        preparedPosition: preparedProfile.position.trim().replace(/\s+/g, " "),
        createdAt: serverTimestamp(),
      };
      const reportId = `${user.uid}_${month}_${cycle === 1 ? "first" : "second"}`;
      const reportReference = doc(db, "accomplishmentReports", reportId);
      await setDoc(reportReference, data);
      const saved = { ...data, id: reportId, createdAt: undefined } as Report;
      setReports((current) => [saved, ...current].sort((left, right) => right.month.localeCompare(left.month) || right.cycle - left.cycle));
      setActivities([""]);
      setShowForm(false);
      setMessage({ kind: "success", text: "Accomplishment report saved." });
    } catch (cause) {
      setMessage({ kind: "error", text: cause instanceof Error ? `Could not ${editingReport ? "update the report activities" : "save this report"}. ${cause.message}` : `Could not ${editingReport ? "update the report activities" : "save this report"}. Try again.` });
    } finally {
      setSaving(false);
    }
  }

  return <div className="ar-module">
    {showForm && <section className="content-section ar-entry-section">
      <div className="section-heading"><div><p className="eyebrow">{editingReport ? "myAR · Edit activities" : "myAR · Data entry"}</p><h2>{editingReport ? "Edit Report Activities" : "Accomplishment Report"}</h2><p className="muted">{editingReport ? "Update the activities for this saved report." : "Enter the reporting period and activities. Your profile details fill the report automatically."}</p></div><button type="button" className="ghost-button" disabled={saving} onClick={cancelEdit}>{editingReport ? "Cancel Edit" : "Cancel"}</button></div>
      {message && <p className={`auth-message auth-message-${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
      {loading ? <p className="muted">Loading your profile and reports…</p> : !preparedProfile ? <div className="ar-profile-notice"><strong>Profile details needed</strong><p>Add your name, position, and unit in Profile to prepare an accomplishment report.</p><button type="button" className="ghost-button" onClick={cancelEdit}>Back to Saved Reports</button></div> : <>
        <form className="ar-form" onSubmit={saveReport}>
          <div className="ar-form-fields">
            <label>Month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} required disabled={!!editingReport} /></label>
            <label>Half-month Cycle<select value={cycle} onChange={(event) => setCycle(Number(event.target.value) as 1 | 2)} disabled={!!editingReport}><option value={1}>1–15</option><option value={2}>16–{lastDay}</option></select></label>
          </div>
          {duplicateReport && <p className="auth-message auth-message-error" role="status">A report for {reportPeriod({ month, startDay, endDay })} is already saved. Edit it from Saved Reports.</p>}
          <div className="ar-auto-details" aria-label={editingReport ? "Saved report details" : "Automatically filled from your Profile"}><p><span>Unit</span><strong>{reportUnit(preparedProfile.unit)}</strong></p><p><span>Prepared</span><strong>{preparedProfile.name.toLocaleUpperCase("en-PH")}</strong><em>{preparedProfile.position}</em></p></div>
          <fieldset className="ar-activities-entry"><legend>Activities</legend><div className="ar-activity-list">{activities.map((activity, index) => <div className="ar-activity-entry" key={index}><label htmlFor={`ar-activity-${index}`}>Activity {index + 1}<textarea id={`ar-activity-${index}`} value={activity} maxLength={1200} rows={2} onChange={(event) => setActivities((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder="Describe the activity or accomplishment" required /></label>{activities.length > 1 && <button type="button" className="ar-remove-activity" onClick={() => setActivities((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}</div>)}</div>{activities.length < MAX_ACTIVITIES && <button type="button" className="text-button ar-add-activity" onClick={() => setActivities((current) => [...current, ""])}>+ Add activity</button>}</fieldset>
          <div className="form-actions ar-form-actions">{editingReport && <button type="button" className="ghost-button" disabled={saving} onClick={previewEditedReport}>Preview / Print</button>}<button className="primary-button" disabled={saving || duplicateReport}>{saving ? "Saving..." : editingReport ? "Update Activities" : "Save"}</button></div>
        </form>
      </>}
    </section>}

    {!showForm && <section className="content-section ar-records-section">
      <div className="section-heading"><div><p className="eyebrow">Your records</p><h2>Saved Reports</h2><p className="muted">{reports.length} {reports.length === 1 ? "report" : "reports"} saved to your account.</p></div><button type="button" className="primary-button ar-add-report-button" onClick={startNewReport}>Add</button></div>
      {message && <p className={`auth-message auth-message-${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
      {loading ? <p className="muted">Loading reports...</p> : reports.length === 0 ? <div className="empty-state"><span className="empty-number">00</span><h3>No accomplishment reports yet</h3><p>Saved reports will appear here.</p></div> : <div className="permit-table ar-saved-table"><div className="table-head"><span>Month</span><span>Half-month Cycle</span><span aria-hidden="true" /></div>{reports.map((report) => <div className="table-row" key={report.id}><strong>{reportMonth(report.month)}</strong><span>{report.startDay}-{report.endDay}</span><div className="ar-record-actions"><button type="button" className="row-action" onClick={() => editActivities(report)}>Edit</button><button type="button" className="row-action" onClick={() => setSelectedReport(report)}>View</button></div></div>)}</div>}
    </section>}

    {selectedReport && <AccomplishmentReportPreview report={selectedReport} onClose={() => setSelectedReport(null)} />}
  </div>;
}

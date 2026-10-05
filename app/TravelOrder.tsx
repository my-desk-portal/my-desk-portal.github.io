"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import { loadPersonnel as loadAccountPersonnel, type PersonnelEntry } from "@/lib/personnel";
import { getDocumentNotificationReferences, makeDocumentNotification } from "@/lib/document-notifications";
import DeleteConfirmation from "./DeleteConfirmation";
import { normalizeWorkflowStatus, type WorkflowStatus } from "./workflow-status";
import "./travel-order.css";

type TravelOrderStatus = WorkflowStatus;
type TravelOrderPerson = { name: string; userId?: string; position: string; salary: string; toNumber?: string };
type TravelOrder = {
  id: string;
  date: string;
  people: TravelOrderPerson[];
  officeStation: string;
  departureDate: string;
  returnDate: string;
  placeOfTravel: string;
  purpose: string;
  objective: string;
  perDiemsAllowed: "Yes" | "No";
  assistantLaborersAllowed: "Yes" | "No";
  chargeTo: string;
  transportation: string;
  remarks: string;
  status: TravelOrderStatus;
  ownerId: string;
  recipientIds?: string[];
  createdAt?: unknown;
};

const officeStations = ["DA-RFO XIII", "DA-ILD Caraga"] as const;
const chargeOptions = ["FOD-AGRISTAT", "FOD-AMIA", "FOD-DRRM"];
const statuses: TravelOrderStatus[] = ["Pending", "Approved", "Disapproved"];
const asset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;

function travelOrderNumberKey(value: string) {
  return encodeURIComponent(value.trim().toUpperCase());
}

function localDateValue() {
  const today = new Date();
  const local = new Date(today.getTime() - today.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatTravelDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function TravelOrderForm({ user, onSaved, onCancel, onError }: { user: User; onSaved: (order: TravelOrder) => void; onCancel: () => void; onError: (message: string) => void }) {
  const [people, setPeople] = useState<TravelOrderPerson[]>([{ name: "", position: "", salary: "" }]);
  const [officeStation, setOfficeStation] = useState<(typeof officeStations)[number]>(officeStations[0]);
  const [personnel, setPersonnel] = useState<PersonnelEntry[]>([]);
  const [personnelStatus, setPersonnelStatus] = useState<"loading" | "ready" | "error">("loading");
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [placeOfTravel, setPlaceOfTravel] = useState("");
  const [purpose, setPurpose] = useState("");
  const [objective, setObjective] = useState("");
  const [perDiemsAllowed, setPerDiemsAllowed] = useState<"" | "Yes" | "No">("");
  const [assistantLaborersAllowed, setAssistantLaborersAllowed] = useState<"" | "Yes" | "No">("");
  const [chargeTo, setChargeTo] = useState("");
  const [transportation, setTransportation] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadPersonnel() {
      try {
        const entries = await loadAccountPersonnel();
        if (!entries.length) throw new Error("No registered accounts have a name.");
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

  function updatePerson(index: number, update: Partial<TravelOrderPerson>) {
    setPeople((current) => current.map((person, itemIndex) => itemIndex === index ? { ...person, ...update } : person));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db) { onError("Firebase is not configured."); return; }
    setBusy(true);
    onError("");
    const record = {
      date: "",
      people: people.map((person) => ({ name: person.name.trim(), userId: person.userId, position: person.position.trim(), salary: person.salary.trim() })),
      recipientIds: [...new Set(people.map((person) => person.userId).filter((id): id is string => Boolean(id) && id !== user.uid))],
      officeStation,
      departureDate,
      returnDate,
      placeOfTravel: placeOfTravel.trim(),
      purpose: purpose.trim(),
      objective: objective.trim(),
      perDiemsAllowed: perDiemsAllowed as "Yes" | "No",
      assistantLaborersAllowed: assistantLaborersAllowed as "Yes" | "No",
      chargeTo,
      transportation: transportation.trim(),
      remarks: remarks.trim(),
      status: "Pending" as const,
      ownerId: user.uid,
      createdAt: serverTimestamp(),
    };
    try {
      const firestore = db;
      const orderRef = doc(collection(firestore, "travelOrders"));
      const batch = writeBatch(firestore);
      batch.set(orderRef, record);
      record.recipientIds.forEach((recipientId) => {
        const notification = makeDocumentNotification(firestore, { recipientId, ownerId: user.uid, documentId: orderRef.id, documentType: "Travel Order", departureDate, returnDate, placeOfTravel: record.placeOfTravel, purpose: record.purpose });
        batch.set(notification.reference, notification.data);
      });
      await batch.commit();
      onSaved({ id: orderRef.id, ...record });
    } catch (error) {
      const code = (error as { code?: string }).code;
      onError(code ? `Could not save the Travel Order (${code}).` : "Could not save the Travel Order. Try again.");
    } finally { setBusy(false); }
  }

  return <section className="content-section form-section travel-order-form-section">
    <div className="section-heading"><div><p className="eyebrow">New record</p><h2>Create Travel Order</h2><p className="muted">One A4 Travel Order page will be generated for each person. The date and TO No. are entered when approving.</p></div><button type="button" className="ghost-button" onClick={onCancel}>Cancel</button></div>
    <form className="permit-form travel-order-form" onSubmit={save}>
      <label className="travel-order-office-field">Office Station<select value={officeStation} onChange={(event) => setOfficeStation(event.target.value as (typeof officeStations)[number])} required>{officeStations.map((station) => <option key={station}>{station}</option>)}</select></label>
      <div className="travel-order-people wide-field">
        <div className="travel-order-people-heading"><strong>Persons traveling</strong><span>Add each person who needs a separate Travel Order page.</span></div>
        {personnelStatus === "error" && <p className="travel-order-number-error" role="alert">Unable to load personnel from user accounts. Reload the page to try again.</p>}
        {people.map((person, index) => <fieldset className="travel-order-person" key={index}>
          <legend>Personnel {index + 1}</legend>
          <label>Name<select value={person.userId ?? ""} onChange={(event) => { const userId = event.target.value; const selectedPerson = personnel.find((entry) => entry.userId === userId); updatePerson(index, { userId, name: selectedPerson?.name ?? "", position: selectedPerson?.position ?? "" }); }} required disabled={personnelStatus !== "ready"}><option value="" disabled>{personnelStatus === "loading" ? "Loading personnel..." : personnelStatus === "error" ? "Personnel list unavailable" : "Select a personnel"}</option>{personnel.map((entry) => <option key={entry.userId} value={entry.userId}>{entry.name}</option>)}</select></label>
          <label>Position<input value={person.position} readOnly required /></label>
          <label>Monthly Salary <span className="muted-inline">(optional)</span><div className="travel-order-currency-field"><span aria-hidden="true">₱</span><input type="number" inputMode="decimal" min="0" step="0.01" value={person.salary} onChange={(event) => updatePerson(index, { salary: event.target.value })} onBlur={() => { if (person.salary !== "") updatePerson(index, { salary: Number(person.salary).toFixed(2) }); }} aria-label="Monthly salary amount in Philippine pesos" placeholder="0.00" /></div></label>
          {people.length > 1 && <button type="button" className="remove-participant" aria-label={`Delete person ${index + 1}`} onClick={() => setPeople((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Delete</button>}
        </fieldset>)}
        <button type="button" className="text-button plain-action add-item-text-button" onClick={() => setPeople((current) => [...current, { name: "", position: "", salary: "" }])}>+ Add Personnel</button>
      </div>
      <div className="date-range-field wide-field travel-order-date-range"><span>Departure Date to Return Date</span><div><input aria-label="Departure date" type="date" value={departureDate} onChange={(event) => setDepartureDate(event.target.value)} required /><span>to</span><input aria-label="Return date" type="date" min={departureDate} value={returnDate} onChange={(event) => setReturnDate(event.target.value)} required /></div></div>
      <label className="wide-field">Place of Travel<input value={placeOfTravel} onChange={(event) => setPlaceOfTravel(event.target.value)} required /></label>
      <label className="wide-field">Specific Purpose of the Trip<textarea rows={2} value={purpose} onChange={(event) => setPurpose(event.target.value)} required /></label>
      <label className="wide-field">Objective(s)<textarea rows={2} value={objective} onChange={(event) => setObjective(event.target.value)} required /></label>
      <label>Per Diems Allowed<select value={perDiemsAllowed} onChange={(event) => setPerDiemsAllowed(event.target.value as "" | "Yes" | "No")} required><option value="" disabled>Select Yes or No</option><option>Yes</option><option>No</option></select></label>
      <label>Assistant Laborers Allowed<select value={assistantLaborersAllowed} onChange={(event) => setAssistantLaborersAllowed(event.target.value as "" | "Yes" | "No")} required><option value="" disabled>Select Yes or No</option><option>Yes</option><option>No</option></select></label>
      <label>Charge to<select value={chargeTo} onChange={(event) => setChargeTo(event.target.value)} required><option value="" disabled>Select appropriation</option>{chargeOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
      <label>Means of Transportation<input value={transportation} onChange={(event) => setTransportation(event.target.value)} required /></label>
      <label className="wide-field">Remarks or Special Instructions <span className="muted-inline">(optional)</span><input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Enter any remarks or special instructions" /></label>
      <div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save"}</button></div>
    </form>
  </section>;
}

function TravelOrderList({ orders, onNew, onPreview, onDelete, onStatusChange, updatingId, deletingId }: { orders: TravelOrder[]; onNew: () => void; onPreview: (order: TravelOrder) => void; onDelete: (order: TravelOrder) => void; onStatusChange: (order: TravelOrder, status: TravelOrderStatus, date?: string, toNumbers?: string[]) => Promise<boolean>; updatingId: string | null; deletingId: string | null }) {
  const [approvalOrderId, setApprovalOrderId] = useState<string | null>(null);
  const [approvalDate, setApprovalDate] = useState("");
  const [approvalNumbers, setApprovalNumbers] = useState<string[]>([]);
  const [approvalError, setApprovalError] = useState("");

  function updateApprovalNumber(index: number, value: string) {
    setApprovalNumbers((current) => current.map((number, itemIndex) => itemIndex === index ? value : number));
    setApprovalError("");
  }

  async function confirmApproval(event: FormEvent<HTMLFormElement>, order: TravelOrder) {
    event.preventDefault();
    if (!approvalDate) {
      setApprovalError("Enter the Travel Order date before approving.");
      return;
    }
    const numbers = approvalNumbers.map((number) => number.trim());
    if (numbers.length !== order.people.length || numbers.some((number) => !number)) {
      setApprovalError("Enter a TO No. for every person before approving.");
      return;
    }
    if (new Set(numbers.map((number) => number.toUpperCase())).size !== numbers.length) {
      setApprovalError("Each person must have a different TO No.");
      return;
    }
    setApprovalError("");
    if (await onStatusChange(order, "Approved", approvalDate, numbers)) setApprovalOrderId(null);
  }

  return <section className="content-section travel-order-list-section">
    <div className="section-heading"><div><p className="eyebrow">Your records</p><h2>Travel Orders</h2><p className="muted">{orders.length} {orders.length === 1 ? "Travel Order" : "Travel Orders"} registered to your account.</p></div><button className="primary-button" onClick={onNew}>Add</button></div>
    {orders.length === 0 ? <div className="empty-state"><span className="empty-number">00</span><h3>No Travel Orders yet</h3><p>Create a Travel Order for one or more personnel.</p><button className="text-button plain-action document-create-action" onClick={onNew}>Add a Travel Order</button></div> : <div className="permit-table">
      <div className="table-head travel-order-list-head"><span>Date</span><span>Personnel</span><span>Place of Travel</span><span>Status</span></div>
      {orders.map((order) => <div className="travel-order-row-group" key={order.id}>
        <div className="table-row travel-order-list-row">
          <strong>{order.date ? formatTravelDate(order.date) : "Pending approval"}</strong><span className="travel-order-list-people">{order.people.map((person) => person.name).join(", ")}</span><span>{order.placeOfTravel}</span>
          <label className={`travel-order-status travel-order-status-${order.status.toLowerCase()}`}><span className="sr-only">Status</span><select aria-label={`Status for ${order.people.map((person) => person.name).join(", ")}`} value={order.status} disabled={updatingId === order.id || deletingId !== null} onChange={(event) => { const nextStatus = event.target.value as TravelOrderStatus; if (nextStatus === "Approved") { setApprovalOrderId(order.id); setApprovalDate(order.date || localDateValue()); setApprovalNumbers(order.people.map((person) => person.toNumber ?? "")); setApprovalError(""); } else { setApprovalOrderId(null); void onStatusChange(order, nextStatus); } }}>{statuses.map((status) => <option key={status}>{status}</option>)}</select>{updatingId === order.id && <small>Saving...</small>}</label>
          <span className="travel-order-row-actions"><button type="button" className="row-action" disabled={deletingId !== null} onClick={() => onPreview(order)}>View</button>{order.status !== "Approved" && <button type="button" className="delete-button" disabled={updatingId !== null || deletingId !== null} onClick={() => onDelete(order)}>{deletingId === order.id ? "Deleting..." : "Delete"}</button>}</span>
        </div>
        {approvalOrderId === order.id && <form className="travel-order-approval-editor" onSubmit={(event) => confirmApproval(event, order)}>
          <div><strong>Complete approval details</strong><p>Enter the approval date and assign a unique TO No. to each person.</p></div>
          <label>Date<input type="date" value={approvalDate} onChange={(event) => { setApprovalDate(event.target.value); setApprovalError(""); }} required /></label>
          <div className="travel-order-number-fields">{order.people.map((person, index) => <label key={`${order.id}-to-number-${index}`}>{person.name}<input value={approvalNumbers[index] ?? ""} onChange={(event) => updateApprovalNumber(index, event.target.value)} placeholder="TO No." required /></label>)}</div>
          {approvalError && <p className="travel-order-number-error" role="alert">{approvalError}</p>}
          <div className="travel-order-number-actions"><button type="button" className="ghost-button" disabled={updatingId === order.id || deletingId !== null} onClick={() => { setApprovalOrderId(null); setApprovalError(""); }}>Cancel</button><button className="primary-button" disabled={updatingId === order.id || deletingId !== null}>{updatingId === order.id ? "Approving..." : "Confirm Approval"}</button></div>
        </form>}
      </div>)}
    </div>}
  </section>;
}
function TravelField({ label, children = "", className = "" }: { label: string; children?: string; className?: string }) {
  return <div className={`travel-order-field ${className}`}><strong>{label}:</strong><span className="travel-order-value">{children || "\u00a0"}</span></div>;
}

function TravelOrderPaper({ order, person }: { order: TravelOrder; person: TravelOrderPerson }) {
  return <article className="travel-order-paper">
    <div className="travel-order-frame" />
    <img className="travel-order-letterhead" src={asset("/Travel%20Order%20-%20header.jpg")} alt="Department of Agriculture Caraga Region letterhead" />
    <div className="travel-order-document">
      <div className="travel-order-header-divider" aria-hidden="true" />
      <h1>TRAVEL ORDER</h1>
      <div className="travel-order-number-date"><TravelField label="No.">{person.toNumber ?? ""}</TravelField> <TravelField label="Date" className="travel-order-date-field">{formatTravelDate(order.date)}</TravelField></div>
      <div className="travel-order-person-fields">
        <div><TravelField label="Name">{person.name}</TravelField><TravelField label="Position">{person.position}</TravelField></div>
        <div><TravelField label="Salary Per Month">{person.salary}</TravelField><TravelField label="Office Station">{order.officeStation}</TravelField></div>
      </div>
      <div className="travel-order-date-fields"><TravelField label="Departure Date">{formatTravelDate(order.departureDate)}</TravelField><TravelField label="Return Date">{formatTravelDate(order.returnDate)}</TravelField></div>
      <div className="travel-order-fields-stack">
        <TravelField label="Place of Travel">{order.placeOfTravel}</TravelField>
        <TravelField label="Specific Purpose of the Trip">{order.purpose}</TravelField>
        <TravelField label="Objective(s)">{order.objective}</TravelField>
        <TravelField label="Per Diems Allowed">{order.perDiemsAllowed}</TravelField>
        <TravelField label="Assistant Laborers Allowed">{order.assistantLaborersAllowed}</TravelField>
        <TravelField label="Appropriation to which travel should be charged">{order.chargeTo}</TravelField>
        <TravelField label="Means of Transportation">{order.transportation}</TravelField>
        <TravelField label="Remarks or Special Instructions">{order.remarks}</TravelField>
      </div>
      <div className="travel-order-approvals">
        <div><span>Recommending Approval:</span><strong>REBECCA R. ATEGA</strong><em>RTD for Operations</em></div>
        <div><span>Approved:</span><strong>ENGR. RICARDO M. OÑATE JR.</strong><em>Regional Executive Director</em></div>
      </div>
      <table className="travel-order-certification"><thead><tr><th>Date</th><th>Place of Visited</th><th>Purpose</th><th>Certifying Officer</th></tr></thead><tbody><tr><td /><td /><td>{order.purpose}</td><td /></tr></tbody></table>
    </div>
    {order.status === "Disapproved" && <div className="travel-order-disapproved-stamp" aria-label="Disapproved">DISAPPROVED</div>}
  </article>;
}

function TravelOrderPreview({ order, onClose }: { order: TravelOrder; onClose: () => void }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");

  async function downloadPdf() {
    if (!pagesRef.current) return;
    setDownloading(true);
    setError("");
    try {
      await Promise.all(Array.from(pagesRef.current.querySelectorAll("img")).map(async (image) => {
        if (!image.complete) await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("The Travel Order header image could not be loaded.")); });
        if (image.naturalWidth === 0) throw new Error("The Travel Order header image could not be loaded.");
        if (image.decode) await image.decode();
      }));
      const pages = Array.from(pagesRef.current.querySelectorAll<HTMLElement>(".travel-order-paper"));
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      for (let index = 0; index < pages.length; index += 1) {
        const canvas = await html2canvas(pages[index], { backgroundColor: "#fff", logging: false, scale: 3, useCORS: true });
        if (index > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/jpeg", .96), "JPEG", 0, 0, 210, 297);
      }
      pdf.save(`travel-order-${order.id}.pdf`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create the Travel Order PDF."); }
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
          image.onerror = () => reject(new Error("The Travel Order header image could not be loaded."));
        });
        if (image.naturalWidth === 0) throw new Error("The Travel Order header image could not be loaded.");
        if (image.decode) await image.decode();
      }));
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      window.print();
    } catch (cause) {
      setPrintError(cause instanceof Error ? cause.message : "Unable to prepare the Travel Order for printing.");
    } finally {
      setPrinting(false);
    }
  }

  return <div className="preview-backdrop travel-order-preview-backdrop"><div className="preview-toolbar"><span>Travel Order preview · {order.people.length} {order.people.length === 1 ? "page" : "pages"}</span><button type="button" className="ghost-button" onClick={onClose}>Close</button><button type="button" className="pdf-button" disabled={downloading} onClick={downloadPdf}>{downloading ? "Preparing PDF..." : "Download PDF"}</button><button type="button" className="pdf-button" disabled={printing} onClick={printPreview}>{printing ? "Preparing print..." : "Print"}</button>{error && <small className="download-error">{error}</small>}{printError && <small className="download-error" role="alert">{printError}</small>}</div><div ref={pagesRef} className="travel-order-preview-pages">{order.people.map((person, index) => <TravelOrderPaper key={`${order.id}-${index}`} order={order} person={person} />)}</div></div>;
}

export default function TravelOrderModule({ user }: { user: User }) {
  const [orders, setOrders] = useState<TravelOrder[]>([]);
  const [view, setView] = useState<"list" | "new">("list");
  const [preview, setPreview] = useState<TravelOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TravelOrder | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!db) { setLoading(false); setError("Firebase is not configured."); return; }
    getDocs(query(collection(db, "travelOrders"), where("ownerId", "==", user.uid))).then((snapshot) => {
      const rows = snapshot.docs.map((item) => {
        const data = item.data();
        return { id: item.id, ...data, status: normalizeWorkflowStatus(data.status) } as TravelOrder;
      });
      rows.sort((left, right) => ((right.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0) - ((left.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0));
      setOrders(rows);
    }).catch((cause) => {
      const code = (cause as { code?: string }).code;
      setError(code ? `Could not load Travel Orders (${code}).` : "Could not load Travel Orders. Refresh and try again.");
    }).finally(() => setLoading(false));
  }, [user.uid]);

  async function deleteOrder(order: TravelOrder) {
    const firestore = db;
    if (!firestore) return;
    setDeletingId(order.id);
    setError("");
    try {
      const numberRefs = [...new Set(order.people.map((person) => person.toNumber?.trim()).filter((number): number is string => Boolean(number)))]
        .map((number) => doc(firestore, "travelOrderNumbers", travelOrderNumberKey(number)));
      const numberSnapshots = await Promise.all(numberRefs.map((numberRef) => getDoc(numberRef)));
      const notificationReferences = await getDocumentNotificationReferences(firestore, user.uid, order.id);
      const batch = writeBatch(firestore);
      numberSnapshots.forEach((snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        if (data.ownerId === user.uid && data.travelOrderId === order.id) batch.delete(snapshot.ref);
      });
      notificationReferences.forEach((reference) => batch.delete(reference));
      batch.delete(doc(firestore, "travelOrders", order.id));
      await batch.commit();
      setOrders((current) => current.filter((item) => item.id !== order.id));
      setPreview((current) => current?.id === order.id ? null : current);
      setPendingDelete(null);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code ? `Could not delete Travel Order (${code}).` : "Could not delete Travel Order.");
      setPendingDelete(null);
    } finally {
      setDeletingId(null);
    }
  }

  async function changeStatus(order: TravelOrder, status: TravelOrderStatus, date?: string, toNumbers?: string[]): Promise<boolean> {
    const firestore = db;
    if (!firestore) { setError("Firebase is not configured."); return false; }
    setUpdatingId(order.id);
    setError("");
    try {
      if (status === "Approved") {
        if (!date) {
          setError("Enter the Travel Order date before approving.");
          return false;
        }
        const numbers = (toNumbers ?? []).map((number) => number.trim());
        if (numbers.length !== order.people.length || numbers.some((number) => !number)) {
          setError("Enter a TO No. for every person before approving.");
          return false;
        }
        const normalizedNumbers = numbers.map((number) => number.toUpperCase());
        if (new Set(normalizedNumbers).size !== normalizedNumbers.length) {
          setError("Each person must have a different TO No.");
          return false;
        }

        const people = order.people.map((person, index) => ({ ...person, toNumber: numbers[index] }));
        const travelOrderRef = doc(firestore, "travelOrders", order.id);
        const numberRefs = normalizedNumbers.map((number) => doc(firestore, "travelOrderNumbers", travelOrderNumberKey(number)));
        await runTransaction(firestore, async (transaction) => {
          const registeredNumbers = await Promise.all(numberRefs.map((numberRef) => transaction.get(numberRef)));
          if (registeredNumbers.some((snapshot) => snapshot.exists() && (snapshot.data().ownerId !== user.uid || snapshot.data().travelOrderId !== order.id))) {
            throw new Error("This TO No. is already assigned to another Travel Order.");
          }
          transaction.update(travelOrderRef, { status, date, people, updatedAt: serverTimestamp() });
          registeredNumbers.forEach((snapshot, index) => {
            if (!snapshot.exists()) transaction.set(numberRefs[index], { ownerId: user.uid, travelOrderId: order.id });
          });
        });
        setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status, date, people } : item));
      } else {
        await updateDoc(doc(firestore, "travelOrders", order.id), { status, updatedAt: serverTimestamp() });
        setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status } : item));
      }
      return true;
    } catch (cause) {
      if (cause instanceof Error && cause.message === "This TO No. is already assigned to another Travel Order.") {
        setError(cause.message);
      } else {
        const code = (cause as { code?: string }).code;
        setError(code ? `Could not update Travel Order status (${code}).` : "Could not update Travel Order status.");
      }
      return false;
    } finally { setUpdatingId(null); }
  }

  return <>
    {error && <div className="error-message travel-order-error">{error}</div>}
    {view === "new" ? <TravelOrderForm user={user} onSaved={(order) => { setOrders((current) => [order, ...current]); setView("list"); }} onCancel={() => setView("list")} onError={setError} /> : loading ? <section className="content-section"><p className="muted">Loading Travel Orders...</p></section> : <TravelOrderList orders={orders} onNew={() => { setError(""); setView("new"); }} onPreview={setPreview} onDelete={setPendingDelete} onStatusChange={changeStatus} updatingId={updatingId} deletingId={deletingId} />}
    <DeleteConfirmation open={Boolean(pendingDelete)} title="Confirm Travel Order Deletion?" description="Are you sure you want to delete this Travel Order? This action cannot be undone. Its assigned TO No. values will be released." busy={Boolean(pendingDelete && deletingId === pendingDelete.id)} onCancel={() => setPendingDelete(null)} onConfirm={() => { if (pendingDelete) void deleteOrder(pendingDelete); }} />
    {preview && <TravelOrderPreview order={preview} onClose={() => setPreview(null)} />}
  </>;
}

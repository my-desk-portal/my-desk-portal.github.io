"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { addDoc, collection, doc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import "./travel-order.css";

type TravelOrderStatus = "Processing" | "Approved" | "Disapproved";
type TravelOrderPerson = { name: string; position: string; salary: string; toNumber?: string };
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
  createdAt?: unknown;
};

const officeStation = "DA-RFO XIII";
const chargeOptions = ["Agricultural Statistics", "AMIA", "DRRM"];
const statuses: TravelOrderStatus[] = ["Processing", "Approved", "Disapproved"];
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
      people: people.map((person) => ({ name: person.name.trim(), position: person.position.trim(), salary: person.salary.trim() })),
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
      status: "Processing" as const,
      ownerId: user.uid,
      createdAt: serverTimestamp(),
    };
    try {
      const reference = await addDoc(collection(db, "travelOrders"), record);
      onSaved({ id: reference.id, ...record });
    } catch (error) {
      const code = (error as { code?: string }).code;
      onError(code ? `Could not save the Travel Order (${code}).` : "Could not save the Travel Order. Try again.");
    } finally { setBusy(false); }
  }

  return <section className="content-section form-section travel-order-form-section">
    <div className="section-heading"><div><p className="eyebrow">New record</p><h2>Create Travel Order</h2><p className="muted">One A4 Travel Order page will be generated for each person. The date and TO No. are entered when approving.</p></div><button type="button" className="ghost-button" onClick={onCancel}>Cancel</button></div>
    <form className="permit-form travel-order-form" onSubmit={save}>
      <label>Office Station<input value={officeStation} readOnly /></label>
      <div className="travel-order-people wide-field">
        <div className="travel-order-people-heading"><strong>Persons traveling</strong><span>Add each person who needs a separate Travel Order page.</span></div>
        {people.map((person, index) => <fieldset className="travel-order-person" key={index}>
          <legend>Person {index + 1}</legend>
          <label>Name<input value={person.name} onChange={(event) => updatePerson(index, { name: event.target.value })} placeholder="Full name" required /></label>
          <label>Position<input value={person.position} onChange={(event) => updatePerson(index, { position: event.target.value })} placeholder="Position" required /></label>
          <label>Salary per Month <span className="muted-inline">(optional)</span><input value={person.salary} onChange={(event) => updatePerson(index, { salary: event.target.value })} placeholder="e.g. 25,000.00" /></label>
          {people.length > 1 && <button type="button" className="remove-participant" onClick={() => setPeople((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove person</button>}
        </fieldset>)}
        <button type="button" className="text-button" onClick={() => setPeople((current) => [...current, { name: "", position: "", salary: "" }])}>+ Add a Person</button>
      </div>
      <div className="date-range-field"><span>Departure Date to Return Date</span><div><input aria-label="Departure date" type="date" value={departureDate} onChange={(event) => setDepartureDate(event.target.value)} required /><span>to</span><input aria-label="Return date" type="date" min={departureDate} value={returnDate} onChange={(event) => setReturnDate(event.target.value)} required /></div></div>
      <label className="wide-field">Place of Travel<input value={placeOfTravel} onChange={(event) => setPlaceOfTravel(event.target.value)} required /></label>
      <label className="wide-field">Specific Purpose of the Trip<textarea rows={2} value={purpose} onChange={(event) => setPurpose(event.target.value)} required /></label>
      <label className="wide-field">Objective(s)<textarea rows={2} value={objective} onChange={(event) => setObjective(event.target.value)} required /></label>
      <label>Per Diems Allowed<select value={perDiemsAllowed} onChange={(event) => setPerDiemsAllowed(event.target.value as "" | "Yes" | "No")} required><option value="" disabled>Select Yes or No</option><option>Yes</option><option>No</option></select></label>
      <label>Assistant Laborers Allowed<select value={assistantLaborersAllowed} onChange={(event) => setAssistantLaborersAllowed(event.target.value as "" | "Yes" | "No")} required><option value="" disabled>Select Yes or No</option><option>Yes</option><option>No</option></select></label>
      <label>Charge to<select value={chargeTo} onChange={(event) => setChargeTo(event.target.value)} required><option value="" disabled>Select appropriation</option>{chargeOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
      <label>Means of Transportation<input value={transportation} onChange={(event) => setTransportation(event.target.value)} required /></label>
      <label className="wide-field">Remarks or Special Instructions <span className="muted-inline">(optional)</span><input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Enter any remarks or special instructions" /></label>
      <div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save Travel Order"}</button></div>
    </form>
  </section>;
}

function TravelOrderList({ orders, onNew, onPreview, onStatusChange, updatingId }: { orders: TravelOrder[]; onNew: () => void; onPreview: (order: TravelOrder) => void; onStatusChange: (order: TravelOrder, status: TravelOrderStatus, date?: string, toNumbers?: string[]) => Promise<boolean>; updatingId: string | null }) {
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
    <div className="section-heading"><div><p className="eyebrow">Your records</p><h2>Travel Orders</h2><p className="muted">{orders.length} {orders.length === 1 ? "Travel Order" : "Travel Orders"} registered to your account.</p></div><button className="primary-button" onClick={onNew}>+ Add TO</button></div>
    {orders.length === 0 ? <div className="empty-state"><span className="empty-number">00</span><h3>No Travel Orders yet</h3><p>Create a Travel Order for one or more personnel.</p><button className="text-button" onClick={onNew}>Add a Travel Order</button></div> : <div className="permit-table">
      <div className="table-head travel-order-list-head"><span>Date</span><span>Personnel</span><span>Place of Travel</span><span>Status</span><span>Preview</span></div>
      {orders.map((order) => <div className="travel-order-row-group" key={order.id}>
        <div className="table-row travel-order-list-row">
          <strong>{order.date ? formatTravelDate(order.date) : "Pending approval"}</strong><span className="travel-order-list-people">{order.people.map((person) => person.name).join(", ")}</span><span>{order.placeOfTravel}</span>
          <label className={`travel-order-status travel-order-status-${order.status.toLowerCase()}`}><span className="sr-only">Status</span><select aria-label={`Status for ${order.people.map((person) => person.name).join(", ")}`} value={order.status} disabled={updatingId === order.id} onChange={(event) => { const nextStatus = event.target.value as TravelOrderStatus; if (nextStatus === "Approved") { setApprovalOrderId(order.id); setApprovalDate(order.date || localDateValue()); setApprovalNumbers(order.people.map((person) => person.toNumber ?? "")); setApprovalError(""); } else { setApprovalOrderId(null); void onStatusChange(order, nextStatus); } }}>{statuses.map((status) => <option key={status}>{status}</option>)}</select>{updatingId === order.id && <small>Saving...</small>}</label>
          <button className="row-action" onClick={() => onPreview(order)}>Preview</button>
        </div>
        {approvalOrderId === order.id && <form className="travel-order-approval-editor" onSubmit={(event) => confirmApproval(event, order)}>
          <div><strong>Complete approval details</strong><p>Enter the approval date and assign a unique TO No. to each person.</p></div>
          <label>Date<input type="date" value={approvalDate} onChange={(event) => { setApprovalDate(event.target.value); setApprovalError(""); }} required /></label>
          <div className="travel-order-number-fields">{order.people.map((person, index) => <label key={`${order.id}-to-number-${index}`}>{person.name}<input value={approvalNumbers[index] ?? ""} onChange={(event) => updateApprovalNumber(index, event.target.value)} placeholder="TO No." required /></label>)}</div>
          {approvalError && <p className="travel-order-number-error" role="alert">{approvalError}</p>}
          <div className="travel-order-number-actions"><button type="button" className="ghost-button" disabled={updatingId === order.id} onClick={() => { setApprovalOrderId(null); setApprovalError(""); }}>Cancel</button><button className="primary-button" disabled={updatingId === order.id}>{updatingId === order.id ? "Approving..." : "Confirm Approval"}</button></div>
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
        <div><span>Recommending Approval:</span><strong>REBECCA R. ATEGA</strong><em>Field Operations Division</em></div>
        <div><span>Approved:</span><strong>ENGR. RICARDO M. OÑATE JR.</strong><em>Regional Executive Director</em></div>
      </div>
      <table className="travel-order-certification"><thead><tr><th>Date</th><th>Place of Visited</th><th>Purpose</th><th>Certifying Officer</th></tr></thead><tbody><tr><td /><td /><td>{order.purpose}</td><td /></tr></tbody></table>
    </div>
  </article>;
}

function TravelOrderPreview({ order, onClose }: { order: TravelOrder; onClose: () => void }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  async function downloadPdf() {
    if (!pagesRef.current) return;
    setDownloading(true);
    setError("");
    try {
      await Promise.all(Array.from(pagesRef.current.querySelectorAll("img")).map(async (image) => {
        if (!image.complete) await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("The Travel Order header image could not be loaded.")); });
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

  return <div className="preview-backdrop travel-order-preview-backdrop"><div className="preview-toolbar"><span>Travel Order preview · {order.people.length} {order.people.length === 1 ? "page" : "pages"}</span><button className="ghost-button" onClick={onClose}>Close</button><button className="pdf-button" disabled={downloading} onClick={downloadPdf}>{downloading ? "Preparing PDF..." : "Download PDF"}</button>{error && <small className="download-error">{error}</small>}</div><div ref={pagesRef} className="travel-order-preview-pages">{order.people.map((person, index) => <TravelOrderPaper key={`${order.id}-${index}`} order={order} person={person} />)}</div></div>;
}

export default function TravelOrderModule({ user }: { user: User }) {
  const [orders, setOrders] = useState<TravelOrder[]>([]);
  const [view, setView] = useState<"list" | "new">("list");
  const [preview, setPreview] = useState<TravelOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!db) { setLoading(false); setError("Firebase is not configured."); return; }
    getDocs(query(collection(db, "travelOrders"), where("ownerId", "==", user.uid))).then((snapshot) => {
      const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as TravelOrder));
      rows.sort((left, right) => ((right.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0) - ((left.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0));
      setOrders(rows);
    }).catch((cause) => {
      const code = (cause as { code?: string }).code;
      setError(code ? `Could not load Travel Orders (${code}).` : "Could not load Travel Orders. Refresh and try again.");
    }).finally(() => setLoading(false));
  }, [user.uid]);

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
    {view === "new" ? <TravelOrderForm user={user} onSaved={(order) => { setOrders((current) => [order, ...current]); setView("list"); }} onCancel={() => setView("list")} onError={setError} /> : loading ? <section className="content-section"><p className="muted">Loading Travel Orders...</p></section> : <TravelOrderList orders={orders} onNew={() => { setError(""); setView("new"); }} onPreview={setPreview} onStatusChange={changeStatus} updatingId={updatingId} />}
    {preview && <TravelOrderPreview order={preview} onClose={() => setPreview(null)} />}
  </>;
}

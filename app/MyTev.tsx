"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import { loadPdfTools } from "@/lib/pdf-tools";
import {
  blankTevItinerary,
  blankTevItineraryRow,
  blankTevTravelReference,
  isTevTransportationAmountRequired,
  loadTevRegionRates,
  formatTevAmount,
  formatTevDateRange,
  formatTaxIdentificationNo,
  maxItineraryRows,
  tevClaims,
  tevDivisions,
  tevOfficialStations,
  perDiemForClaims,
  tevTransportationMeans,
  totalsForRecord,
  normalizeTevTransportationMeansForEditor,
  type MyTevRecord,
  type TevDivision,
  type TevItinerary,
  type TevItineraryRow,
  type TevProfile,
  type TevOfficialStation,
  type TevTravelReference,
  type TevRegionRate,
} from "@/lib/mytev";
import DeleteConfirmation from "./DeleteConfirmation";
import MyTevDocuments from "./MyTevDocuments";
import RecordPagination, { useRecordPagination } from "./RecordPagination";
import "./mytev-large.css";
import "./mytev-mobile.css";

const maxTravelReferences = 8;
const maxItineraries = 8;
const tevEvidenceOptions = [
  { label: "Approved Itinerary of Travel", pattern: /\bapproved itinerary of travel\b/i },
  { label: "Approved Travel Orders", pattern: /\bapproved travel orders?\b/i },
  { label: "Boarding Pass", pattern: /\bboarding passes?\b/i },
  { label: "Boat Ticket", pattern: /\bboat tickets?\b/i },
  { label: "Bus Ticket", pattern: /\bbus tickets?\b/i },
  { label: "Certificate of Appearance", pattern: /\bcertificate of appearance\b/i },
  { label: "COENRR", pattern: /\b(?:COENRR|communication letters?)\b/i },
  { label: "Plane Ticket", pattern: /\bplane tickets?\b/i },
] as const;

function localMonthValue() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}-01T00:00:00Z`));
}

function monthDateBounds(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return null;
  const nextMonth = new Date(`${value}-01T00:00:00.000Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  nextMonth.setUTCDate(0);
  const lastDay = nextMonth.getUTCDate();
  return { first: `${value}-01`, last: `${value}-${String(lastDay).padStart(2, "0")}` };
}

function isDateWithinMonth(value: string, month: string) {
  const bounds = monthDateBounds(month);
  return Boolean(bounds && value && value >= bounds.first && value <= bounds.last);
}

function documentId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hasRowData(row: TevItineraryRow) {
  return Boolean(row.dateFrom || row.dateTo || row.visitedPlaces || row.departureTimeFrom || row.departureTimeTo || row.region || row.claims.length || row.meansOfTransportation || row.transportation);
}

function timestampMillis(value: unknown) {
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") return value.toMillis();
  return value instanceof Date ? value.getTime() : 0;
}

function initialItinerary() {
  return blankTevItinerary(documentId());
}

function MyTevForm({ profile, ownerId, initialRecord, existingMonths, rates, onCancel, onSaved }: { profile: TevProfile; ownerId: string; initialRecord?: MyTevRecord; existingMonths: string[]; rates: TevRegionRate[]; onCancel: () => void; onSaved: (record: MyTevRecord) => void }) {
  const [step, setStep] = useState<"details" | "itineraries">("details");
  const [month, setMonth] = useState(() => initialRecord?.month ?? localMonthValue());
  const [officialStation, setOfficialStation] = useState<TevOfficialStation>(() => initialRecord?.officialStation ?? tevOfficialStations[0]);
  const [references, setReferences] = useState<TevTravelReference[]>(() => initialRecord ? initialRecord.travelReferences.map((reference) => ({ ...reference, toDateRecordsUnit: reference.toDateRecordsUnit ?? "" })) : [blankTevTravelReference()]);
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>(() => initialRecord
    ? tevEvidenceOptions.filter((option) => initialRecord.evidenceOfTravelOptions?.includes(option.label) || option.pattern.test(initialRecord.evidenceOfTravel ?? "")).map((option) => option.label)
    : []);
  const evidenceOfTravel = selectedEvidence.join(", ");
  const [divisionName, setDivisionName] = useState<TevDivision>(() => initialRecord?.divisionName ?? tevDivisions[0]);
  const [itineraries, setItineraries] = useState<TevItinerary[]>(() => initialRecord
    ? initialRecord.itineraries.map((itinerary) => ({ ...itinerary, rows: itinerary.rows.map((row) => ({ ...row, meansOfTransportation: normalizeTevTransportationMeansForEditor(row.meansOfTransportation), claims: [...row.claims] })) }))
    : [initialItinerary()]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function updateReference(index: number, changes: Partial<TevTravelReference>) {
    setReferences((current) => current.map((reference, itemIndex) => itemIndex === index ? { ...reference, ...changes } : reference));
    setMessage("");
  }

  function updateMonth(value: string) {
    setMonth(value);
    setReferences((current) => current.map((reference) => {
      const dateFrom = isDateWithinMonth(reference.dateFrom, value) ? reference.dateFrom : "";
      let dateTo = isDateWithinMonth(reference.dateTo, value) ? reference.dateTo : "";
      if (dateFrom && dateTo && dateTo < dateFrom) dateTo = "";
      return { ...reference, dateFrom, dateTo };
    }));
    setItineraries((current) => current.map((itinerary) => ({
      ...itinerary,
      rows: itinerary.rows.map((row) => {
        if (isDateWithinMonth(row.dateFrom, value) && isDateWithinMonth(row.dateTo, value) && row.dateTo >= row.dateFrom) return row;
        return { ...row, dateFrom: "", dateTo: "" };
      }),
    })));
    setMessage("");
  }

  function updateItinerary(itineraryId: string, changes: Partial<Pick<TevItinerary, "dateFrom" | "dateTo">>) {
    setItineraries((current) => current.map((itinerary) => itinerary.id === itineraryId ? { ...itinerary, ...changes } : itinerary));
  }

  function updateRow(itineraryId: string, rowIndex: number, changes: Partial<TevItineraryRow>) {
    setItineraries((current) => current.map((itinerary) => itinerary.id !== itineraryId ? itinerary : {
      ...itinerary,
      rows: itinerary.rows.map((row, itemIndex) => itemIndex === rowIndex ? { ...row, ...changes } : row),
    }));
  }

  function removeRow(itineraryId: string, rowIndex: number) {
    setItineraries((current) => current.map((itinerary) => itinerary.id !== itineraryId ? itinerary : {
      ...itinerary,
      rows: itinerary.rows.filter((_, itemIndex) => itemIndex !== rowIndex),
    }));
  }

  function toggleClaim(itineraryId: string, rowIndex: number, claimId: TevItineraryRow["claims"][number], checked: boolean) {
    const itinerary = itineraries.find((item) => item.id === itineraryId);
    const row = itinerary?.rows[rowIndex];
    if (!row) return;
    const claims = checked ? [...new Set([...row.claims, claimId])] : row.claims.filter((item) => item !== claimId);
    updateRow(itineraryId, rowIndex, { claims });
  }

  function toggleEvidence(option: string, checked: boolean) {
    setSelectedEvidence((current) => checked
      ? tevEvidenceOptions.filter((item) => current.includes(item.label) || item.label === option).map((item) => item.label)
      : current.filter((item) => item !== option));
    setMessage("");
  }

  function continueToItineraries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!profile.name || !profile.address || !profile.taxIdentificationNo || !profile.position) {
      setMessage("Complete your name, address, Tax Identification No., and position in Profile first.");
      return;
    }
    if (!monthDateBounds(month)) {
      setMessage("Choose a valid Month and Year.");
      return;
    }
    if (existingMonths.includes(month)) {
      setMessage(`A myTEV record already exists for ${monthLabel(month)}. Only one record is allowed per month and year.`);
      return;
    }
    if (!references.length || references.some((reference) => !reference.travelOrderNo.trim() || !reference.dateFrom || !reference.dateTo)) {
      setMessage("Enter a Travel Order No. and date range for each travel reference.");
      return;
    }
    if (references.some((reference) => !isDateWithinMonth(reference.dateFrom, month) || !isDateWithinMonth(reference.dateTo, month))) {
      setMessage(`Travel Order dates must fall within ${monthLabel(month)}.`);
      return;
    }
    if (references.some((reference) => reference.dateTo < reference.dateFrom)) {
      setMessage("Each Travel Order end date must be on or after its start date.");
      return;
    }
    if (!selectedEvidence.length) {
      setMessage("Select at least one evidence of travel.");
      return;
    }
    setStep("itineraries");
  }

  function normalizedItineraries() {
    const saved: TevItinerary[] = [];
    for (const [itineraryIndex, itinerary] of itineraries.entries()) {
      const rows = itinerary.rows.filter(hasRowData).map((row) => ({
        ...row,
        dateTo: row.dateTo && row.dateTo >= row.dateFrom ? row.dateTo : row.dateFrom,
        visitedPlaces: row.visitedPlaces.trim(),
        transportation: row.meansOfTransportation === "Not Applicable" ? "Not Applicable" : row.transportation.trim(),
      }));
      if (!rows.length) return { error: `Add at least one travel line to Itinerary ${itineraryIndex + 1}.` };
      if (rows.some((row) => (row.dateFrom && !isDateWithinMonth(row.dateFrom, month)) || (row.dateTo && !isDateWithinMonth(row.dateTo, month)))) {
        return { error: `Each date in Itinerary ${itineraryIndex + 1} must fall within ${monthLabel(month)}.` };
      }
      for (const [rowIndex, row] of rows.entries()) {
        if (!row.dateFrom || !row.dateTo || !row.visitedPlaces || !row.departureTimeFrom || !row.departureTimeTo) {
          return { error: `Complete the date, destination, and times for Itinerary ${itineraryIndex + 1}, row ${rowIndex + 1}.` };
        }
        if (!rates.some((rate) => rate.region === row.region)) {
          return { error: `Select a valid region for Itinerary ${itineraryIndex + 1}, row ${rowIndex + 1}.` };
        }
        if (!row.meansOfTransportation) {
          return { error: `Select the means of transportation for Itinerary ${itineraryIndex + 1}, row ${rowIndex + 1}.` };
        }
        if (isTevTransportationAmountRequired(row.meansOfTransportation) && !row.transportation) {
          return { error: `Enter the transportation amount for Itinerary ${itineraryIndex + 1}, row ${rowIndex + 1}.` };
        }
      }
      const dateValues = rows.flatMap((row) => [row.dateFrom, row.dateTo]).sort();
      saved.push({ ...itinerary, dateFrom: dateValues[0], dateTo: dateValues[dateValues.length - 1], rows });
    }
    return { itineraries: saved };
  }

  async function saveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!db) { setMessage("myTEV storage is unavailable."); return; }
    if (existingMonths.includes(month)) {
      setMessage(`A myTEV record already exists for ${monthLabel(month)}. Only one record is allowed per month and year.`);
      return;
    }
    const result = normalizedItineraries();
    if (result.error || !result.itineraries?.length) { setMessage(result.error ?? "Add at least one itinerary."); return; }
    const recordData = {
      ownerId,
      profile,
      month,
      officialStation,
      travelReferences: references.map((reference) => ({ ...reference, travelOrderNo: reference.travelOrderNo.trim() })),
      evidenceOfTravel: evidenceOfTravel.trim(),
      evidenceOfTravelOptions: tevEvidenceOptions.filter((option) => selectedEvidence.includes(option.label)).map((option) => option.label),
      divisionName,
      itineraries: result.itineraries,
    };
    setSaving(true);
    try {
      const firestore = db;
      if (initialRecord) {
        await updateDoc(doc(firestore, "myTevRecords", initialRecord.id), recordData);
        onSaved({ ...initialRecord, ...recordData });
      } else {
        const ownerRecords = await getDocs(query(collection(firestore, "myTevRecords"), where("ownerId", "==", ownerId)));
        if (ownerRecords.docs.some((item) => item.data().month === month)) throw new Error("MYTEV_MONTH_EXISTS");
        const recordId = `${ownerId}_${month}`;
        const reference = doc(firestore, "myTevRecords", recordId);
        await runTransaction(firestore, async (transaction) => {
          const existing = await transaction.get(reference);
          if (existing.exists()) throw new Error("MYTEV_MONTH_EXISTS");
          transaction.set(reference, { ...recordData, createdAt: serverTimestamp() });
        });
        onSaved({ ...recordData, id: recordId, createdAt: undefined });
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message === "MYTEV_MONTH_EXISTS") {
        setMessage(`A myTEV record already exists for ${monthLabel(month)}. Only one record is allowed per month and year.`);
        return;
      }
      const code = (cause as { code?: string }).code;
      setMessage(code ? `Could not save myTEV (${code}).` : "Could not save myTEV. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const recordTotals = totalsForRecord(itineraries, rates);

  return <section className="content-section mytev-form-section">
    <div className="section-heading"><div><p className="eyebrow">{initialRecord ? "Edit record · myTEV" : "New record · myTEV"}</p><h2>{initialRecord ? "Edit Travel Expense Voucher" : "Create Travel Expense Voucher"}</h2><p className="muted">Complete the trip details, then add itinerary lines. Long entries continue onto additional A4 pages automatically.</p></div><button type="button" className="ghost-button" onClick={onCancel}>Cancel</button></div>
    <ol className="mytev-stepper" aria-label="myTEV creation steps"><li className={step === "details" ? "is-current" : "is-complete"} aria-current={step === "details" ? "step" : undefined}><span>01</span>Trip details</li><li className={step === "itineraries" ? "is-current" : ""} aria-current={step === "itineraries" ? "step" : undefined}><span>02</span>Itineraries</li></ol>
    {message && <p className="mytev-form-message" role="alert">{message}</p>}
    {step === "details" ? <form className="mytev-form" onSubmit={continueToItineraries}>
      <section className="mytev-form-group"><h3>Official travel</h3><div className="mytev-trip-fields">
        <label>Official Station<select value={officialStation} onChange={(event) => setOfficialStation(event.target.value as TevOfficialStation)} required>{tevOfficialStations.map((station) => <option key={station} value={station}>{station}</option>)}</select></label>
        <label>Month and Year<input type="month" value={month} onChange={(event) => updateMonth(event.target.value)} disabled={Boolean(initialRecord)} required /></label>
        <label>Division<select value={divisionName} onChange={(event) => setDivisionName(event.target.value as TevDivision)} required>{tevDivisions.map((division) => <option key={division}>{division}</option>)}</select></label>
      </div></section>
      <section className="mytev-form-group"><div className="mytev-form-group-heading"><div><h3>Travel Order references</h3><p>Enter the travel order number and approved date range for each trip.</p></div><button type="button" className="ghost-button mytev-add-reference" disabled={references.length >= maxTravelReferences} onClick={() => setReferences((current) => [...current, blankTevTravelReference()])}>Add reference</button></div>
        <div className="mytev-reference-list">{references.map((reference, index) => <fieldset className="mytev-reference-row" key={`travel-reference-${index}`}><legend>Travel reference {index + 1}</legend>
          <label>Travel No.<input value={reference.travelOrderNo} onChange={(event) => updateReference(index, { travelOrderNo: event.target.value })} maxLength={40} required /></label>
          <label>TO Date (Records Unit)<input type="date" value={reference.toDateRecordsUnit} onChange={(event) => updateReference(index, { toDateRecordsUnit: event.target.value })} /></label>
          <label>Date From<input type="date" min={monthDateBounds(month)?.first} max={monthDateBounds(month)?.last} value={reference.dateFrom} onChange={(event) => {
            const value = isDateWithinMonth(event.target.value, month) ? event.target.value : "";
            const dateTo = reference.dateTo && isDateWithinMonth(reference.dateTo, month) && reference.dateTo >= value ? reference.dateTo : value;
            updateReference(index, { dateFrom: value, dateTo });
          }} required /></label>
          <label>Date To<input type="date" min={reference.dateFrom || monthDateBounds(month)?.first} max={monthDateBounds(month)?.last} value={reference.dateTo} onChange={(event) => {
            const value = isDateWithinMonth(event.target.value, month) && (!reference.dateFrom || event.target.value >= reference.dateFrom) ? event.target.value : "";
            updateReference(index, { dateTo: value });
          }} required /></label>
          {references.length > 1 && <button type="button" className="mytev-remove-reference remove-action" aria-label={`Remove travel reference ${index + 1}`} onClick={() => setReferences((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}
        </fieldset>)}</div>
        <fieldset className="mytev-evidence-picker"><legend>Evidence of Travel</legend><div className="mytev-evidence-options">{tevEvidenceOptions.map((option) => <label key={option.label}><input type="checkbox" checked={selectedEvidence.includes(option.label)} onChange={(event) => toggleEvidence(option.label, event.target.checked)} disabled={saving} /><span>{option.label}</span></label>)}</div></fieldset>
      </section>
      <div className="mytev-form-actions"><button type="button" className="ghost-button" onClick={onCancel}>Cancel</button><button className="primary-button">Continue</button></div>
    </form> : <form className="mytev-form mytev-itinerary-form" onSubmit={saveRecord}>
      {itineraries.map((itinerary, itineraryIndex) => {
        const rowLimitReached = itinerary.rows.length >= maxItineraryRows;
        const rowThirteenFilled = Boolean(itinerary.rows[maxItineraryRows - 1] && hasRowData(itinerary.rows[maxItineraryRows - 1]));
        return <section className="mytev-itinerary-editor" key={itinerary.id}>
          <div className="mytev-itinerary-editor-heading"><div><p className="eyebrow">Itinerary {String(itineraryIndex + 1).padStart(2, "0")}</p><h3>Itinerary of Travel</h3><p className="muted">Add travel lines as needed. Dense entries continue onto additional A4 pages automatically.</p></div>{itineraries.length > 1 && <button type="button" className="mytev-remove-itinerary remove-action" onClick={() => setItineraries((current) => current.filter((item) => item.id !== itinerary.id))}>Remove itinerary</button>}</div>
          <div className="mytev-itinerary-rows" role="group" aria-label={`Itinerary ${itineraryIndex + 1} fixed rows`}>
            {itinerary.rows.map((row, rowIndex) => <fieldset className="mytev-itinerary-line" key={`${itinerary.id}-row-${rowIndex}`}>
              <legend>Row {String(rowIndex + 1).padStart(2, "0")}</legend>
              <div className="mytev-itinerary-line-actions"><button type="button" className="mytev-remove-row remove-action" aria-label={`Remove itinerary ${itineraryIndex + 1}, row ${rowIndex + 1}`} onClick={() => removeRow(itinerary.id, rowIndex)}>Remove row</button></div>
              <div className="mytev-itinerary-row-top">
                <label>Date<input type="date" min={monthDateBounds(month)?.first} max={monthDateBounds(month)?.last} value={row.dateFrom} onChange={(event) => {
                  const value = isDateWithinMonth(event.target.value, month) ? event.target.value : "";
                  updateRow(itinerary.id, rowIndex, { dateFrom: value, dateTo: value });
                }} /></label>
                <label className="mytev-row-places">Visited Places<input value={row.visitedPlaces} maxLength={180} onChange={(event) => updateRow(itinerary.id, rowIndex, { visitedPlaces: event.target.value })} /></label>
                <label>Departure Time From<input type="time" value={row.departureTimeFrom} onChange={(event) => updateRow(itinerary.id, rowIndex, { departureTimeFrom: event.target.value })} /></label>
                <label>Departure Time To<input type="time" value={row.departureTimeTo} onChange={(event) => updateRow(itinerary.id, rowIndex, { departureTimeTo: event.target.value })} /></label>
              </div>
              <div className="mytev-itinerary-row-bottom">
                <label className="mytev-row-region">Region<select required={hasRowData(row)} value={row.region} onChange={(event) => updateRow(itinerary.id, rowIndex, { region: event.target.value })}><option value="">Select region</option>{rates.map((rate) => <option key={rate.region} value={rate.region}>{rate.region}</option>)}</select></label>
                <label className="mytev-row-means">Means of Transportation<select required={hasRowData(row)} value={row.meansOfTransportation} onChange={(event) => {
                  const means = event.target.value as TevItineraryRow["meansOfTransportation"];
                  updateRow(itinerary.id, rowIndex, { meansOfTransportation: means, transportation: means === "Not Applicable" ? "Not Applicable" : isTevTransportationAmountRequired(means) ? row.transportation : "" });
                }}><option value="">Select mode</option>{tevTransportationMeans.map((means) => <option key={means} value={means}>{means}</option>)}</select></label>
                <label className="mytev-row-transportation">Transportation{isTevTransportationAmountRequired(row.meansOfTransportation) ? <input type="number" min="0" step="0.01" inputMode="decimal" value={row.transportation} onChange={(event) => updateRow(itinerary.id, rowIndex, { transportation: event.target.value })} placeholder="0.00" /> : <span className="mytev-not-applicable">{row.meansOfTransportation === "Not Applicable" ? "Not Applicable" : "Not applicable"}</span>}</label>
              </div>
              <div className="mytev-itinerary-row-claims"><fieldset className="mytev-claim-picker"><legend>Claim / Per Diem</legend>{tevClaims.map((claim) => <label key={claim.id}><input type="checkbox" checked={row.claims.includes(claim.id)} disabled={!row.region} onChange={(event) => toggleClaim(itinerary.id, rowIndex, claim.id, event.target.checked)} /><span>{claim.label}{row.region && <small>₱{formatTevAmount(perDiemForClaims([claim.id], row.region, rates))}</small>}</span></label>)}</fieldset></div>
            </fieldset>)}
          </div>
          <div className="mytev-add-row-control">{!rowThirteenFilled && <button type="button" className="ghost-button mytev-add-row" disabled={rowLimitReached} onClick={() => setItineraries((current) => current.map((item) => item.id === itinerary.id && item.rows.length < maxItineraryRows ? { ...item, rows: [...item.rows, blankTevItineraryRow()] } : item))}>Add row</button>}<span>{itinerary.rows.length} {itinerary.rows.length === 1 ? "row" : "rows"} · {rowLimitReached ? "maximum reached" : "page breaks are automatic"}</span></div>
        </section>;
      })}
      <button type="button" className="ghost-button mytev-add-itinerary" disabled={itineraries.length >= maxItineraries} onClick={() => setItineraries((current) => [...current, blankTevItinerary(documentId())])}>{itineraries.length >= maxItineraries ? "Maximum itineraries added" : "Add another itinerary"}</button>
      <div className="mytev-record-totals"><span>Per Diem Grand Total<strong>₱{formatTevAmount(recordTotals.perDiem)}</strong></span><span>Transportation Grand Total<strong>₱{formatTevAmount(recordTotals.transportation)}</strong></span><span>Itinerary Grand Total<strong>₱{formatTevAmount(recordTotals.grandTotal)}</strong></span></div>
      <div className="mytev-form-actions"><button type="button" className="ghost-button" onClick={() => { setMessage(""); setStep("details"); }}>Back to Trip Details</button><button type="button" className="ghost-button" onClick={onCancel}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving..." : initialRecord ? "Save changes" : "Save"}</button></div>
    </form>}
  </section>;
}

function MyTevList({ records, loading, deletingId, rates, rateError, onNew, onEdit, onView, onDelete }: { records: MyTevRecord[]; loading: boolean; deletingId: string | null; rates: TevRegionRate[] | null; rateError: string; onNew: () => void; onEdit: (record: MyTevRecord) => void; onView: (record: MyTevRecord) => void; onDelete: (record: MyTevRecord) => void }) {
  const { currentPage, pageCount, visibleRecords, setPage } = useRecordPagination(records);
  return <section className="content-section mytev-list-section">
    <div className="section-heading"><div><p className="eyebrow">myDocs · Travel expenses</p><h2>myTEV</h2><p className="muted">Create and retrieve travel expense forms as one coordinated A4 document set.</p></div><button type="button" className="primary-button" onClick={onNew}>Add</button></div>
    {loading ? <p className="muted mytev-loading">Loading myTEV records...</p> : records.length === 0 ? <div className="empty-state mytev-empty"><span className="empty-number">00</span><h3>No myTEV records yet</h3><p>Create a travel expense voucher and its itinerary pages.</p><button type="button" className="text-button plain-action document-create-action" onClick={onNew}>Create a myTEV record</button></div> : <div className="permit-table mytev-table">
      <RecordPagination totalRecords={records.length} currentPage={currentPage} pageCount={pageCount} onPageChange={setPage} label="myTEV record" />
      <div className="mytev-table-head"><span>Travel month</span><span>Total amount</span><span aria-hidden="true" /></div>
      {visibleRecords.map((record) => <div className="mytev-table-row" key={record.id}>
        <strong>{monthLabel(record.month)}</strong><strong>{rates ? `₱${formatTevAmount(totalsForRecord(record.itineraries, rates).grandTotal)}` : rateError ? "Rates unavailable" : "Loading rates..."}</strong>
        <span className="mytev-row-actions"><button type="button" className="row-action" onClick={() => onEdit(record)}>Edit</button><button type="button" className="row-action" onClick={() => onView(record)}>View</button><button type="button" className="delete-button" disabled={deletingId !== null} onClick={() => onDelete(record)}>{deletingId === record.id ? "Deleting..." : "Delete"}</button></span>
      </div>)}
    </div>}
  </section>;
}

export default function MyTevModule({ user }: { user: User }) {
  const [records, setRecords] = useState<MyTevRecord[]>([]);
  const [profile, setProfile] = useState<TevProfile | null>(null);
  const [view, setView] = useState<"list" | "new" | "edit">("list");
  const [editingRecord, setEditingRecord] = useState<MyTevRecord | null>(null);
  const [preview, setPreview] = useState<MyTevRecord | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MyTevRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [regionRates, setRegionRates] = useState<TevRegionRate[] | null>(null);
  const [regionRateError, setRegionRateError] = useState("");
  const pagesRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    let active = true;
    loadTevRegionRates().then((rates) => {
      if (active) {
        setRegionRates(rates);
        setRegionRateError("");
      }
    }).catch(() => {
      if (active) setRegionRateError("Could not load regional per diem rates from tev_rate.csv. Refresh the page to try again.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const pages = pagesRef.current;
    if (!preview || !pages) return;

    const updatePageScale = () => {
      const frame = pages.querySelector<HTMLElement>(".mytev-paper-frame");
      const paper = frame?.querySelector<HTMLElement>(".mytev-paper");
      if (!frame || !paper) return;
      const paperWidth = Number.parseFloat(window.getComputedStyle(paper).width);
      if (!Number.isFinite(paperWidth) || paperWidth <= 0) return;
      const viewportWidth = window.innerWidth;
      const targetViewportWidth = viewportWidth * (viewportWidth <= 480 ? 0.94 : 0.9);
      const targetWidth = Math.min(paperWidth, targetViewportWidth, pages.clientWidth);
      pages.style.setProperty("--mytev-page-scale", String(targetWidth / paperWidth));
      pages.querySelectorAll<HTMLElement>(".mytev-paper-frame").forEach((pageFrame) => {
        pageFrame.style.width = `${targetWidth}px`;
      });
    };

    updatePageScale();
    const observer = new ResizeObserver(updatePageScale);
    observer.observe(pages);
    window.addEventListener("resize", updatePageScale);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePageScale);
      pages.style.removeProperty("--mytev-page-scale");
      pages.querySelectorAll<HTMLElement>(".mytev-paper-frame").forEach((pageFrame) => {
        pageFrame.style.removeProperty("width");
      });
    };
  }, [preview]);

  useEffect(() => {
    let active = true;
    const firestore = db;
    if (!firestore) {
      setLoadError("myTEV storage is unavailable.");
      setLoading(false);
      return () => { active = false; };
    }
    Promise.all([
      getDoc(doc(firestore, "users", user.uid)),
      getDocs(query(collection(firestore, "myTevRecords"), where("ownerId", "==", user.uid))),
    ]).then(([profileSnapshot, recordsSnapshot]) => {
      if (!active) return;
      const data = profileSnapshot.exists() ? profileSnapshot.data() : {};
      setProfile({
        name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : user.displayName ?? "",
        address: typeof data.address === "string" ? data.address.trim() : "",
        taxIdentificationNo: typeof data.taxIdentificationNo === "string" ? formatTaxIdentificationNo(data.taxIdentificationNo) : "",
        position: typeof data.position === "string" ? data.position.trim() : "",
        unit: typeof data.unit === "string" ? data.unit : "",
      });
      const loaded = recordsSnapshot.docs.map((item) => {
        const record = { id: item.id, ...item.data() } as MyTevRecord;
        return {
          ...record,
          profile: { ...record.profile, taxIdentificationNo: formatTaxIdentificationNo(record.profile.taxIdentificationNo) },
        };
      });
      loaded.sort((first, second) => timestampMillis(second.createdAt) - timestampMillis(first.createdAt));
      setRecords(loaded);
    }).catch((cause) => {
      const code = (cause as { code?: string }).code;
      if (active) setLoadError(code ? `Could not load myTEV records (${code}).` : "Could not load myTEV records. Refresh and try again.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user.uid, user.displayName]);

  async function deleteRecord(record: MyTevRecord) {
    if (!db) return;
    setDeletingId(record.id);
    setLoadError("");
    try {
      await deleteDoc(doc(db, "myTevRecords", record.id));
      setRecords((current) => current.filter((item) => item.id !== record.id));
      setPreview((current) => current?.id === record.id ? null : current);
      setPendingDelete(null);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setLoadError(code ? `Could not delete myTEV (${code}).` : "Could not delete myTEV.");
      setPendingDelete(null);
    } finally { setDeletingId(null); }
  }

  async function preparePages() {
    if (!pagesRef.current) throw new Error("The myTEV pages are not ready.");
    await Promise.all(Array.from(pagesRef.current.querySelectorAll("img")).map(async (image) => {
      if (!image.complete) await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("The DA Caraga logo could not be loaded."));
      });
      if (image.naturalWidth === 0) throw new Error("The DA Caraga logo could not be loaded.");
      if (image.decode) await image.decode();
    }));
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return Array.from(pagesRef.current.querySelectorAll<HTMLElement>(".mytev-paper"));
  }

  async function downloadPdf() {
    setDownloading(true);
    setPreviewError("");
    pagesRef.current?.classList.add("mytev-document-pages-export");
    try {
      const { html2canvas, jsPDF } = await loadPdfTools();
      const pages = await preparePages();
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      for (const [index, page] of pages.entries()) {
        const canvas = await html2canvas(page, { backgroundColor: "#fff", logging: false, scale: 3, useCORS: true });
        if (index > 0) pdf.addPage("a4", "portrait");
        pdf.addImage(canvas.toDataURL("image/jpeg", .97), "JPEG", 0, 0, 210, 297);
      }
      pdf.save(`mytev-${preview?.month ?? "travel"}-${preview?.id ?? "record"}.pdf`);
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : "Unable to create the myTEV PDF.");
    } finally {
      pagesRef.current?.classList.remove("mytev-document-pages-export");
      setDownloading(false);
    }
  }

  async function printPages() {
    setPrinting(true);
    setPreviewError("");
    try {
      await preparePages();
      window.print();
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : "Unable to prepare the myTEV pages for printing.");
    } finally { setPrinting(false); }
  }

  const profileComplete = Boolean(profile?.name && profile.address && profile.taxIdentificationNo && profile.position);
  const formProfile = view === "edit" ? editingRecord?.profile ?? null : profile;

  return <div className="mytev-module">
    {loadError && <p className="error-message mytev-error" role="alert">{loadError}</p>}
    {regionRateError && <p className="error-message mytev-error" role="alert">{regionRateError}</p>}
    {(view === "new" || view === "edit") && formProfile ? regionRates ? <MyTevForm key={editingRecord?.id ?? "new"} profile={formProfile} ownerId={user.uid} initialRecord={view === "edit" ? editingRecord ?? undefined : undefined} existingMonths={records.filter((record) => record.id !== editingRecord?.id).map((record) => record.month)} rates={regionRates} onCancel={() => { setEditingRecord(null); setView("list"); }} onSaved={(record) => { setRecords((current) => current.some((item) => item.id === record.id) ? current.map((item) => item.id === record.id ? record : item) : [record, ...current]); setEditingRecord(null); setView("list"); }} /> : <section className="content-section mytev-form-section"><p className="muted">{regionRateError || "Loading regional per diem rates..."}</p><button type="button" className="ghost-button" onClick={() => { setEditingRecord(null); setView("list"); }}>Back</button></section> : <>
      {!profileComplete && !loading && <div className="mytev-profile-warning" role="status"><strong>Complete your Profile before creating myTEV records.</strong><span>Address, Tax Identification No., position, and name are used to prepare these forms.</span></div>}
      <MyTevList records={records} loading={loading} deletingId={deletingId} rates={regionRates} rateError={regionRateError} onNew={() => { setLoadError(""); setEditingRecord(null); setView("new"); }} onEdit={(record) => { setLoadError(""); setEditingRecord(record); setView("edit"); }} onView={(record) => { if (!regionRates) { setRegionRateError(regionRateError || "Regional rates are still loading. Wait a moment, then open the record again."); return; } setPreview(record); setPreviewError(""); }} onDelete={setPendingDelete} />
    </>}
    <DeleteConfirmation open={Boolean(pendingDelete)} title="Delete this myTEV record?" description="This removes the record and its generated document set permanently." busy={Boolean(pendingDelete && deletingId === pendingDelete.id)} onCancel={() => setPendingDelete(null)} onConfirm={() => { if (pendingDelete) void deleteRecord(pendingDelete); }} />
    {preview && regionRates && <div className="preview-backdrop mytev-preview-backdrop"><div className="preview-toolbar"><span>myTEV preview · A4 document set</span><button type="button" className="ghost-button" onClick={() => { setPreview(null); setPreviewError(""); }}>Close</button><button type="button" className="pdf-button" disabled={downloading} onClick={() => void downloadPdf()}>{downloading ? "Preparing PDF..." : "Download PDF"}</button><button type="button" className="pdf-button" disabled={printing} onClick={() => void printPages()}>{printing ? "Preparing print..." : "Print"}</button>{previewError && <small className="download-error" role="alert">{previewError}</small>}</div><div ref={pagesRef} className="mytev-document-pages"><MyTevDocuments record={preview} rates={regionRates} /></div></div>}
  </div>;
}

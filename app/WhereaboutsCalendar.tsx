"use client";

import { useEffect, useState } from "react";
import { collection, doc, getDocs, onSnapshot, query, setDoc, where, type Firestore } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import { isPermitAdmin } from "./PermitSlipAdmin";
import "./whereabouts-calendar.css";

type ApprovedTravelOrder = {
  id: string;
  status: string;
  people: { name: string; position?: string; salary?: string; toNumber?: string }[];
  departureDate: string;
  returnDate: string;
  purpose: string;
  placeOfTravel: string;
  chargeTo?: string;
};
type ApprovedPermitSlip = {
  id: string;
  status: string;
  permitNo: string;
  name: string;
  date: string;
  purpose: string;
  unit?: string;
};
type StoredPermit = {
  id: string;
  permitNo: string;
  permitNos?: string[];
  date: string;
  names?: string[];
  name?: string;
  purpose: string;
  unit?: string;
  personStatuses?: Record<string, { status?: string }>;
};

type PermitUnitFilter = "All" | "AGRISTAT" | "AMIA" | "DRRM";

function normalizeUnit(value?: string): Exclude<PermitUnitFilter, "All"> | "" {
  const unit = value?.trim().toUpperCase();
  if (unit === "AGRISTAT" || unit === "AGRICULTURAL STATISTICS") return "AGRISTAT";
  if (unit === "AMIA") return "AMIA";
  if (unit === "DRRM") return "DRRM";
  return "";
}

async function publishExistingApprovedPermits(firestore: Firestore) {
  const [permitSnapshot, calendarSnapshot] = await Promise.all([
    getDocs(collection(firestore, "permits")),
    getDocs(collection(firestore, "approvedPermitCalendar")),
  ]);
  const existingCalendarIds = new Set(calendarSnapshot.docs.map((item) => item.id));
  const missingEntries: { id: string; data: Omit<ApprovedPermitSlip, "id"> & { permitId: string; statusKey: string } }[] = [];

  permitSnapshot.docs.forEach((item) => {
    const permit = { id: item.id, ...item.data() } as StoredPermit;
    const names = Array.isArray(permit.names) ? permit.names : permit.name ? [permit.name] : [];
    names.forEach((name, index) => {
      const permitNo = permit.permitNos?.[index] ?? permit.permitNo;
      const statusKey = permit.permitNos?.[index] ?? (names.length > 1 ? `${permit.permitNo}__person_${index + 1}` : permit.permitNo);
      const calendarId = `${permit.id}_${encodeURIComponent(statusKey)}`;
      if (permit.personStatuses?.[statusKey]?.status !== "Approved" || existingCalendarIds.has(calendarId) || !permit.date || !name) return;
      missingEntries.push({
        id: calendarId,
        data: { permitId: permit.id, statusKey, status: "Approved", permitNo, name, date: permit.date, purpose: permit.purpose ?? "", unit: permit.unit ?? "" },
      });
    });
  });

  for (let index = 0; index < missingEntries.length; index += 20) {
    await Promise.all(missingEntries.slice(index, index + 20).map(({ id, data }) => setDoc(doc(firestore, "approvedPermitCalendar", id), data)));
  }
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatCalendarDate(value: string, options: Intl.DateTimeFormatOptions = { month: "long", day: "numeric", year: "numeric" }) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", options).format(new Date(year, month - 1, day));
}

export default function WhereaboutsCalendarModule({ user }: { user: User }) {
  const today = new Date();
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const [orders, setOrders] = useState<ApprovedTravelOrder[]>([]);
  const [permitSlips, setPermitSlips] = useState<ApprovedPermitSlip[]>([]);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [nameSearch, setNameSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState<PermitUnitFilter>("All");
  const [selectedPeoplePage, setSelectedPeoplePage] = useState(0);
  const [permitPage, setPermitPage] = useState(0);
  const [travelPage, setTravelPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { setSelectedPeoplePage(0); }, [selectedDate]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setOrders([]);
    setPermitSlips([]);
    setError("");
    if (!db) { setError("Firebase is not configured."); setLoading(false); return () => { active = false; }; }
    const firestore = db;
    if (isPermitAdmin(user.email)) {
      void publishExistingApprovedPermits(firestore).catch((cause) => {
        const code = (cause as { code?: string }).code;
        if (active) setError(code ? `Could not sync approved Permit Slips (${code}).` : "Could not sync approved Permit Slips.");
      });
    }
    const initialSources = new Set(["travel", "permits"]);
    const finishInitialLoad = (source: string) => {
      initialSources.delete(source);
      if (active && initialSources.size === 0) setLoading(false);
    };
    const unsubscribeTravel = onSnapshot(query(collection(firestore, "travelOrders"), where("status", "==", "Approved")), (snapshot) => {
      const approved = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as ApprovedTravelOrder))
        .filter((order) => order.status === "Approved" && order.departureDate && order.returnDate);
      if (active) setOrders(approved);
      finishInitialLoad("travel");
    }, (cause) => {
      const code = (cause as { code?: string }).code;
      if (active) setError(code ? `Could not load approved travel (${code}).` : "Could not load approved travel. Refresh and try again.");
      finishInitialLoad("travel");
    });
    const unsubscribePermits = onSnapshot(collection(firestore, "approvedPermitCalendar"), (snapshot) => {
      const approved = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as ApprovedPermitSlip))
        .filter((permit) => permit.status === "Approved" && permit.date && permit.name);
      if (active) setPermitSlips(approved);
      finishInitialLoad("permits");
    }, (cause) => {
      const code = (cause as { code?: string }).code;
      if (active) setError(code ? `Could not load approved Permit Slips (${code}).` : "Could not load approved Permit Slips. Refresh and try again.");
      finishInitialLoad("permits");
    });
    return () => { active = false; unsubscribeTravel(); unsubscribePermits(); };
  }, [user.uid, user.email]);

  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const monthName = new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(month);
  const leadingDays = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cellCount = Math.ceil((leadingDays + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const day = index - leadingDays + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });

  function ordersOnDate(key: string) {
    return orders.filter((order) => order.departureDate <= key && order.returnDate >= key);
  }

  function peopleOnDate(key: string) {
    return ordersOnDate(key).reduce((total, order) => total + Math.max(order.people?.length ?? 0, 1), 0)
      + permitSlips.filter((permit) => permit.date === key).length;
  }

  function changeMonth(offset: number) {
    const next = new Date(year, monthIndex + offset, 1);
    setMonth(next);
    setSelectedDate(dateKey(next.getFullYear(), next.getMonth(), 1));
    setSelectedPeoplePage(0);
    setPermitPage(0);
    setTravelPage(0);
  }

  const selectedOrders = ordersOnDate(selectedDate);
  const selectedPermitSlips = permitSlips.filter((permit) => permit.date === selectedDate);
  const selectedPeople = [
    ...selectedOrders.flatMap((order) => {
      const people: ApprovedTravelOrder["people"] = order.people?.length ? order.people : [{ name: "Not specified" }];
      return people.map((person, index) => ({
        id: `travel-${order.id}-${index}`,
        type: "Travel Order",
        name: person.name || "Not specified",
        number: person.toNumber || "",
        date: `${formatCalendarDate(order.departureDate)} – ${formatCalendarDate(order.returnDate)}`,
        purpose: order.purpose || "—",
        destination: order.placeOfTravel || "—",
      }));
    }),
    ...selectedPermitSlips.map((permit) => ({
      id: `permit-${permit.id}`,
      type: "Permit Slip",
      name: permit.name,
      number: "",
      date: formatCalendarDate(permit.date),
      purpose: permit.purpose || "—",
      destination: "",
    })),
  ];
  const selectedPeoplePageSize = 8;
  const selectedPeoplePageCount = Math.max(1, Math.ceil(selectedPeople.length / selectedPeoplePageSize));
  const currentSelectedPeoplePage = Math.min(selectedPeoplePage, selectedPeoplePageCount - 1);
  const visibleSelectedPeople = selectedPeople.slice(currentSelectedPeoplePage * selectedPeoplePageSize, currentSelectedPeoplePage * selectedPeoplePageSize + selectedPeoplePageSize);
  const summaryYear = String(year);
  const yearStart = `${summaryYear}-01-01`;
  const yearEnd = `${summaryYear}-12-31`;
  const normalizedSearch = nameSearch.trim().toLocaleLowerCase();
  const annualPermits = permitSlips
    .filter((permit) => permit.date >= yearStart && permit.date <= yearEnd)
    .filter((permit) => !normalizedSearch || (permit.name ?? "").toLocaleLowerCase().includes(normalizedSearch))
    .filter((permit) => unitFilter === "All" || normalizeUnit(permit.unit) === unitFilter)
    .sort((left, right) => right.date.localeCompare(left.date) || right.name.localeCompare(left.name));
  const annualOrders = orders
    .filter((order) => order.departureDate <= yearEnd && order.returnDate >= yearStart)
    .filter((order) => !normalizedSearch || (order.people ?? []).some((person) => (person.name ?? "").toLocaleLowerCase().includes(normalizedSearch)))
    .filter((order) => unitFilter === "All" || normalizeUnit(order.chargeTo) === unitFilter)
    .sort((left, right) => right.departureDate.localeCompare(left.departureDate) || right.returnDate.localeCompare(left.returnDate));
  const permitPageCount = Math.max(1, Math.ceil(annualPermits.length / 10));
  const travelPageCount = Math.max(1, Math.ceil(annualOrders.length / 10));
  const currentPermitPage = Math.min(permitPage, permitPageCount - 1);
  const currentTravelPage = Math.min(travelPage, travelPageCount - 1);
  const visibleAnnualPermits = annualPermits.slice(currentPermitPage * 10, currentPermitPage * 10 + 10);
  const visibleAnnualOrders = annualOrders.slice(currentTravelPage * 10, currentTravelPage * 10 + 10);
  return <section className="content-section whereabouts-calendar-section">
    <div className="section-heading whereabouts-heading"><div><p className="eyebrow">Approved travel and Permit Slips</p><h2>Whereabouts Calendar</h2><p className="muted">Select a shaded date to view approved Travel Orders and Permit Slips.</p></div></div>
    {error && <div className="error-message whereabouts-error">{error}</div>}
    <section className="whereabouts-calendar" aria-label="Approved Travel Order and Permit Slip calendar">
      <header className="whereabouts-calendar-toolbar"><button type="button" className="whereabouts-month-arrow" aria-label="Previous month" onClick={() => changeMonth(-1)}>‹</button><h3>{monthName}</h3><button type="button" className="whereabouts-month-arrow" aria-label="Next month" onClick={() => changeMonth(1)}>›</button><button type="button" className="whereabouts-today-button" onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(todayKey); setSelectedPeoplePage(0); setPermitPage(0); setTravelPage(0); }}>Today</button></header>
      <div className="whereabouts-weekdays" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name) => <span key={name}>{name}</span>)}</div>
      <div className="whereabouts-days">
        {cells.map((day, index) => {
          if (day === null) return <span className="whereabouts-day whereabouts-day-empty" aria-hidden="true" key={`blank-${index}`} />;
          const key = dateKey(year, monthIndex, day);
          const peopleCount = peopleOnDate(key);
          const selected = selectedDate === key;
          const level = peopleCount > 4 ? 3 : peopleCount > 1 ? 2 : peopleCount > 0 ? 1 : 0;
          const classes = ["whereabouts-day", level ? `whereabouts-day-level-${level}` : "", selected ? "whereabouts-day-selected" : ""].filter(Boolean).join(" ");
          const label = `${formatCalendarDate(key, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${peopleCount ? `, ${peopleCount} approved ${peopleCount === 1 ? "person or Permit Slip" : "people or Permit Slips"}` : ", no approved travel or Permit Slips"}`;
          return <button type="button" className={classes} aria-label={label} aria-pressed={selected} key={key} onClick={() => { setSelectedDate(key); setSelectedPeoplePage(0); }}><span className="whereabouts-day-number">{day}</span>{peopleCount > 0 && <span className="whereabouts-day-count">{peopleCount}</span>}</button>;
        })}
      </div>
      <div className="whereabouts-legend"><span><i className="whereabouts-legend-level-1" />1 person or Permit Slip</span><span><i className="whereabouts-legend-level-2" />2–4 people or Permit Slips</span><span><i className="whereabouts-legend-level-3" />5+ people or Permit Slips</span></div>
    </section>
    <section className="whereabouts-date-details" aria-live="polite">
      <div className="whereabouts-details-heading"><div><p className="eyebrow">Selected date</p><h3>{formatCalendarDate(selectedDate)}</h3></div><span className="whereabouts-detail-count">{loading ? "Loading..." : `${selectedPeople.length} approved ${selectedPeople.length === 1 ? "person" : "people"}`}</span></div>
      {loading ? <p className="muted">Loading approved Travel Orders and Permit Slips...</p> : selectedPeople.length === 0 ? <p className="whereabouts-empty-date">No approved travel or Permit Slips on this date.</p> : <>
        <div className="whereabouts-date-table-wrap"><table className="whereabouts-date-table"><thead><tr><th>Person</th><th>Date</th><th>Purpose / Destination</th></tr></thead><tbody>
          {visibleSelectedPeople.map((person) => <tr key={person.id}><td><span className="whereabouts-date-person-type">{person.type}</span><strong>{person.name}{person.number && ` (${person.number})`}</strong></td><td>{person.date}</td><td className="whereabouts-date-purpose">{person.purpose}{person.destination && <small>{person.destination}</small>}</td></tr>)}
        </tbody></table></div>
        {selectedPeoplePageCount > 1 && <nav className="whereabouts-pagination" aria-label="Selected date people pages"><button type="button" onClick={() => setSelectedPeoplePage((page) => Math.max(0, page - 1))} disabled={currentSelectedPeoplePage === 0}>Previous</button><span aria-live="polite">Page {currentSelectedPeoplePage + 1} of {selectedPeoplePageCount}</span><button type="button" onClick={() => setSelectedPeoplePage((page) => Math.min(selectedPeoplePageCount - 1, page + 1))} disabled={currentSelectedPeoplePage >= selectedPeoplePageCount - 1}>Next</button></nav>}
      </>}
    </section>
    <section className="whereabouts-annual-summary" aria-label={`Approved Permit Slip and Travel Order summaries for ${summaryYear}`}>
      <header className="whereabouts-summary-heading"><div><p className="eyebrow">Annual summary</p><h2>Approved Records — {summaryYear}</h2><p className="muted">Search by name and filter by unit. Tables show 10 records per page, newest first.</p></div></header>
      <div className="whereabouts-summary-filters">
        <label>Name search<input type="search" value={nameSearch} onChange={(event) => { setNameSearch(event.target.value); setPermitPage(0); setTravelPage(0); }} placeholder="Search by name" /></label>
        <label>Unit<select value={unitFilter} onChange={(event) => { setUnitFilter(event.target.value as PermitUnitFilter); setPermitPage(0); setTravelPage(0); }}><option value="All">All units</option><option value="AGRISTAT">Agricultural Statistics</option><option value="AMIA">AMIA</option><option value="DRRM">DRRM</option></select></label>
      </div>
      <section className="whereabouts-summary-table-section" aria-labelledby="whereabouts-permit-summary-title">
        <div className="whereabouts-summary-table-heading"><h3 id="whereabouts-permit-summary-title">Approved Permit Slip</h3><span>{annualPermits.length === 0 ? "0 records" : `${currentPermitPage * 10 + 1}–${Math.min(currentPermitPage * 10 + visibleAnnualPermits.length, annualPermits.length)} of ${annualPermits.length}`}</span></div>
        <div className="whereabouts-summary-table-wrap"><table className="whereabouts-summary-table"><thead><tr><th>Date</th><th>Name</th><th>Purpose</th></tr></thead><tbody>
          {visibleAnnualPermits.map((permit) => <tr key={`annual-permit-${permit.id}`}><td>{formatCalendarDate(permit.date)}</td><td>{permit.name}</td><td>{permit.purpose || "—"}</td></tr>)}
          {!loading && visibleAnnualPermits.length === 0 && <tr><td className="whereabouts-summary-empty" colSpan={3}>No approved Permit Slips match this year and filter.</td></tr>}
          {loading && <tr><td className="whereabouts-summary-empty" colSpan={3}>Loading approved Permit Slips…</td></tr>}
        </tbody></table></div>
        {permitPageCount > 1 && <nav className="whereabouts-pagination" aria-label="Approved Permit Slip pages"><button type="button" onClick={() => setPermitPage((page) => Math.max(0, page - 1))} disabled={currentPermitPage === 0}>Previous</button><span aria-live="polite">Page {currentPermitPage + 1} of {permitPageCount}</span><button type="button" onClick={() => setPermitPage((page) => Math.min(permitPageCount - 1, page + 1))} disabled={currentPermitPage >= permitPageCount - 1}>Next</button></nav>}
      </section>
      <section className="whereabouts-summary-table-section" aria-labelledby="whereabouts-travel-summary-title">
        <div className="whereabouts-summary-table-heading"><h3 id="whereabouts-travel-summary-title">Approved Travel Order</h3><span>{annualOrders.length === 0 ? "0 records" : `${currentTravelPage * 10 + 1}–${Math.min(currentTravelPage * 10 + visibleAnnualOrders.length, annualOrders.length)} of ${annualOrders.length}`}</span></div>
        <div className="whereabouts-summary-table-wrap"><table className="whereabouts-summary-table"><thead><tr><th>Name</th><th>Departure From To</th><th>Destination</th><th>Purpose</th></tr></thead><tbody>
          {visibleAnnualOrders.map((order) => <tr key={`annual-travel-${order.id}`}><td>{(order.people ?? []).map((person) => person.name).filter(Boolean).join(", ") || "Not specified"}</td><td>{formatCalendarDate(order.departureDate)} – {formatCalendarDate(order.returnDate)}</td><td>{order.placeOfTravel || "—"}</td><td>{order.purpose || "—"}</td></tr>)}
          {!loading && visibleAnnualOrders.length === 0 && <tr><td className="whereabouts-summary-empty" colSpan={4}>No approved Travel Orders match this year and filter.</td></tr>}
          {loading && <tr><td className="whereabouts-summary-empty" colSpan={4}>Loading approved Travel Orders…</td></tr>}
        </tbody></table></div>
        {travelPageCount > 1 && <nav className="whereabouts-pagination" aria-label="Approved Travel Order pages"><button type="button" onClick={() => setTravelPage((page) => Math.max(0, page - 1))} disabled={currentTravelPage === 0}>Previous</button><span aria-live="polite">Page {currentTravelPage + 1} of {travelPageCount}</span><button type="button" onClick={() => setTravelPage((page) => Math.min(travelPageCount - 1, page + 1))} disabled={currentTravelPage >= travelPageCount - 1}>Next</button></nav>}
      </section>
    </section>
  </section>;
}

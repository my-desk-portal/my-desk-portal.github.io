"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import "./whereabouts-calendar.css";

type ApprovedTravelOrder = {
  id: string;
  status: string;
  people: { name: string; position?: string; salary?: string; toNumber?: string }[];
  departureDate: string;
  returnDate: string;
  purpose: string;
  placeOfTravel: string;
};

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
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setOrders([]);
    setError("");
    if (!db) { setError("Firebase is not configured."); setLoading(false); return () => { active = false; }; }
    getDocs(query(collection(db, "travelOrders"), where("status", "==", "Approved"))).then((snapshot) => {
      const approved = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as ApprovedTravelOrder))
        .filter((order) => order.status === "Approved" && order.departureDate && order.returnDate);
      if (active) setOrders(approved);
    }).catch((cause) => {
      const code = (cause as { code?: string }).code;
      if (active) setError(code ? `Could not load approved travel (${code}).` : "Could not load approved travel. Refresh and try again.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user.uid]);

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
    return ordersOnDate(key).reduce((total, order) => total + Math.max(order.people?.length ?? 0, 1), 0);
  }

  function changeMonth(offset: number) {
    const next = new Date(year, monthIndex + offset, 1);
    setMonth(next);
    setSelectedDate(dateKey(next.getFullYear(), next.getMonth(), 1));
  }

  const selectedOrders = ordersOnDate(selectedDate);
  return <section className="content-section whereabouts-calendar-section">
    <div className="section-heading whereabouts-heading"><div><p className="eyebrow">Approved travel only</p><h2>Whereabouts Calendar</h2><p className="muted">Select a shaded date to view approved Travel Orders and assigned personnel.</p></div></div>
    {error && <div className="error-message whereabouts-error">{error}</div>}
    <section className="whereabouts-calendar" aria-label="Approved travel calendar">
      <header className="whereabouts-calendar-toolbar"><button type="button" className="whereabouts-month-arrow" aria-label="Previous month" onClick={() => changeMonth(-1)}>‹</button><h3>{monthName}</h3><button type="button" className="whereabouts-month-arrow" aria-label="Next month" onClick={() => changeMonth(1)}>›</button><button type="button" className="whereabouts-today-button" onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(todayKey); }}>Today</button></header>
      <div className="whereabouts-weekdays" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name) => <span key={name}>{name}</span>)}</div>
      <div className="whereabouts-days">
        {cells.map((day, index) => {
          if (day === null) return <span className="whereabouts-day whereabouts-day-empty" aria-hidden="true" key={`blank-${index}`} />;
          const key = dateKey(year, monthIndex, day);
          const peopleCount = peopleOnDate(key);
          const selected = selectedDate === key;
          const level = peopleCount > 4 ? 3 : peopleCount > 1 ? 2 : peopleCount > 0 ? 1 : 0;
          const classes = ["whereabouts-day", level ? `whereabouts-day-level-${level}` : "", selected ? "whereabouts-day-selected" : ""].filter(Boolean).join(" ");
          const label = `${formatCalendarDate(key, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${peopleCount ? `, ${peopleCount} assigned ${peopleCount === 1 ? "person" : "people"}` : ", no approved travel"}`;
          return <button type="button" className={classes} aria-label={label} aria-pressed={selected} key={key} onClick={() => setSelectedDate(key)}><span className="whereabouts-day-number">{day}</span>{peopleCount > 0 && <span className="whereabouts-day-count">{peopleCount}</span>}</button>;
        })}
      </div>
      <div className="whereabouts-legend"><span><i className="whereabouts-legend-level-1" />1 person</span><span><i className="whereabouts-legend-level-2" />2–4 people</span><span><i className="whereabouts-legend-level-3" />5+ people</span></div>
    </section>
    <section className="whereabouts-date-details" aria-live="polite">
      <div className="whereabouts-details-heading"><div><p className="eyebrow">Selected date</p><h3>{formatCalendarDate(selectedDate)}</h3></div><span className="whereabouts-detail-count">{loading ? "Loading…" : `${selectedOrders.length} ${selectedOrders.length === 1 ? "approved order" : "approved orders"}`}</span></div>
      {loading ? <p className="muted">Loading approved Travel Orders…</p> : selectedOrders.length === 0 ? <p className="whereabouts-empty-date">No approved travel on this date.</p> : <div className="whereabouts-order-list">{selectedOrders.map((order) => <article className="whereabouts-order-card" key={order.id}>
        <dl><div><dt>Name / Names</dt><dd>{(order.people ?? []).map((person) => person.name ? `${person.name}${person.toNumber ? ` (${person.toNumber})` : ""}` : "").filter(Boolean).join(", ") || "Not specified"}</dd></div><div><dt>Departure to Return</dt><dd>{formatCalendarDate(order.departureDate)} – {formatCalendarDate(order.returnDate)}</dd></div><div><dt>Purpose</dt><dd>{order.purpose}</dd></div><div><dt>Destination</dt><dd>{order.placeOfTravel}</dd></div></dl>
      </article>)}</div>}
    </section>
  </section>;
}

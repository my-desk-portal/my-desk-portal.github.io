"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, onSnapshot, query, setDoc, where, writeBatch, type Firestore } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import { isPermitAdmin } from "./PermitSlipAdmin";
import { LEGACY_PENDING_STATUS, normalizeWorkflowStatus } from "./workflow-status";
import { assignApprovedPermitNumbers, displayPermitNumber } from "./permit-number";
import "./whereabouts-calendar.css";

type CalendarTravelOrder = {
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
type ApprovedLeaveApplication = {
  id: string;
  leaveApplicationId: string;
  ownerId: string;
  status: string;
  firstName?: string;
  middleInitial?: string;
  lastName?: string;
  name?: string;
  office: string;
  leaveType: string;
  inclusiveDateFrom: string;
  inclusiveDateTo: string;
};
type ApprovedActivityCalendar = {
  id: string;
  unit: string;
  month: string;
  preparedName?: string;
  activities: { dateFrom: string; dateTo: string; activity: string; location: string; responsiblePeople?: { name: string }[] }[];
};
type StoredPermit = {
  id: string;
  permitNo: string;
  permitNos?: string[];
  date: string;
  names?: string[];
  name?: string;
  personUnits?: string[];
  purpose: string;
  unit?: string;
  personStatuses?: Record<string, { status?: string }>;
};

type PermitUnitFilter = "All" | "AGRISTAT" | "AMIA" | "DRRM";
type SelectedCalendarEntry = {
  id: string;
  type: "Travel Order" | "Permit Slip" | "Leave Application";
  statuses: string[];
  names: string[];
  date: string;
  purpose: string;
  destination: string;
  unit?: string;
};

function normalizeUnit(value?: string): Exclude<PermitUnitFilter, "All"> | "" {
  const unit = value?.trim().toUpperCase();
  if (unit === "AGRISTAT" || unit === "FOD-AGRISTAT" || unit === "AGRICULTURAL STATISTICS") return "AGRISTAT";
  if (unit === "AMIA" || unit === "FOD-AMIA") return "AMIA";
  if (unit === "DRRM" || unit === "FOD-DRRM") return "DRRM";
  return "";
}

function displayUnit(value?: string) {
  const unit = normalizeUnit(value);
  return unit ? `FOD-${unit}` : value?.trim() ?? "";
}

function leaveApplicantName(leave: ApprovedLeaveApplication) {
  if (leave.firstName && leave.lastName) {
    return [leave.firstName.trim(), leave.middleInitial?.trim(), leave.lastName.trim()].filter(Boolean).join(" ");
  }
  const storedName = leave.name?.trim() ?? "";
  if (!storedName) return "";
  const comma = storedName.indexOf(",");
  const last = comma < 0 ? "" : storedName.slice(0, comma).trim();
  const given = (comma < 0 ? storedName : storedName.slice(comma + 1)).trim().split(/\s+/).filter(Boolean);
  if (!given.length) return storedName;
  const first = given[0];
  const parsedLast = last || (given.length > 1 ? given[given.length - 1] : "");
  const middleName = last ? given.slice(1).join(" ") : given.slice(1, -1).join(" ");
  const initialSource = middleName.split(/\s+/)[0]?.replace(/\.+$/, "");
  const initial = initialSource ? `${Array.from(initialSource)[0].toLocaleUpperCase()}.` : "";
  return [first, initial, parsedLast].filter(Boolean).join(" ");
}

function middleInitial(value: string) {
  const first = value.trim().split(/\s+/)[0]?.replace(/\.+$/, "");
  const initial = first ? Array.from(first)[0] : "";
  return initial ? `${initial.toLocaleUpperCase()}.` : "";
}

function parseLeaveName(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  const comma = trimmed.indexOf(",");
  if (comma >= 0) {
    const lastName = trimmed.slice(0, comma).trim();
    const given = trimmed.slice(comma + 1).trim().split(" ").filter(Boolean);
    return { firstName: given[0] ?? "", middleName: given.slice(1).join(" "), lastName };
  }
  const parts = trimmed.split(" ").filter(Boolean);
  return { firstName: parts[0] ?? "", middleName: parts.slice(1, -1).join(" "), lastName: parts.length > 1 ? parts[parts.length - 1] : "" };
}

function leaveApplicationPurpose(leave: ApprovedLeaveApplication) {
  return leave.leaveType;
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
        data: { permitId: permit.id, statusKey, status: "Approved", permitNo, name, date: permit.date, purpose: permit.purpose ?? "", unit: permit.personUnits?.[index] ?? permit.unit ?? "" },
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

function formatCalendarDateRange(from: string, to: string) {
  if (!from || !to) return [formatCalendarDate(from), formatCalendarDate(to)].filter(Boolean).join(" - ");
  if (from === to) return formatCalendarDate(from);

  const [startYear, startMonth, startDay] = from.split("-").map(Number);
  const [endYear, endMonth, endDay] = to.split("-").map(Number);
  const startMonthName = formatCalendarDate(from, { month: "long" });
  const endMonthName = formatCalendarDate(to, { month: "long" });
  if (startYear === endYear && startMonth === endMonth) {
    return `${startMonthName} ${startDay}-${endDay}, ${startYear}`;
  }

  const startDate = `${startMonthName} ${startDay}${startYear === endYear ? "" : `, ${startYear}`}`;
  return `${startDate} - ${endMonthName} ${endDay}, ${endYear}`;
}

export default function WhereaboutsCalendarModule({ user }: { user: User }) {
  const today = new Date();
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const [orders, setOrders] = useState<CalendarTravelOrder[]>([]);
  const [permitSlips, setPermitSlips] = useState<ApprovedPermitSlip[]>([]);
  const [leaveApplications, setLeaveApplications] = useState<ApprovedLeaveApplication[]>([]);
  const [activityCalendars, setActivityCalendars] = useState<ApprovedActivityCalendar[]>([]);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [nameSearch, setNameSearch] = useState("");
  const [documentFilter, setDocumentFilter] = useState<"permit" | "travel" | "leave" | "activities">("permit");
  const [unitFilter, setUnitFilter] = useState<PermitUnitFilter>("All");
  const [selectedPeoplePage, setSelectedPeoplePage] = useState(0);
  const [permitPage, setPermitPage] = useState(0);
  const [travelPage, setTravelPage] = useState(0);
  const [leavePage, setLeavePage] = useState(0);
  const [activitiesPage, setActivitiesPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const approvedPermitNumbers = useMemo(() => assignApprovedPermitNumbers(permitSlips), [permitSlips]);

  useEffect(() => { setSelectedPeoplePage(0); }, [selectedDate]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setOrders([]);
    setPermitSlips([]);
    setLeaveApplications([]);
    setActivityCalendars([]);
    setError("");
    if (!db) { setError("Firebase is not configured."); setLoading(false); return () => { active = false; }; }
    const firestore = db;
    if (isPermitAdmin(user.email)) {
      void publishExistingApprovedPermits(firestore).catch((cause) => {
        const code = (cause as { code?: string }).code;
        if (active) setError(code ? `Could not sync approved Permit Slips (${code}).` : "Could not sync approved Permit Slips.");
      });
    }
    const initialSources = new Set(["travel", "permits", "leave", "leave-backfill"]);
    const finishInitialLoad = (source: string) => {
      initialSources.delete(source);
      if (active && initialSources.size === 0) setLoading(false);
    };
    const unsubscribeTravel = onSnapshot(query(collection(firestore, "travelOrders"), where("status", "in", ["Approved", "Pending", LEGACY_PENDING_STATUS])), (snapshot) => {
      const calendarOrders = snapshot.docs.map((item) => {
        const data = item.data();
        return { id: item.id, ...data, status: normalizeWorkflowStatus(data.status) } as CalendarTravelOrder;
      }).filter((order) => order.departureDate && order.returnDate);
      if (active) setOrders(calendarOrders);
      finishInitialLoad("travel");
    }, (cause) => {
      const code = (cause as { code?: string }).code;
      if (active) setError(code ? `Could not load Travel Orders (${code}).` : "Could not load Travel Orders. Refresh and try again.");
      finishInitialLoad("travel");
    });
    const unsubscribeActivityCalendars = onSnapshot(query(collection(firestore, "calendarOfActivities"), where("status", "==", "Approved")), (snapshot) => {
      const approved = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as ApprovedActivityCalendar))
        .filter((calendar) => calendar.month && Array.isArray(calendar.activities));
      if (active) setActivityCalendars(approved);
    }, (cause) => {
      const code = (cause as { code?: string }).code;
      if (active) setError(code ? `Could not load Calendar of Activities (${code}).` : "Could not load Calendar of Activities. Refresh and try again.");
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
    const unsubscribeLeaveApplications = onSnapshot(query(collection(firestore, "approvedLeaveCalendar"), where("status", "in", ["Approved", "Pending"])), (snapshot) => {
      const approved = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as ApprovedLeaveApplication))
        .filter((leave) => ["Approved", "Pending"].includes(leave.status)
          && leave.inclusiveDateFrom && leave.inclusiveDateTo && ((leave.firstName && leave.lastName) || leave.name));
      if (active) setLeaveApplications(approved);
      finishInitialLoad("leave");
    }, (cause) => {
      const code = (cause as { code?: string }).code;
      if (active) setError(code ? `Could not load Leave Applications (${code}).` : "Could not load Leave Applications. Refresh and try again.");
      finishInitialLoad("leave");
    });
    let legacyLeaveBackfillComplete = false;
    const unsubscribeLeaveBackfill = onSnapshot(query(collection(firestore, "leaveApplications"), where("ownerId", "==", user.uid)), { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache || legacyLeaveBackfillComplete) return;
      legacyLeaveBackfillComplete = true;
      const activeLeaveRecords = snapshot.docs.flatMap((item) => {
        const data = item.data();
        if (!(data.status === "Approved" || data.status === "Pending")
          || typeof data.name !== "string" || !data.name.trim()
          || typeof data.office !== "string" || typeof data.leaveType !== "string"
          || typeof data.inclusiveDateFrom !== "string" || typeof data.inclusiveDateTo !== "string") return [];
        const parsedName = parseLeaveName(data.name);
        const firstName = typeof data.firstName === "string" ? data.firstName : parsedName.firstName;
        const middleName = typeof data.middleName === "string" ? data.middleName : parsedName.middleName;
        const lastName = typeof data.lastName === "string" ? data.lastName : parsedName.lastName;
        return [{ leaveApplicationId: item.id, ownerId: user.uid, status: data.status, firstName, middleInitial: middleInitial(middleName), lastName, office: data.office, leaveType: data.leaveType, inclusiveDateFrom: data.inclusiveDateFrom, inclusiveDateTo: data.inclusiveDateTo }];
      });
      void (async () => {
        for (let index = 0; index < activeLeaveRecords.length; index += 10) {
          const batch = writeBatch(firestore);
          activeLeaveRecords.slice(index, index + 10).forEach((record) => {
            batch.set(doc(firestore, "approvedLeaveCalendar", record.leaveApplicationId), record);
          });
          await batch.commit();
        }
      })().then(() => finishInitialLoad("leave-backfill")).catch((cause) => {
        const code = (cause as { code?: string }).code;
        if (active) setError(code ? `Could not sync existing Leave Applications (${code}).` : "Could not sync existing Leave Applications.");
        finishInitialLoad("leave-backfill");
      });
    }, (cause) => {
      const code = (cause as { code?: string }).code;
      if (active) setError(code ? `Could not sync existing Leave Applications (${code}).` : "Could not sync existing Leave Applications.");
      finishInitialLoad("leave-backfill");
    });
    return () => { active = false; unsubscribeTravel(); unsubscribeActivityCalendars(); unsubscribePermits(); unsubscribeLeaveApplications(); unsubscribeLeaveBackfill(); };
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
      + permitSlips.filter((permit) => permit.date === key).length
      + leaveApplications.filter((leave) => leave.inclusiveDateFrom <= key && leave.inclusiveDateTo >= key).length;
  }

  function hasPendingItemOnDate(key: string) {
    return orders.some((order) => order.status === "Pending" && order.departureDate <= key && order.returnDate >= key)
      || leaveApplications.some((leave) => leave.status === "Pending" && leave.inclusiveDateFrom <= key && leave.inclusiveDateTo >= key);
  }

  function hasApprovedItemOnDate(key: string) {
    return orders.some((order) => order.status === "Approved" && order.departureDate <= key && order.returnDate >= key)
      || permitSlips.some((permit) => permit.date === key)
      || leaveApplications.some((leave) => leave.status === "Approved" && leave.inclusiveDateFrom <= key && leave.inclusiveDateTo >= key);
  }

  function changeMonth(offset: number) {
    const next = new Date(year, monthIndex + offset, 1);
    setMonth(next);
    setSelectedDate(dateKey(next.getFullYear(), next.getMonth(), 1));
    setSelectedPeoplePage(0);
    setPermitPage(0);
    setTravelPage(0);
    setLeavePage(0);
  }

  const selectedOrders = ordersOnDate(selectedDate);
  const selectedPermitSlips = permitSlips.filter((permit) => permit.date === selectedDate);
  const selectedPeopleEntries = [
    ...selectedOrders.flatMap((order) => {
      const people: CalendarTravelOrder["people"] = order.people?.length ? order.people : [{ name: "Not specified" }];
      return people.map((person, index) => ({
        id: `travel-${order.id}-${index}`,
        type: "Travel Order",
        status: order.status,
        name: person.name || "Not specified",
        number: person.toNumber?.trim() ? `TO No. ${person.toNumber.trim()}` : "",
        date: formatCalendarDateRange(order.departureDate, order.returnDate),
        purpose: order.purpose || "—",
        destination: order.placeOfTravel || "—",
        unit: order.chargeTo || "",
      }));
    }),
    ...selectedPermitSlips.map((permit) => ({
      id: `permit-${permit.id}`,
      type: "Permit Slip",
      status: permit.status,
      name: permit.name,
      number: permit.permitNo ? `PS No. ${approvedPermitNumbers[displayPermitNumber(permit.permitNo)] ?? displayPermitNumber(permit.permitNo)}` : "",
      date: formatCalendarDate(permit.date),
      purpose: permit.purpose || "—",
      destination: "",
      unit: permit.unit || "",
    })),
    ...leaveApplications.filter((leave) => leave.inclusiveDateFrom <= selectedDate && leave.inclusiveDateTo >= selectedDate).map((leave) => ({
      id: `leave-${leave.id}`,
      type: "Leave Application",
      status: leave.status,
      name: leaveApplicantName(leave) || "Not specified",
      number: "",
      date: formatCalendarDateRange(leave.inclusiveDateFrom, leave.inclusiveDateTo),
      purpose: leaveApplicationPurpose(leave),
      destination: "",
      unit: leave.office || "",
    })),
  ];
  const selectedPeopleByDetails = new Map<string, SelectedCalendarEntry>();
  selectedPeopleEntries.forEach((person) => {
    const entry: SelectedCalendarEntry = {
      id: person.id,
      type: person.type as SelectedCalendarEntry["type"],
      statuses: [person.status],
      names: [`${person.name}${person.number ? ` (${person.number})` : ""}`],
      date: person.date,
      purpose: person.purpose,
      destination: person.destination,
      unit: person.unit,
    };
    const key = entry.type === "Leave Application" ? entry.id : JSON.stringify([entry.type, entry.date, entry.purpose, entry.destination, entry.unit]);
    const existing = selectedPeopleByDetails.get(key);
    if (existing) {
      existing.names.push(...entry.names);
      existing.statuses = [...new Set([...existing.statuses, ...entry.statuses])];
    } else {
      selectedPeopleByDetails.set(key, entry);
    }
  });
  const selectedPeople = [...selectedPeopleByDetails.values()];
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
    .filter((order) => order.status === "Approved")
    .filter((order) => order.departureDate <= yearEnd && order.returnDate >= yearStart)
    .filter((order) => !normalizedSearch || (order.people ?? []).some((person) => (person.name ?? "").toLocaleLowerCase().includes(normalizedSearch)))
    .filter((order) => unitFilter === "All" || normalizeUnit(order.chargeTo) === unitFilter)
    .sort((left, right) => right.departureDate.localeCompare(left.departureDate) || right.returnDate.localeCompare(left.returnDate));
  const annualLeaveApplications = leaveApplications
    .filter((leave) => leave.status === "Approved")
    .filter((leave) => leave.inclusiveDateFrom <= yearEnd && leave.inclusiveDateTo >= yearStart)
    .filter((leave) => !normalizedSearch || leaveApplicantName(leave).toLocaleLowerCase().includes(normalizedSearch))
    .filter((leave) => unitFilter === "All" || normalizeUnit(leave.office) === unitFilter)
    .sort((left, right) => right.inclusiveDateFrom.localeCompare(left.inclusiveDateFrom) || leaveApplicantName(left).localeCompare(leaveApplicantName(right)));
  const permitPageCount = Math.max(1, Math.ceil(annualPermits.length / 10));
  const travelPageCount = Math.max(1, Math.ceil(annualOrders.length / 10));
  const leavePageCount = Math.max(1, Math.ceil(annualLeaveApplications.length / 10));
  const annualActivityCalendars = activityCalendars
    .filter((calendar) => calendar.month.startsWith(`${summaryYear}-`))
    .filter((calendar) => !normalizedSearch || calendar.activities.some((activity) => (activity.responsiblePeople ?? []).some((person) => (person.name ?? "").toLocaleLowerCase().includes(normalizedSearch))))
    .filter((calendar) => unitFilter === "All" || normalizeUnit(calendar.unit) === unitFilter)
    .sort((left, right) => right.month.localeCompare(left.month) || (left.unit ?? "").localeCompare(right.unit ?? ""));
  const activitiesPageCount = Math.max(1, Math.ceil(annualActivityCalendars.length / 10));
  const currentActivitiesPage = Math.min(activitiesPage, activitiesPageCount - 1);
  const visibleActivityCalendars = annualActivityCalendars.slice(currentActivitiesPage * 10, currentActivitiesPage * 10 + 10);
  const currentPermitPage = Math.min(permitPage, permitPageCount - 1);
  const currentTravelPage = Math.min(travelPage, travelPageCount - 1);
  const currentLeavePage = Math.min(leavePage, leavePageCount - 1);
  const visibleAnnualPermits = annualPermits.slice(currentPermitPage * 10, currentPermitPage * 10 + 10);
  const visibleAnnualOrders = annualOrders.slice(currentTravelPage * 10, currentTravelPage * 10 + 10);
  const visibleAnnualLeaveApplications = annualLeaveApplications.slice(currentLeavePage * 10, currentLeavePage * 10 + 10);
  return <section className="content-section whereabouts-calendar-section">
    <div className="section-heading whereabouts-heading"><div><p className="eyebrow">Travel, Leave, and Permit Records</p><h2>Whereabouts Calendar</h2><p className="muted">Select a shaded date to view pending or approved Travel Orders and Leave Applications, plus approved Permit Slips.</p></div></div>
    {error && <div className="error-message whereabouts-error">{error}</div>}
    <section className="whereabouts-calendar" aria-label="Travel Order, Leave Application, and Permit Slip calendar">
      <header className="whereabouts-calendar-toolbar"><button type="button" className="whereabouts-month-arrow" aria-label="Previous month" onClick={() => changeMonth(-1)}>‹</button><h3>{monthName}</h3><button type="button" className="whereabouts-month-arrow" aria-label="Next month" onClick={() => changeMonth(1)}>›</button><button type="button" className="whereabouts-today-button" onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(todayKey); setSelectedPeoplePage(0); setPermitPage(0); setTravelPage(0); setLeavePage(0); }}>Today</button></header>
      <div className="whereabouts-weekdays" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name) => <span key={name}>{name}</span>)}</div>
      <div className="whereabouts-days">
        {cells.map((day, index) => {
          if (day === null) return <span className="whereabouts-day whereabouts-day-empty" aria-hidden="true" key={`blank-${index}`} />;
          const key = dateKey(year, monthIndex, day);
          const peopleCount = peopleOnDate(key);
          const selected = selectedDate === key;
          const level = peopleCount > 4 ? 3 : peopleCount > 1 ? 2 : peopleCount > 0 ? 1 : 0;
          const hasPending = hasPendingItemOnDate(key);
          const hasApproved = hasApprovedItemOnDate(key);
          const statusClass = hasPending ? (hasApproved ? "whereabouts-day-mixed-status" : "whereabouts-day-pending") : "";
          const classes = ["whereabouts-day", level ? `whereabouts-day-level-${level}` : "", statusClass, selected ? "whereabouts-day-selected" : ""].filter(Boolean).join(" ");
          const label = `${formatCalendarDate(key, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${peopleCount ? `, ${peopleCount} ${peopleCount === 1 ? "person or calendar record" : "people or calendar records"}` : ", no Travel Orders, Permit Slips, or Leave Applications"}${hasPending ? ", includes a Pending Travel Order or Leave Application" : ""}`;
          return <button type="button" className={classes} aria-label={label} aria-pressed={selected} key={key} onClick={() => { setSelectedDate(key); setSelectedPeoplePage(0); }}><span className="whereabouts-day-number">{day}</span>{peopleCount > 0 && <span className="whereabouts-day-count">{peopleCount}</span>}</button>;
        })}
      </div>
      <div className="whereabouts-legend"><span><i className="whereabouts-legend-pending" />Pending Travel Order or Leave Application</span><span><i className="whereabouts-legend-mixed" />Approved and Pending</span><span><i className="whereabouts-legend-level-1" />1 person or calendar record</span><span><i className="whereabouts-legend-level-2" />2–4 people or calendar records</span><span><i className="whereabouts-legend-level-3" />5+ people or calendar records</span></div>
    </section>
    <section className="whereabouts-date-details" aria-live="polite">
      <div className="whereabouts-details-heading"><div><p className="eyebrow">Selected date</p><h3>{formatCalendarDate(selectedDate)}</h3></div><span className="whereabouts-detail-count">{loading ? "Loading..." : `${selectedPeople.length} ${selectedPeople.length === 1 ? "entry" : "entries"}`}</span></div>
      {loading ? <p className="muted">Loading Travel Orders, Permit Slips, and Leave Applications...</p> : selectedPeople.length === 0 ? <p className="whereabouts-empty-date">No Travel Orders, Permit Slips, or Leave Applications on this date.</p> : <>
        <div className="whereabouts-date-table-wrap"><table className="whereabouts-date-table"><thead><tr><th>Person</th><th>Date</th><th>Purpose / Destination</th></tr></thead><tbody>
          {visibleSelectedPeople.map((person) => <tr key={person.id}><td><span className="whereabouts-date-person-type">{person.type}</span>{person.statuses.map((status) => <span key={status} className={`whereabouts-status-label whereabouts-status-label-${status.toLowerCase()}`}>{status}</span>)}<strong>{person.names.join(", ")}</strong>{person.unit && <small>{displayUnit(person.unit)}</small>}</td><td>{person.date}</td><td className="whereabouts-date-purpose">{person.purpose}{person.destination && <small>{person.destination}</small>}</td></tr>)}
        </tbody></table></div>
        {selectedPeoplePageCount > 1 && <nav className="whereabouts-pagination" aria-label="Selected date people pages"><button type="button" onClick={() => setSelectedPeoplePage((page) => Math.max(0, page - 1))} disabled={currentSelectedPeoplePage === 0}>Previous</button><span aria-live="polite">Page {currentSelectedPeoplePage + 1} of {selectedPeoplePageCount}</span><button type="button" onClick={() => setSelectedPeoplePage((page) => Math.min(selectedPeoplePageCount - 1, page + 1))} disabled={currentSelectedPeoplePage >= selectedPeoplePageCount - 1}>Next</button></nav>}
      </>}
    </section>
    <section className="whereabouts-annual-summary" aria-label={`Whereabouts records for ${summaryYear}`}>
      <header className="whereabouts-summary-heading"><div><p className="eyebrow">Annual summary</p><h2>Approved Records — {summaryYear}</h2><p className="muted">Approved Travel Orders, Permit Slips, Leave Applications, and Calendar of Activities. Search by name and filter by unit; tables show 10 records per page, newest first.</p></div></header>
      <div className="whereabouts-summary-filters">
        <label>Approved document<select value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value as "permit" | "travel" | "leave" | "activities")}><option value="permit">Permit Slips</option><option value="travel">Travel Orders</option><option value="leave">Leave Applications</option><option value="activities">Calendar of Activities</option></select></label>
        <label>Name search<input type="search" value={nameSearch} onChange={(event) => { setNameSearch(event.target.value); setPermitPage(0); setTravelPage(0); setLeavePage(0); setActivitiesPage(0); }} placeholder="Search by Name" /></label>
        <label>Unit<select value={unitFilter} onChange={(event) => { setUnitFilter(event.target.value as PermitUnitFilter); setPermitPage(0); setTravelPage(0); setLeavePage(0); setActivitiesPage(0); }}><option value="All">All Units</option><option value="AGRISTAT">FOD-AGRISTAT</option><option value="AMIA">FOD-AMIA</option><option value="DRRM">FOD-DRRM</option></select></label>
      </div>
      {documentFilter === "permit" && <section className="whereabouts-summary-table-section" aria-labelledby="whereabouts-permit-summary-title">
        <div className="whereabouts-summary-table-heading"><h3 id="whereabouts-permit-summary-title">Approved Permit Slips</h3><span>{annualPermits.length === 0 ? "0 records" : `${currentPermitPage * 10 + 1}–${Math.min(currentPermitPage * 10 + visibleAnnualPermits.length, annualPermits.length)} of ${annualPermits.length}`}</span></div>
        <div className="whereabouts-summary-table-wrap"><table className="whereabouts-summary-table"><thead><tr><th>Date</th><th>Name</th><th>Unit</th><th>Purpose</th></tr></thead><tbody>
          {visibleAnnualPermits.map((permit) => <tr key={`annual-permit-${permit.id}`}><td>{formatCalendarDate(permit.date)}</td><td>{permit.name}{permit.permitNo ? ` (PS No. ${approvedPermitNumbers[displayPermitNumber(permit.permitNo)] ?? displayPermitNumber(permit.permitNo)})` : ""}</td><td>{permit.unit ? displayUnit(permit.unit) : "—"}</td><td>{permit.purpose || "—"}</td></tr>)}
          {!loading && visibleAnnualPermits.length === 0 && <tr><td className="whereabouts-summary-empty" colSpan={4}>No approved Permit Slips match this year and filter.</td></tr>}
          {loading && <tr><td className="whereabouts-summary-empty" colSpan={4}>Loading approved Permit Slips…</td></tr>}
        </tbody></table></div>
        {permitPageCount > 1 && <nav className="whereabouts-pagination" aria-label="Approved Permit Slips pages"><button type="button" onClick={() => setPermitPage((page) => Math.max(0, page - 1))} disabled={currentPermitPage === 0}>Previous</button><span aria-live="polite">Page {currentPermitPage + 1} of {permitPageCount}</span><button type="button" onClick={() => setPermitPage((page) => Math.min(permitPageCount - 1, page + 1))} disabled={currentPermitPage >= permitPageCount - 1}>Next</button></nav>}
      </section>}
      {documentFilter === "travel" && <section className="whereabouts-summary-table-section" aria-labelledby="whereabouts-travel-summary-title">
        <div className="whereabouts-summary-table-heading"><h3 id="whereabouts-travel-summary-title">Approved Travel Orders</h3><span>{annualOrders.length === 0 ? "0 records" : `${currentTravelPage * 10 + 1}–${Math.min(currentTravelPage * 10 + visibleAnnualOrders.length, annualOrders.length)} of ${annualOrders.length}`}</span></div>
        <div className="whereabouts-summary-table-wrap"><table className="whereabouts-summary-table"><thead><tr><th>Name</th><th>Departure From To</th><th>Destination</th><th>Purpose</th></tr></thead><tbody>
          {visibleAnnualOrders.map((order) => <tr key={`annual-travel-${order.id}`}><td>{(order.people ?? []).map((person) => person.name ? `${person.name}${person.toNumber?.trim() ? ` (TO No. ${person.toNumber.trim()})` : ""}` : "").filter(Boolean).join(", ") || "Not specified"}</td><td>{formatCalendarDateRange(order.departureDate, order.returnDate)}</td><td>{order.placeOfTravel || "—"}</td><td>{order.purpose || "—"}</td></tr>)}
          {!loading && visibleAnnualOrders.length === 0 && <tr><td className="whereabouts-summary-empty" colSpan={4}>No Travel Orders match this year and filter.</td></tr>}
          {loading && <tr><td className="whereabouts-summary-empty" colSpan={4}>Loading Travel Orders…</td></tr>}
        </tbody></table></div>
        {travelPageCount > 1 && <nav className="whereabouts-pagination" aria-label="Travel Order pages"><button type="button" onClick={() => setTravelPage((page) => Math.max(0, page - 1))} disabled={currentTravelPage === 0}>Previous</button><span aria-live="polite">Page {currentTravelPage + 1} of {travelPageCount}</span><button type="button" onClick={() => setTravelPage((page) => Math.min(travelPageCount - 1, page + 1))} disabled={currentTravelPage >= travelPageCount - 1}>Next</button></nav>}
      </section>}
      {documentFilter === "leave" && <section className="whereabouts-summary-table-section" aria-labelledby="whereabouts-leave-summary-title">
        <div className="whereabouts-summary-table-heading"><h3 id="whereabouts-leave-summary-title">Approved Leave Applications</h3><span>{annualLeaveApplications.length === 0 ? "0 records" : `${currentLeavePage * 10 + 1}–${Math.min(currentLeavePage * 10 + visibleAnnualLeaveApplications.length, annualLeaveApplications.length)} of ${annualLeaveApplications.length}`}</span></div>
        <div className="whereabouts-summary-table-wrap"><table className="whereabouts-summary-table"><thead><tr><th>Name</th><th>Inclusive Dates</th><th>Office</th><th>Type of Leave</th></tr></thead><tbody>
          {visibleAnnualLeaveApplications.map((leave) => <tr key={`annual-leave-${leave.id}`}><td>{leaveApplicantName(leave)}</td><td>{formatCalendarDateRange(leave.inclusiveDateFrom, leave.inclusiveDateTo)}</td><td>{displayUnit(leave.office) || "—"}</td><td>{leave.leaveType}</td></tr>)}
          {!loading && visibleAnnualLeaveApplications.length === 0 && <tr><td className="whereabouts-summary-empty" colSpan={4}>No approved Leave Applications match this year and filter.</td></tr>}
          {loading && <tr><td className="whereabouts-summary-empty" colSpan={4}>Loading approved Leave Applications…</td></tr>}
        </tbody></table></div>
        {leavePageCount > 1 && <nav className="whereabouts-pagination" aria-label="Approved Leave Applications pages"><button type="button" onClick={() => setLeavePage((page) => Math.max(0, page - 1))} disabled={currentLeavePage === 0}>Previous</button><span aria-live="polite">Page {currentLeavePage + 1} of {leavePageCount}</span><button type="button" onClick={() => setLeavePage((page) => Math.min(leavePageCount - 1, page + 1))} disabled={currentLeavePage >= leavePageCount - 1}>Next</button></nav>}
      </section>}
      {documentFilter === "activities" && <section className="whereabouts-summary-table-section" aria-labelledby="whereabouts-activities-summary-title">
        <div className="whereabouts-summary-table-heading"><h3 id="whereabouts-activities-summary-title">Approved Calendar of Activities</h3><span>{annualActivityCalendars.length === 0 ? "0 records" : `${currentActivitiesPage * 10 + 1}–${Math.min(currentActivitiesPage * 10 + visibleActivityCalendars.length, annualActivityCalendars.length)} of ${annualActivityCalendars.length}`}</span></div>
        <div className="whereabouts-summary-table-wrap"><table className="whereabouts-summary-table whereabouts-activities-table"><thead><tr><th>Month</th><th>Unit</th><th>Activities</th></tr></thead><tbody>
          {visibleActivityCalendars.map((calendar) => <tr key={`annual-activities-${calendar.id}`}><td>{formatCalendarDate(`${calendar.month}-01`, { month: "long", year: "numeric" })}</td><td>{displayUnit(calendar.unit) || "—"}</td><td>{calendar.activities.map((activity, index) => <p key={index}><strong>{`${formatCalendarDateRange(activity.dateFrom, activity.dateTo).replace(/,? \d{4}/g, "")}:`}</strong>{` ${activity.activity}${activity.location ? ` (${activity.location})` : ""}`}</p>)}</td></tr>)}
          {!loading && visibleActivityCalendars.length === 0 && <tr><td className="whereabouts-summary-empty" colSpan={3}>No approved Calendar of Activities match this year and filter.</td></tr>}
          {loading && <tr><td className="whereabouts-summary-empty" colSpan={3}>Loading Calendar of Activities…</td></tr>}
        </tbody></table></div>
        {activitiesPageCount > 1 && <nav className="whereabouts-pagination" aria-label="Calendar of Activities pages"><button type="button" onClick={() => setActivitiesPage((page) => Math.max(0, page - 1))} disabled={currentActivitiesPage === 0}>Previous</button><span aria-live="polite">Page {currentActivitiesPage + 1} of {activitiesPageCount}</span><button type="button" onClick={() => setActivitiesPage((page) => Math.min(activitiesPageCount - 1, page + 1))} disabled={currentActivitiesPage >= activitiesPageCount - 1}>Next</button></nav>}
      </section>}
    </section>
  </section>;
}

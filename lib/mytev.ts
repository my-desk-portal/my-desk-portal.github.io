export const tevEntityName = "Department of Agriculture - Regional Field Office XIII";
export const tevFundCluster = "1";
export const tevPurpose = "Please see attached Travel Orders";
export const tevOrsOffice = "Department of Agriculture - Regional Field Office XIII";
export const tevOrsOfficeAddress = "Capitol Site, Butuan City, Agusan del Norte";
export const tevCtcDirector = "Engr. Ricardo M. Oñate Jr.";
export const maxItineraryRows = 18;
export const maxCenrrRows = 28;
export const maxOrsStatusRows = 27;
export const tevOrsBudgetSignatory = { name: "Fatima D. Campos", position: "Chief, Budget Section" };
export const tevDvAccountingSignatory = { name: "Jane V. Mamba", position: "Accounting Section", designation: "Head, Accounting Unit/Authorized Representative" };
export const tevDvApprovingSignatory = { name: "Primitiva O. Arquion", position: "Chief, Admin and Finance Division", designation: "Agency Head/Authorized Representative" };

export const tevOfficialStations = [
  "Department of Agriculture - Regional Office XIII",
  "Department of Agriculture - Integrated Laboratories Division Caraga",
] as const;

export const tevDivisions = [
  "Field Operations Division",
  "Planning, Monitoring and Evaluation Division",
  "Administrative Division",
  "Finance Division",
  "Agribusiness and Marketing Assistance Division",
  "Regional Agricultural Engineering Division",
  "Research Division",
  "Regulatory Division",
  "Integrated Laboratories Division",
] as const;

export const tevTransportationMeans = ["RP", "Plane", "Boat", "MCH", "PUV", "PUB"] as const;

export const tevClaims = [
  { id: "lodging", label: "Hotel / Lodging", amount: 750 },
  { id: "breakfast", label: "Breakfast", amount: 150 },
  { id: "lunch", label: "Lunch", amount: 150 },
  { id: "dinner", label: "Dinner", amount: 150 },
  { id: "incidental", label: "Incidental Fee", amount: 300 },
] as const;

export type TevOfficialStation = (typeof tevOfficialStations)[number];
export type TevDivision = (typeof tevDivisions)[number];
export type TevTransportationMeans = (typeof tevTransportationMeans)[number] | "";
export type TevClaimId = (typeof tevClaims)[number]["id"];

export type TevProfile = {
  name: string;
  address: string;
  taxIdentificationNo: string;
  position: string;
  unit: string;
};

export type TevTravelReference = {
  travelOrderNo: string;
  dateFrom: string;
  dateTo: string;
};

export type TevItineraryRow = {
  dateFrom: string;
  dateTo: string;
  visitedPlaces: string;
  departureTimeFrom: string;
  departureTimeTo: string;
  claims: TevClaimId[];
  meansOfTransportation: TevTransportationMeans;
  transportation: string;
};

export type TevItinerary = {
  id: string;
  dateFrom: string;
  dateTo: string;
  rows: TevItineraryRow[];
};

export type MyTevRecord = {
  id: string;
  ownerId: string;
  createdAt?: unknown;
  profile: TevProfile;
  month: string;
  officialStation: TevOfficialStation;
  travelReferences: TevTravelReference[];
  evidenceOfTravel: string;
  divisionName: TevDivision;
  itineraries: TevItinerary[];
};

export type TevTotals = { perDiem: number; transportation: number; grandTotal: number };

const transportNeedsAmount: TevTransportationMeans[] = ["Boat", "MCH", "PUV", "PUB"];
const signatoryByDivision: Record<TevDivision, { name: string; position: "Chief" | "OIC" }> = {
  "Field Operations Division": { name: "Melody M. Guimary", position: "Chief" },
  "Planning, Monitoring and Evaluation Division": { name: "Gemma A. Asufre", position: "Chief" },
  "Administrative Division": { name: "Claide Jane D. Calamba", position: "OIC" },
  "Finance Division": { name: "Primitiva O. Arquion", position: "Chief" },
  "Agribusiness and Marketing Assistance Division": { name: "Lynn A. Pareñas", position: "Chief" },
  "Regional Agricultural Engineering Division": { name: "Engr. Rene Q. Morales", position: "Chief" },
  "Research Division": { name: "Edelmira R. Luminarias", position: "Chief" },
  "Regulatory Division": { name: "Johnny M. Concon", position: "Chief" },
  "Integrated Laboratories Division": { name: "Esther Lyn P. Felicilda", position: "Chief" },
};

export function blankTevTravelReference(): TevTravelReference {
  return { travelOrderNo: "", dateFrom: "", dateTo: "" };
}

export function blankTevItineraryRow(): TevItineraryRow {
  return {
    dateFrom: "",
    dateTo: "",
    visitedPlaces: "",
    departureTimeFrom: "",
    departureTimeTo: "",
    claims: [],
    meansOfTransportation: "",
    transportation: "",
  };
}

export function blankTevItinerary(id: string): TevItinerary {
  return {
    id,
    dateFrom: "",
    dateTo: "",
    rows: [blankTevItineraryRow()],
  };
}

export function stationAddress(station: TevOfficialStation) {
  return station === tevOfficialStations[1]
    ? "Purok - 8, Brgy. Taguibo, Butuan City, Agusan del Norte"
    : tevOrsOfficeAddress;
}

export function divisionForUnit(_unit: string) {
  return "Field Operations Division";
}

export function divisionSignatory(division: TevDivision) {
  return signatoryByDivision[division];
}

export function chargedToForUnit(unit: string) {
  if (unit === "AGRISTAT" || unit === "FOD-AGRISTAT") return "Agricultural Statistics Funds";
  if (unit === "AMIA" || unit === "FOD-AMIA") return "AMIA Funds";
  if (unit === "DRRM" || unit === "FOD-DRRM") return "DRRM Funds";
  return "Field Operations Division Funds";
}

export function numberAmount(value: string | number) {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export function perDiemForClaims(claims: TevClaimId[]) {
  return tevClaims.reduce((total, claim) => total + (claims.includes(claim.id) ? claim.amount : 0), 0);
}

export function transportationForRow(row: TevItineraryRow) {
  return transportNeedsAmount.includes(row.meansOfTransportation) ? numberAmount(row.transportation) : 0;
}

export function totalsForItinerary(itinerary: TevItinerary): TevTotals {
  const perDiem = itinerary.rows.reduce((total, row) => total + perDiemForClaims(row.claims), 0);
  const transportation = itinerary.rows.reduce((total, row) => total + transportationForRow(row), 0);
  return { perDiem, transportation, grandTotal: perDiem + transportation };
}

export function totalsForRecord(itineraries: TevItinerary[]): TevTotals {
  return itineraries.reduce<TevTotals>((totals, itinerary) => {
    const current = totalsForItinerary(itinerary);
    return {
      perDiem: totals.perDiem + current.perDiem,
      transportation: totals.transportation + current.transportation,
      grandTotal: totals.grandTotal + current.grandTotal,
    };
  }, { perDiem: 0, transportation: 0, grandTotal: 0 });
}

export function cenrrRows(itineraries: TevItinerary[]) {
  return itineraries.flatMap((itinerary) => itinerary.rows
    .filter((row) => row.meansOfTransportation === "MCH" && Boolean(row.dateFrom || row.dateTo || row.visitedPlaces || row.transportation))
    .map((row) => ({ ...row, amount: transportationForRow(row) })));
}

export function formatTevDate(value: string, options: Intl.DateTimeFormatOptions = { month: "long", day: "numeric", year: "numeric" }) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-PH", { ...options, timeZone: "UTC" }).format(date);
}

export function formatTevDateRange(from: string, to: string) {
  if (!from) return formatTevDate(to);
  if (!to || from === to) return formatTevDate(from);
  return `${formatTevDate(from)} - ${formatTevDate(to)}`;
}

export function formatTevTime(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return value;
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

export function formatTevAmount(value: number) {
  return new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function joinTevList(values: string[], conjunction = "and") {
  if (values.length < 2) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")}, ${conjunction} ${values[values.length - 1]}`;
}

export function formatTevTravelOrderNumbers(references: TevTravelReference[]) {
  return joinTevList(references.map((reference) => reference.travelOrderNo.trim()).filter(Boolean));
}

export function formatTevTravelDateRanges(references: TevTravelReference[]) {
  const ranges = references.filter((reference) => reference.dateFrom || reference.dateTo);
  if (!ranges.length) return "";
  const parse = (value: string) => {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const parsed = ranges.map((reference) => ({ from: parse(reference.dateFrom), to: parse(reference.dateTo) }));
  if (parsed.some((range) => !range.from || !range.to)) {
    return joinTevList(ranges.map((reference) => formatTevDateRange(reference.dateFrom, reference.dateTo)), "&");
  }
  const years = new Set(parsed.flatMap((range) => [range.from!.getUTCFullYear(), range.to!.getUTCFullYear()]));
  const months = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
  const labels = parsed.map(({ from, to }) => {
    const start = from!;
    const end = to!;
    const startMonth = months[start.getUTCMonth()];
    const endMonth = months[end.getUTCMonth()];
    const startDay = start.getUTCDate();
    const endDay = end.getUTCDate();
    const sameMonth = start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth();
    const label = sameMonth
      ? `${startMonth} ${startDay}${startDay === endDay ? "" : `-${endDay}`}`
      : `${startMonth} ${startDay}-${endMonth} ${endDay}`;
    return years.size === 1 ? label : `${label}, ${end.getUTCFullYear()}`;
  });
  const year = years.size === 1 ? `, ${parsed[parsed.length - 1].to!.getUTCFullYear()}` : "";
  return `${joinTevList(labels, "&")}${year}`;
}

export function formatTevTravelReferences(references: TevTravelReference[]) {
  const orderNumbers = formatTevTravelOrderNumbers(references);
  const dateRanges = formatTevTravelDateRanges(references);
  if (!orderNumbers) return dateRanges;
  return dateRanges ? `${orderNumbers}, dated ${dateRanges}` : orderNumbers;
}

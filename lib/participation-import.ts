import { unzipSync } from "fflate";

export type ImportedParticipationRecord = {
  unit: "AMIA" | "DRRM";
  participantNames: string[];
  participantGenders: ("female" | "male")[];
  eventTitle: string;
  eventDateFrom: string;
  eventDateTo: string;
  eventTimeFrom: string;
  eventTimeTo: string;
  eventDestination: string;
  distributionDate: string;
  distributionSameAsDestination: boolean;
  distributionPlace: string;
};

const requiredColumns = [
  "unit", "name", "gender", "title", "destination", "datefrom", "dateto", "timestart", "timeend", "distributionplace", "distributiondate",
] as const;

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function excelColumnIndex(reference: string) {
  const column = reference.match(/^[A-Z]+/)?.[0] ?? "";
  return [...column].reduce((number, letter) => number * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function parseDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    if (serial >= 1 && serial <= 2958465) {
      const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    }
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseTime(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const fraction = Number(trimmed);
    if (fraction >= 0 && fraction < 1) {
      const minutes = Math.round(fraction * 1440) % 1440;
      return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    }
  }
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?:\s*([ap]m))?$/i);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (minute > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23)) return "";
  if (meridiem) hour = hour % 12 + (meridiem === "pm" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseParticipationImportWorkbook(bytes: Uint8Array): ImportedParticipationRecord[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("This file is not a readable .xlsx workbook.");
  }

  const decoder = new TextDecoder();
  const parseXml = (content: Uint8Array, description: string) => {
    const document = new DOMParser().parseFromString(decoder.decode(content), "application/xml");
    if (document.getElementsByTagName("parsererror").length) throw new Error(`The ${description} could not be read.`);
    return document;
  };
  const sharedStrings = files["xl/sharedStrings.xml"]
    ? Array.from(parseXml(files["xl/sharedStrings.xml"], "workbook text").getElementsByTagNameNS("*", "si"), (item) =>
      Array.from(item.getElementsByTagNameNS("*", "t"), (text) => text.textContent ?? "").join("")
    )
    : [];
  const worksheet = files["xl/worksheets/sheet1.xml"];
  if (!worksheet) throw new Error("The workbook is missing its first worksheet.");
  const rows = Array.from(parseXml(worksheet, "worksheet").getElementsByTagNameNS("*", "sheetData")[0]?.children ?? []);
  if (!rows.length) throw new Error("The workbook has no rows to import.");

  const readRow = (row: Element) => {
    const values = new Map<number, string>();
    for (const cell of Array.from(row.children)) {
      const column = excelColumnIndex(cell.getAttribute("r") ?? "");
      if (column < 0) continue;
      if (cell.getAttribute("t") === "inlineStr") {
        values.set(column, Array.from(cell.getElementsByTagNameNS("*", "t"), (text) => text.textContent ?? "").join(""));
        continue;
      }
      const raw = cell.getElementsByTagNameNS("*", "v")[0]?.textContent ?? "";
      values.set(column, cell.getAttribute("t") === "s" ? sharedStrings[Number(raw)] ?? "" : raw);
    }
    return values;
  };

  const headers = readRow(rows[0]);
  const columns = new Map([...headers].map(([index, value]) => [normalizeHeader(value), index] as const));
  if (requiredColumns.some((column) => !columns.has(column))) {
    throw new Error("Use the Participation_Importing_Template.xlsx columns: Unit, Name, Gender, Title, Destination, Date From, Date To, Time Start, Time End, Distribution Place, and Distribution Date.");
  }

  const grouped = new Map<string, ImportedParticipationRecord>();
  const groupCounts = new Map<string, number>();
  const valueFor = (values: Map<number, string>, column: typeof requiredColumns[number]) => values.get(columns.get(column)!)?.trim() ?? "";
  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const values = readRow(row);
    if (![...values.values()].some((value) => value.trim())) return;

    const unitValue = valueFor(values, "unit").toUpperCase().replace(/^FOD-/, "");
    if (unitValue === "AGRISTAT") throw new Error(`Row ${rowNumber}: AGRISTAT participation template is on hold.`);
    if (unitValue !== "AMIA" && unitValue !== "DRRM") throw new Error(`Row ${rowNumber}: Unit must be AMIA or DRRM.`);
    const unit = unitValue;
    const rawGender = valueFor(values, "gender").toLowerCase();
    const participantGender = rawGender === "f" || rawGender === "female" ? "female" : rawGender === "m" || rawGender === "male" ? "male" : "";
    const eventTitle = valueFor(values, "title");
    const eventDestination = valueFor(values, "destination");
    const eventDateFrom = parseDate(valueFor(values, "datefrom"));
    const eventDateTo = parseDate(valueFor(values, "dateto"));
    const rawDistributionDate = valueFor(values, "distributiondate");
    const parsedDistributionDate = parseDate(rawDistributionDate);
    const distributionDate = parsedDistributionDate || eventDateTo;
    const eventTimeFrom = parseTime(valueFor(values, "timestart"));
    const eventTimeTo = parseTime(valueFor(values, "timeend"));
    const name = valueFor(values, "name");
    const distributionPlace = valueFor(values, "distributionplace") || eventDestination;
    if (!eventTitle || !eventDestination || !name || !participantGender || !eventDateFrom || !eventDateTo || !eventTimeFrom || !eventTimeTo) {
      throw new Error(`Row ${rowNumber}: complete the Unit, Name, Gender, event, date, time, and destination fields.`);
    }
    if (rawDistributionDate && !parsedDistributionDate) throw new Error(`Row ${rowNumber}: enter a valid Distribution Date.`);
    if (name.length > 180) throw new Error(`Row ${rowNumber}: Name must be 180 characters or fewer.`);
    if (eventDateTo < eventDateFrom) throw new Error(`Row ${rowNumber}: Date To must be on or after Date From.`);
    if (!distributionPlace || distributionPlace.length > 240 || eventDestination.length > 240 || eventTitle.length > 240) {
      throw new Error(`Row ${rowNumber}: Title, Destination, and Distribution Place must be 240 characters or fewer.`);
    }

    const eventKey = JSON.stringify([unit, eventTitle, eventDestination, eventDateFrom, eventDateTo, eventTimeFrom, eventTimeTo, distributionPlace, distributionDate]);
    let groupKey = eventKey;
    let existing = grouped.get(groupKey);
    if (existing && existing.participantNames.length >= 100) {
      const nextGroup = (groupCounts.get(eventKey) ?? 0) + 1;
      groupCounts.set(eventKey, nextGroup);
      groupKey = `${eventKey}:${nextGroup}`;
      existing = grouped.get(groupKey);
    }
    if (existing) {
      existing.participantNames.push(name);
      existing.participantGenders.push(participantGender);
    } else {
      grouped.set(groupKey, {
        unit: "AMIA",
        participantNames: [name],
        participantGenders: [participantGender],
        eventTitle,
        eventDateFrom,
        eventDateTo,
        eventTimeFrom,
        eventTimeTo,
        eventDestination,
        distributionDate,
        distributionSameAsDestination: distributionPlace === eventDestination,
        distributionPlace,
      });
    }
  });

  if (!grouped.size) throw new Error("The workbook has no completed participant rows to import.");
  return [...grouped.values()];
}


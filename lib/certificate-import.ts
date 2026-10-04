import { unzipSync } from "fflate";
import { divisionSignatory, tevDivisions, type TevDivision } from "@/lib/mytev";

export type ImportedAppearancePerson = {
  name: string;
  gender: "female" | "male" | "unspecified";
  office: string;
};

export type ImportedAppearanceRecord = {
  eventTitle: string;
  destination: string;
  eventDateFrom: string;
  eventDateTo: string;
  people: ImportedAppearancePerson[];
  signatoryName: string;
  designation: string;
  division: string;
};

const requiredColumns = [
  "title",
  "destination",
  "name",
  "gender",
  "office",
  "datefrom",
  "dateto",
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
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
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

export function parseCertificateImportWorkbook(bytes: Uint8Array): ImportedAppearanceRecord[] {
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
  const worksheetBytes = files["xl/worksheets/sheet1.xml"];
  if (!worksheetBytes) throw new Error("The workbook is missing its first worksheet.");

  const sheetData = parseXml(worksheetBytes, "worksheet").getElementsByTagNameNS("*", "sheetData")[0];
  const rows = sheetData ? Array.from(sheetData.children) : [];
  if (!rows.length) throw new Error("The workbook has no rows to import.");

  const readRow = (row: Element) => {
    const values = new Map<number, string>();
    for (const cell of Array.from(row.children)) {
      const columnIndex = excelColumnIndex(cell.getAttribute("r") ?? "");
      if (columnIndex < 0) continue;
      const type = cell.getAttribute("t");
      if (type === "inlineStr") {
        values.set(columnIndex, Array.from(cell.getElementsByTagNameNS("*", "t"), (text) => text.textContent ?? "").join(""));
        continue;
      }
      const rawValue = cell.getElementsByTagNameNS("*", "v")[0]?.textContent ?? "";
      values.set(columnIndex, type === "s" ? sharedStrings[Number(rawValue)] ?? "" : rawValue);
    }
    return values;
  };

  const headerCells = readRow(rows[0]);
  const columns = new Map([...headerCells].map(([index, value]) => [normalizeHeader(value), index] as const));
  const missingColumns = requiredColumns.filter((column) => !columns.has(column));
  const divisionNameColumn = columns.get("divisionname") ?? columns.get("division");
  if (missingColumns.length || divisionNameColumn === undefined) {
    throw new Error("Use the CA_Importing_Template.xlsx columns: Title, Destination, Date From, Date To, Name, Gender, Office, and Division Name.");
  }

  const recordsByEvent = new Map<string, ImportedAppearanceRecord>();
  const groupCounts = new Map<string, number>();
  const valueFor = (values: Map<number, string>, column: typeof requiredColumns[number]) => values.get(columns.get(column)!)?.trim() ?? "";

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const values = readRow(row);
    if (![...values.values()].some((value) => value.trim())) return;

    const eventTitle = valueFor(values, "title");
    const destination = valueFor(values, "destination");
    const name = valueFor(values, "name");
    const office = valueFor(values, "office");
    const eventDateFrom = parseDate(valueFor(values, "datefrom"));
    const eventDateTo = parseDate(valueFor(values, "dateto"));
    const division = (values.get(divisionNameColumn)?.trim() ?? "") as TevDivision;
    if (!tevDivisions.includes(division)) throw new Error(`Row ${rowNumber}: choose a valid Division Name from myTEV.`);
    const signatory = divisionSignatory(division);

    if (!name) throw new Error(`Row ${rowNumber}: enter a Name for each certificate.`);
    if (!eventTitle || !destination || !eventDateFrom || !eventDateTo || !office) {
      throw new Error(`Row ${rowNumber}: complete the event details and attendee Office.`);
    }
    if (eventDateTo < eventDateFrom) throw new Error(`Row ${rowNumber}: Date To must be on or after Date From.`);

    const rawGender = valueFor(values, "gender").trim().toLowerCase();
    const gender = rawGender === "f" || rawGender === "female"
      ? "female"
      : rawGender === "m" || rawGender === "male"
        ? "male"
        : rawGender
          ? null
          : "unspecified";
    if (!gender) throw new Error(`Row ${rowNumber}: Gender must be Female, Male, or blank.`);

    const eventKey = JSON.stringify([eventTitle, destination, eventDateFrom, eventDateTo, division]);
    let groupKey = eventKey;
    let existing = recordsByEvent.get(groupKey);
    if (existing && existing.people.length >= 100) {
      const nextGroup = (groupCounts.get(eventKey) ?? 0) + 1;
      groupCounts.set(eventKey, nextGroup);
      groupKey = `${eventKey}:${nextGroup}`;
      existing = recordsByEvent.get(groupKey);
    }
    if (existing) {
      existing.people.push({ name, gender, office });
    } else {
      recordsByEvent.set(groupKey, {
        eventTitle,
        destination,
        eventDateFrom,
        eventDateTo,
        people: [{ name, gender, office }],
        signatoryName: signatory.name,
        designation: signatory.position,
        division,
      });
    }
  });

  if (!recordsByEvent.size) throw new Error("The workbook has no completed attendee rows to import.");
  return [...recordsByEvent.values()];
}

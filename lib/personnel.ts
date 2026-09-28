export type PersonnelEntry = { name: string; position: string; unit: string };

export async function parsePersonnelWorkbook(workbookBytes: Uint8Array): Promise<PersonnelEntry[]> {
  const { unzipSync } = await import("fflate");
  const contents = unzipSync(workbookBytes);
  const decoder = new TextDecoder();
  const sharedStringsBytes = contents["xl/sharedStrings.xml"];
  const worksheetBytes = contents["xl/worksheets/sheet1.xml"];
  if (!sharedStringsBytes || !worksheetBytes) throw new Error("The workbook is missing its personnel sheet.");

  const parseXml = (bytes: Uint8Array) => {
    const document = new DOMParser().parseFromString(decoder.decode(bytes), "application/xml");
    if (document.getElementsByTagName("parsererror").length) throw new Error("The personnel workbook could not be read.");
    return document;
  };
  const sharedStrings = Array.from(parseXml(sharedStringsBytes).getElementsByTagNameNS("*", "si"), (item) =>
    Array.from(item.getElementsByTagNameNS("*", "t"), (text) => text.textContent ?? "").join("")
  );
  const rows = parseXml(worksheetBytes).getElementsByTagNameNS("*", "sheetData")[0]?.children;
  if (!rows?.length) throw new Error("The personnel workbook has no rows.");

  const readRow = (row: Element) => Array.from(row.children).map((cell) => {
    const reference = cell.getAttribute("r") ?? "";
    const column = reference.match(/^[A-Z]+/)?.[0] ?? "";
    const index = [...column].reduce((number, letter) => number * 26 + letter.charCodeAt(0) - 64, 0) - 1;
    const value = cell.getElementsByTagNameNS("*", "v")[0]?.textContent ?? "";
    return { index, value: cell.getAttribute("t") === "s" ? sharedStrings[Number(value)] ?? "" : value };
  });
  const headers = new Map(readRow(rows[0]).map(({ index, value }) => [index, value.trim().toLowerCase()] as const));
  const nameColumn = [...headers].find(([, value]) => value === "name")?.[0];
  const positionColumn = [...headers].find(([, value]) => value === "position")?.[0];
  const unitColumn = [...headers].find(([, value]) => value === "unit abbreviated")?.[0]
    ?? [...headers].find(([, value]) => value === "unit")?.[0];
  if (nameColumn === undefined || positionColumn === undefined) throw new Error("The personnel sheet needs Name and Position columns.");

  return Array.from(rows).slice(1).map((row) => {
    const values = new Map(readRow(row).map(({ index, value }) => [index, value.trim()] as const));
    return {
      name: values.get(nameColumn) ?? "",
      position: values.get(positionColumn) ?? "",
      unit: unitColumn === undefined ? "" : values.get(unitColumn) ?? "",
    };
  }).filter((person) => person.name);
}

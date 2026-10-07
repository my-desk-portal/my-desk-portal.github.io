export async function loadPdfTools() {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  return { html2canvas, jsPDF };
}

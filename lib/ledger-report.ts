import { strToU8, zipSync } from "fflate";
import { jsPDF } from "jspdf";

export type LedgerReportEntry = {
  id: number;
  seller_name: string;
  mineral_name: string;
  seller_price: string;
  platform_fee_rate: number;
  platform_fee_amount: string;
  price: string;
  currency: "TZS" | "USD";
  status: "pending" | "approved" | "rejected";
  listing_type: "single" | "batch";
  created_at: string;
};

export type LedgerReportTotals = {
  currency: "TZS" | "USD";
  count: number;
  sellerPrice: number;
  platformFee: number;
  marketPrice: number;
};

type SpreadsheetCell = string | number;

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function xmlEscape(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number) {
  let name = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

function worksheetXml(rows: SpreadsheetCell[][]) {
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
      if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error("The ledger contains a non-numeric value.");
        return `<c r="${ref}"><v>${value}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
}

function makeXlsx(sheets: { name: string; rows: SpreadsheetCell[][] }[]) {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`,
    ),
  };

  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet.rows));
  });

  return zipSync(files);
}

function formatMoney(amount: number, currency: LedgerReportTotals["currency"]) {
  return `${currency === "TZS" ? "TSh" : "$"} ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: currency === "USD" ? 2 : 0,
    maximumFractionDigits: currency === "USD" ? 2 : 0,
  }).format(amount)}`;
}

export function downloadLedgerExcel(entries: LedgerReportEntry[], totals: LedgerReportTotals[]) {
  const ledgerRows: SpreadsheetCell[][] = [
    ["Submitted", "Seller", "Mineral", "Listing type", "Status", "Seller price", "Fee rate (%)", "Fee amount", "Market price", "Currency", "Listing ID"],
    ...entries.map((entry) => [
      new Date(entry.created_at).toLocaleString(),
      entry.seller_name,
      entry.mineral_name,
      entry.listing_type === "batch" ? "Batch" : "Single piece",
      entry.status,
      Number(entry.seller_price),
      entry.platform_fee_rate * 100,
      Number(entry.platform_fee_amount),
      Number(entry.price),
      entry.currency,
      entry.id,
    ]),
  ];
  const summaryRows: SpreadsheetCell[][] = [
    ["Currency", "Listings", "Seller asking total", "Platform fee total", "Market price total"],
    ...totals.map((item) => [item.currency, item.count, item.sellerPrice, item.platformFee, item.marketPrice]),
  ];
  const content = makeXlsx([
    { name: "Ledger", rows: ledgerRows },
    { name: "Currency totals", rows: summaryRows },
  ]);
  downloadBlob(
    new Blob([content], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `seller-price-ledger-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

function pdfSafeText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?");
}

export function downloadLedgerPdf(entries: LedgerReportEntry[], totals: LedgerReportTotals[]) {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 28;
  const columnWidths = [95, 115, 130, 65, 115, 115, 150];
  const headers = ["Submitted", "Seller", "Mineral", "Status", "Seller price", "5% added", "Total market price"];
  let pageNumber = 1;
  let y = margin;

  const drawTitle = () => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("Seller price ledger report", margin, y + 16);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(`Generated ${new Date().toLocaleString()}`, margin, y + 31);
    pdf.text("Pricing amounts only; not confirmed sales, collected revenue, or seller payouts.", margin, y + 43);
    y += 58;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("Currency totals", margin, y + 10);
    y += 18;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    for (const item of totals) {
      pdf.text(
        `${item.currency} | ${item.count} listings | Seller: ${formatMoney(item.sellerPrice, item.currency)} | Fee: ${formatMoney(item.platformFee, item.currency)} | Market: ${formatMoney(item.marketPrice, item.currency)}`,
        margin,
        y + 9,
      );
      y += 13;
    }
    y += 8;
  };

  const drawTableHeader = () => {
    pdf.setFillColor(239, 243, 236);
    pdf.rect(margin, y, columnWidths.reduce((sum, width) => sum + width, 0), 25, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    let x = margin + 4;
    headers.forEach((header, index) => {
      pdf.text(pdf.splitTextToSize(header, columnWidths[index] - 8), x, y + 10);
      x += columnWidths[index];
    });
    y += 25;
  };

  const startPage = () => {
    if (pageNumber > 1) pdf.addPage();
    pageNumber += pageNumber > 1 ? 1 : 0;
    y = margin;
    drawTitle();
    drawTableHeader();
  };

  startPage();
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  entries.forEach((entry, index) => {
    const values = [
      new Date(entry.created_at).toLocaleString(),
      entry.seller_name,
      `${entry.mineral_name} (${entry.listing_type === "batch" ? "Batch" : "Single"})`,
      entry.status,
      formatMoney(Number(entry.seller_price), entry.currency),
      `${formatMoney(Number(entry.platform_fee_amount), entry.currency)} (${(entry.platform_fee_rate * 100).toFixed(0)}%)`,
      formatMoney(Number(entry.price), entry.currency),
    ];
    const cellLines = values.map((value, cellIndex) => pdf.splitTextToSize(pdfSafeText(value), columnWidths[cellIndex] - 8));
    const lineCount = Math.max(...cellLines.map((lines) => lines.length));
    const rowHeight = Math.max(21, lineCount * 9 + 10);
    if (y + rowHeight > pageHeight - margin) {
      startPage();
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
    }
    if (index % 2 === 1) {
      pdf.setFillColor(249, 250, 247);
      pdf.rect(margin, y, columnWidths.reduce((sum, width) => sum + width, 0), rowHeight, "F");
    }
    let x = margin + 4;
    cellLines.forEach((lines, cellIndex) => {
      pdf.text(lines, x, y + 10);
      x += columnWidths[cellIndex];
    });
    pdf.setDrawColor(229, 233, 226);
    pdf.line(margin, y + rowHeight, margin + columnWidths.reduce((sum, width) => sum + width, 0), y + rowHeight);
    y += rowHeight;
  });

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(120, 128, 118);
    pdf.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 12, { align: "right" });
  }

  downloadBlob(
    pdf.output("blob"),
    `seller-price-ledger-${new Date().toISOString().slice(0, 10)}.pdf`,
  );
}

const fs = require("fs");
const path = require("path");

const outputPath = path.resolve(
  __dirname,
  "..",
  "docs",
  "Xandora_Pricing_Sheet_Revised.pdf",
);

function escapePdfText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function createPdf() {
  const width = 595.2756;
  const height = 841.8898;
  const commands = [];

  function push(command) {
    commands.push(command);
  }

  function textLine(x, y, text, size = 10, font = "F1") {
    push(
      `BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfText(text)}) Tj ET`,
    );
  }

  function textBlock(x, y, lines, size = 10, font = "F1", leading = size + 2) {
    const parts = [`BT /${font} ${size} Tf ${leading} TL 1 0 0 1 ${x} ${y} Tm`];
    lines.forEach((line, index) => {
      if (index > 0) {
        parts.push("T*");
      }
      parts.push(`(${escapePdfText(line)}) Tj`);
    });
    parts.push("ET");
    push(parts.join(" "));
  }

  function heading(y, text) {
    textLine(78, y, text, 14, "F2");
  }

  push("0 0 0 rg");

  textLine(78, 776, "XANDORA", 22, "F2");
  textLine(78, 752, "RFID-Based Smart Operations Platform", 12, "F1");

  heading(716, "Overview");
  textBlock(
    78,
    690,
    [
      "Xandora is a modular RFID-enabled software platform built to improve",
      "retail operations, inventory accuracy, and lifecycle visibility.",
    ],
    10,
    "F1",
    12,
  );

  heading(646, "Core Platform License");
  textBlock(
    78,
    620,
    [
      "Includes dashboard, device integration, real-time streaming, admin controls,",
      "API layer, and reporting foundation.",
      "Pricing: LKR 1,000,000 - 1,500,000 one-time",
    ],
    10,
    "F1",
    12,
  );

  heading(570, "Operational Modules");
  textLine(
    78,
    548,
    "Retail and Stock Take can be purchased separately or bundled per store.",
    9,
    "F1",
  );

  const tableLeft = 84;
  const tableBottom = 466;
  const tableWidth = 428;
  const rowHeight = 18;
  const tableHeight = rowHeight * 4;
  const headerY = tableBottom + rowHeight * 3;
  const col1 = tableLeft + 88;
  const col2 = tableLeft + 308;

  push("0.36 0.36 0.36 rg");
  push(`${tableLeft} ${headerY} ${tableWidth} ${rowHeight} re f`);
  push("0 0 0 rg");
  push("1 J 1 j 0 0 0 RG 0.5 w");
  push(`${tableLeft} ${tableBottom} ${tableWidth} ${tableHeight} re S`);
  push(`${col1} ${tableBottom} m ${col1} ${tableBottom + tableHeight} l S`);
  push(`${col2} ${tableBottom} m ${col2} ${tableBottom + tableHeight} l S`);
  for (let i = 1; i < 4; i += 1) {
    const y = tableBottom + rowHeight * i;
    push(`${tableLeft} ${y} m ${tableLeft + tableWidth} ${y} l S`);
  }

  textLine(tableLeft + 6, headerY + 5, "Module", 10, "F2");
  textLine(col1 + 6, headerY + 5, "Description", 10, "F2");
  textLine(col2 + 6, headerY + 5, "Price", 10, "F2");

  textLine(tableLeft + 6, headerY - 13, "Retail", 10, "F1");
  textLine(col1 + 6, headerY - 13, "Billing workflows and POS validation", 10, "F1");
  textLine(col2 + 6, headerY - 13, "LKR 250K - 400K per store", 10, "F1");

  textLine(tableLeft + 6, headerY - 31, "Stock Take", 10, "F1");
  textLine(
    col1 + 6,
    headerY - 31,
    "Inventory counts, audits, and reconciliation",
    10,
    "F1",
  );
  textLine(col2 + 6, headerY - 31, "LKR 200K - 350K per store", 10, "F1");

  textLine(tableLeft + 6, headerY - 49, "Laundry", 10, "F1");
  textLine(col1 + 6, headerY - 49, "Lifecycle tracking and status monitoring", 10, "F1");
  textLine(col2 + 6, headerY - 49, "LKR 200K - 300K per location", 10, "F1");

  heading(430, "RFID Device Scaling");
  textBlock(
    78,
    404,
    [
      "First 2 readers per store included.",
      "Additional readers: LKR 5,000 - 10,000/month or LKR 25,000 - 50,000 one-time.",
    ],
    10,
    "F1",
    12,
  );

  heading(356, "Mobile Application");
  textBlock(
    78,
    330,
    [
      "Handheld scanning, sync, and operational task execution.",
      "Pricing: LKR 40,000 - 75,000 per device",
    ],
    10,
    "F1",
    12,
  );

  heading(296, "Support & Maintenance");
  textLine(78, 270, "AMC: LKR 30,000 - 80,000/month depending on deployment scale.", 10, "F1");

  heading(242, "Pilot Package");
  textBlock(
    78,
    216,
    [
      "1 store bundle including Core Platform, Retail Module, Stock Take Module, and 2 readers.",
      "Pricing: LKR 800,000 - 1,200,000",
    ],
    10,
    "F1",
    12,
  );

  heading(182, "Positioning");
  textBlock(
    78,
    156,
    [
      "Xandora is a modular RFID operations platform that lets customers start",
      "with the workflows they need today and add more modules as they scale.",
    ],
    10,
    "F1",
    12,
  );

  const content = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`,
    `<< /Title (${escapePdfText("Xandora Pricing Sheet Revised")}) /Author (${escapePdfText("Codex")}) /Producer (${escapePdfText("Node.js PDF generator")}) >>`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((objectBody, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
  });

  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF\n`;

  return pdf;
}

fs.writeFileSync(outputPath, createPdf(), "binary");
console.log(`Created ${outputPath}`);

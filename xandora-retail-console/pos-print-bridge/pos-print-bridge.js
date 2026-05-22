const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const HOST = process.env.XANDORA_PRINT_HOST || "127.0.0.1";
const PORT = Number(process.env.XANDORA_PRINT_PORT || 4315);
const PRINTER_NAME = String(process.env.XANDORA_PRINTER_NAME || "").trim();
const PAPER_WIDTH_MM = Number(process.env.XANDORA_PAPER_WIDTH_MM || 80);
const FONT_FAMILY = process.env.XANDORA_RECEIPT_FONT || "Consolas";
const FONT_SIZE_PT = Number(process.env.XANDORA_RECEIPT_FONT_SIZE_PT || 10);
const PAGE_MARGIN_MM = Number(process.env.XANDORA_RECEIPT_MARGIN_MM || 3);
const CONTENT_WIDTH_MM = Math.max(48, PAPER_WIDTH_MM - PAGE_MARGIN_MM * 2);
const RECEIPT_COLUMNS = CONTENT_WIDTH_MM >= 72 ? 48 : 32;

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function money(value, currency = "LKR") {
  const amount = Number(value || 0).toFixed(2);
  return `${currency} ${amount}`;
}

function line(label, value, width = RECEIPT_COLUMNS) {
  const right = String(value || "");
  const leftWidth = Math.max(8, width - right.length - 1);
  const left = String(label || "").slice(0, leftWidth);
  const gap = Math.max(1, width - left.length - right.length);
  return `${left}${" ".repeat(gap)}${right}`;
}

function center(text, width = RECEIPT_COLUMNS) {
  const value = String(text || "").trim().slice(0, width);
  if (!value) return "";
  const leftPad = Math.max(0, Math.floor((width - value.length) / 2));
  return `${" ".repeat(leftPad)}${value}`;
}

function hr(char = "-", width = RECEIPT_COLUMNS) {
  return String(char || "-").repeat(width);
}

function wrapText(value, width = RECEIPT_COLUMNS) {
  const source = String(value || "").replace(/\s+/g, " ").trim();
  if (!source) return [];
  const words = source.split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      if (word.length <= width) {
        current = word;
      } else {
        for (let index = 0; index < word.length; index += width) {
          lines.push(word.slice(index, index + width));
        }
      }
      continue;
    }

    const next = `${current} ${word}`;
    if (next.length <= width) {
      current = next;
      continue;
    }

    lines.push(current);
    if (word.length <= width) {
      current = word;
    } else {
      for (let index = 0; index < word.length; index += width) {
        const chunk = word.slice(index, index + width);
        if (chunk.length === width) {
          lines.push(chunk);
        } else {
          current = chunk;
        }
      }
      if (!current || current.length === width) current = "";
    }
  }

  if (current) lines.push(current);
  return lines;
}

function pushWrapped(out, value, width = RECEIPT_COLUMNS) {
  const lines = wrapText(value, width);
  if (!lines.length) return;
  out.push(...lines);
}

function clampMoneyLine(label, amountText, width = RECEIPT_COLUMNS) {
  const right = String(amountText || "");
  const leftWidth = Math.max(8, width - right.length - 1);
  const left = String(label || "").slice(0, leftWidth);
  return line(left, right, width);
}

function buildReceiptText(receipt = {}) {
  const currency = receipt.currency || "LKR";
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  const out = [];

  out.push(center("XANDORA"));
  out.push(center(String(receipt.type || "SALE").toUpperCase()));
  if (receipt.store) pushWrapped(out, `Store: ${receipt.store}`);
  if (receipt.cashier) pushWrapped(out, `Cashier: ${receipt.cashier}`);
  if (receipt.receiptNo) pushWrapped(out, `Bill: ${receipt.receiptNo}`);
  pushWrapped(
    out,
    receipt.issuedAt ? `Time: ${receipt.issuedAt}` : `Time: ${new Date().toLocaleString()}`
  );
  out.push(hr());
  out.push(line("# Item", "Total"));
  out.push(hr());

  for (const [index, item] of items.entries()) {
    const priceText = money(item.price, currency);
    const nameLines = wrapText(`${index + 1}. ${item.name || item.product || "Item"}`, Math.max(12, RECEIPT_COLUMNS - priceText.length - 1));
    if (nameLines.length) {
      out.push(line(nameLines[0], priceText));
      for (const lineText of nameLines.slice(1)) out.push(line(lineText, ""));
    } else {
      out.push(line(`${index + 1}. Item`, priceText));
    }

    const detail = [
      item.brand ? `Brand ${item.brand}` : "",
      item.size ? `Size ${item.size}` : "",
      item.color ? `Color ${item.color}` : "",
      item.sku ? `SKU ${item.sku}` : item.epc ? `EPC ${item.epc}` : "",
    ].filter(Boolean);
    if (detail.length) {
      for (const detailLine of wrapText(detail.join(" | "))) out.push(detailLine);
    }
    out.push(hr("."));
  }

  if (!items.length) out.push("No item detail available");

  out.push(hr());
  out.push(line("Items", receipt.count || items.length));
  out.push(clampMoneyLine("Subtotal", money(receipt.subtotal, currency)));
  out.push(clampMoneyLine("Discount", money(receipt.discount?.amount || 0, currency)));
  out.push(clampMoneyLine("Total", money(receipt.total, currency)));
  out.push(hr());
  out.push(center("Thank you"));
  out.push("");
  out.push("");
  out.push("");

  return out.join(os.EOL);
}

function printText(text) {
  return new Promise((resolve, reject) => {
    const file = path.join(os.tmpdir(), `xandora-receipt-${Date.now()}.txt`);
    fs.writeFileSync(file, text, "utf8");

    const command = `
$printerName = $env:XANDORA_PRINTER_NAME
$receiptFile = $env:XANDORA_RECEIPT_FILE
$paperWidthMm = [double]$env:XANDORA_PAPER_WIDTH_MM
$fontName = $env:XANDORA_RECEIPT_FONT
$fontSizePt = [float]$env:XANDORA_RECEIPT_FONT_SIZE_PT
$marginMm = [double]$env:XANDORA_RECEIPT_MARGIN_MM

Add-Type -AssemblyName System.Drawing
$lines = [System.IO.File]::ReadAllLines($receiptFile)
$doc = New-Object System.Drawing.Printing.PrintDocument
if ($printerName) { $doc.PrinterSettings.PrinterName = $printerName }
if (-not $doc.PrinterSettings.IsValid) {
  throw "Printer not found or unavailable: $printerName"
}

$widthHundredths = [Math]::Round(($paperWidthMm / 25.4) * 100)
$marginHundredths = [Math]::Round(($marginMm / 25.4) * 100)
$font = New-Object System.Drawing.Font($fontName, $fontSizePt, [System.Drawing.FontStyle]::Regular)
$lineHeight = [Math]::Ceiling($font.GetHeight() + 2)
$heightHundredths = [Math]::Max(600, ($lines.Length + 6) * $lineHeight)
$paper = New-Object System.Drawing.Printing.PaperSize("XandoraReceipt", $widthHundredths, $heightHundredths)
$doc.DefaultPageSettings.PaperSize = $paper
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins($marginHundredths, $marginHundredths, $marginHundredths, $marginHundredths)

$index = 0
$doc.add_PrintPage({
  param($sender, $e)
  $brush = [System.Drawing.Brushes]::Black
  $x = $e.MarginBounds.Left
  $y = $e.MarginBounds.Top

  while ($index -lt $lines.Length) {
    $e.Graphics.DrawString($lines[$index], $font, $brush, $x, $y)
    $index++
    $y += $lineHeight
    if (($y + $lineHeight) -gt $e.MarginBounds.Bottom) {
      $e.HasMorePages = $true
      return
    }
  }

  $e.HasMorePages = $false
})

$doc.Print()
$font.Dispose()
$doc.Dispose()
`;

    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        env: {
          ...process.env,
          XANDORA_RECEIPT_FILE: file,
          XANDORA_PRINTER_NAME: PRINTER_NAME,
          XANDORA_PAPER_WIDTH_MM: String(PAPER_WIDTH_MM),
          XANDORA_RECEIPT_FONT: FONT_FAMILY,
          XANDORA_RECEIPT_FONT_SIZE_PT: String(FONT_SIZE_PT),
          XANDORA_RECEIPT_MARGIN_MM: String(PAGE_MARGIN_MM),
        },
        windowsHide: true,
      }
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      setTimeout(() => fs.unlink(file, () => {}), 3000);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `Print command failed with code ${code}`));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, {
      ok: true,
      app: "xandora-pos-print-bridge",
      printer: PRINTER_NAME || "Windows default printer",
    });
  }

  if (req.method === "POST" && req.url === "/print-receipt") {
    try {
      const body = await readJson(req);
      const receipt = body.receipt || body;
      await printText(buildReceiptText(receipt));
      return send(res, 200, { ok: true, printer: PRINTER_NAME || "default" });
    } catch (err) {
      return send(res, 500, { ok: false, error: err.message });
    }
  }

  return send(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Xandora POS Print Bridge running at http://${HOST}:${PORT}`);
  console.log(`Printer: ${PRINTER_NAME || "Windows default printer"}`);
});

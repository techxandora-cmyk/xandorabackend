const net = require("net");
const http = require("http");
require("dotenv").config();

/* ============================= */
/* CONFIG */
/* ============================= */

function envInt(name, fallback, min = null, max = null) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;

  const value = Math.round(parsed);
  if (min != null && value < min) return fallback;
  if (max != null && value > max) return fallback;
  return value;
}

function envPath(name, fallback) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

const READER_HOST = String(process.env.READER_HOST || "192.168.100.50").trim();
const READER_PORT = envInt("READER_PORT", 5084, 1, 65535);

const ZYRO_HOST = String(process.env.ZYRO_HOST || "127.0.0.1").trim();
const ZYRO_PORT = envInt("ZYRO_PORT", 3000, 1, 65535);

const STORE_ID = String(process.env.STORE_ID || "STORE_001").trim();
const DEVICE_ID = String(process.env.DEVICE_ID || "FX9600_01").trim();
const SCAN_KEY = process.env.SCAN_API_KEY || "zyro_reader_001";
const SCAN_PATH = envPath("SCAN_PATH", "/api/v1/scans/batch");

const FLUSH_INTERVAL_MS = envInt("FLUSH_INTERVAL_MS", 1000, 100, 60000);
const RECONNECT_DELAY_MS = envInt("RECONNECT_DELAY_MS", 3000, 1000, 600000);
const GET_REPORT_INTERVAL_MS = envInt("GET_REPORT_INTERVAL_MS", 1000, 250, 60000);
const NO_REPORT_SWITCH_MS = envInt("NO_REPORT_SWITCH_MS", 12000, 2000, 600000);
const EXIT_AFTER_MS = Number(process.env.EXIT_AFTER_MS || 15000);
const DWELL_HEARTBEAT_MS = Number(process.env.DWELL_HEARTBEAT_MS || 30000);
const ZONE_ID = process.env.ZONE_ID || "sales_floor";
const EVENTS_PATH = envPath("EVENTS_PATH", "/api/v1/events/ingest");
const INSTANCE_ID = `${STORE_ID}:${DEVICE_ID}`;

if (!process.env.READER_HOST) {
  console.warn(`[bridge ${INSTANCE_ID}] READER_HOST not set. Using default ${READER_HOST}`);
}
if (!process.env.DEVICE_ID) {
  console.warn(`[bridge ${INSTANCE_ID}] DEVICE_ID not set. Using default ${DEVICE_ID}`);
}

console.log(
  `[bridge ${INSTANCE_ID}] start reader=${READER_HOST}:${READER_PORT} -> zyro=${ZYRO_HOST}:${ZYRO_PORT}${SCAN_PATH}`
);

/* ============================= */
/* LLRP TYPES */
/* ============================= */

const MSG = {
  ADD_ROSPEC: 20,
  DELETE_ROSPEC: 21,
  START_ROSPEC: 22,
  ENABLE_ROSPEC: 24,
  GET_REPORT: 60,
  ENABLE_EVENTS_AND_REPORTS: 64,
  KEEPALIVE_ACK: 72,

  ADD_ROSPEC_RESPONSE: 30,
  DELETE_ROSPEC_RESPONSE: 31,
  START_ROSPEC_RESPONSE: 32,
  ENABLE_ROSPEC_RESPONSE: 34,

  RO_ACCESS_REPORT: 61,
  KEEPALIVE: 62,
  READER_EVENT_NOTIFICATION: 63,
  ERROR_MESSAGE: 100,
};

const STATUS = {
  0: "M_Success",
  100: "M_ParameterError",
  101: "M_FieldError",
  102: "M_UnexpectedParameter",
  103: "M_MissingParameter",
  104: "M_DuplicateParameter",
  105: "M_OverflowParameter",
  106: "M_OverflowField",
  107: "M_UnknownParameter",
  108: "M_UnknownField",
  109: "P_UnsupportedMessage",
  110: "P_UnsupportedVersion",
  111: "P_UnsupportedParameter",
  112: "P_UnexpectedParameter",
  113: "P_MissingParameter",
  114: "P_DuplicateParameter",
  115: "P_OverflowParameter",
  116: "P_OverflowField",
  117: "P_UnknownParameter",
  118: "P_UnknownField",
};

/* ============================= */
/* INTERNAL STATE */
/* ============================= */

let socket;
let messageID = 1;
let reconnectTimer = null;
let incomingBuffer = Buffer.alloc(0);

let tagBuffer = new Set();
let flushTimer = null;
const seenTags = new Set();

let addTemplateIndex = 0;
let llrpState = "idle";
let reportPollTimer = null;
let noReportTimer = null;
let lastReportAt = 0;
let zoneMonitorTimer = null;
const tagSessions = new Map();

/* ============================= */
/* BASIC BUILDERS */
/* ============================= */

function nextID() {
  return messageID++;
}

function buildHeader(type, length) {
  const buffer = Buffer.alloc(10);
  const versionType = (1 << 10) | type;
  buffer.writeUInt16BE(versionType, 0);
  buffer.writeUInt32BE(length, 2);
  buffer.writeUInt32BE(nextID(), 6);
  return buffer;
}

function u8(v) {
  const b = Buffer.alloc(1);
  b.writeUInt8(v, 0);
  return b;
}

function u16(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(v, 0);
  return b;
}

function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v, 0);
  return b;
}

function tlv(type, value) {
  const out = Buffer.alloc(4 + value.length);
  out.writeUInt16BE(type, 0);
  out.writeUInt16BE(4 + value.length, 2);
  value.copy(out, 4);
  return out;
}

/* ============================= */
/* COMMANDS */
/* ============================= */

function keepAliveAck() {
  return buildHeader(MSG.KEEPALIVE_ACK, 10);
}

function deleteROSpecAll() {
  const body = Buffer.alloc(4);
  body.writeUInt32BE(0, 0); // 0 = all ROSpecs
  return Buffer.concat([buildHeader(MSG.DELETE_ROSPEC, 14), body]);
}

function enableROSpec() {
  const body = Buffer.alloc(4);
  body.writeUInt32BE(1, 0);
  return Buffer.concat([buildHeader(MSG.ENABLE_ROSPEC, 14), body]);
}

function startROSpec() {
  const body = Buffer.alloc(4);
  body.writeUInt32BE(1, 0);
  return Buffer.concat([buildHeader(MSG.START_ROSPEC, 14), body]);
}

function enableEventsAndReports() {
  return buildHeader(MSG.ENABLE_EVENTS_AND_REPORTS, 10);
}

function getReport() {
  return buildHeader(MSG.GET_REPORT, 10);
}

/* ============================= */
/* ROSPEC TEMPLATES */
/* ============================= */

function buildROSpecTemplateAllAntennas() {
  const roStartTrigger = tlv(179, Buffer.concat([u8(0)]));
  const roStopTrigger = tlv(182, Buffer.concat([u8(0), u32(0)]));
  const roBoundarySpec = tlv(178, Buffer.concat([roStartTrigger, roStopTrigger]));

  const aiStopTrigger = tlv(184, Buffer.concat([u8(0), u32(0)]));
  const invSpec = tlv(186, Buffer.concat([u16(1), u8(1)])); // EPC Gen2

  const aiSpec = tlv(183, Buffer.concat([
    u16(0), // all antennas
    aiStopTrigger,
    invSpec,
  ]));

  const tagContentSelector = tlv(238, Buffer.from([0x00, 0x00]));
  const roReportSpec = tlv(237, Buffer.concat([
    u8(1),   // Upon_N_Tags_Or_End_Of_AISpec
    u16(1),
    tagContentSelector,
  ]));

  return tlv(177, Buffer.concat([
    u32(1),
    u8(0),
    u8(0),
    roBoundarySpec,
    aiSpec,
    roReportSpec,
  ]));
}

function buildROSpecTemplateAntenna1() {
  const roStartTrigger = tlv(179, Buffer.concat([u8(0)]));
  const roStopTrigger = tlv(182, Buffer.concat([u8(0), u32(0)]));
  const roBoundarySpec = tlv(178, Buffer.concat([roStartTrigger, roStopTrigger]));

  const aiStopTrigger = tlv(184, Buffer.concat([u8(0), u32(0)]));
  const invSpec = tlv(186, Buffer.concat([u16(1), u8(1)])); // EPC Gen2

  const aiSpec = tlv(183, Buffer.concat([
    u16(1), // antenna count
    u16(1), // antenna ID 1
    aiStopTrigger,
    invSpec,
  ]));

  const tagContentSelector = tlv(238, Buffer.from([0x00, 0x00]));
  const roReportSpec = tlv(237, Buffer.concat([
    u8(1),
    u16(1),
    tagContentSelector,
  ]));

  return tlv(177, Buffer.concat([
    u32(1),
    u8(0),
    u8(0),
    roBoundarySpec,
    aiSpec,
    roReportSpec,
  ]));
}

function buildROSpecTemplateLegacy() {
  // Legacy payload that some readers accept.
  const rospecBody = Buffer.from(
    "00b1005300000001000000b2001200b300050000b60009000000000000b700180001000000b8000901000003e800ba000700010100ed001f01000000ee000bffc0015c0005c003ff000d000067ba0000008e01",
    "hex"
  );

  return rospecBody;
}

function buildROSpecTemplateLegacyAntenna1() {
  // Same as legacy, but explicit AntennaID=1 (count=1, id=1)
  const rospecBody = Buffer.from(
    "00b1005300000001000000b2001200b300050000b60009000000000000b700180001000100b8000901000003e800ba000700010100ed001f01000000ee000bffc0015c0005c003ff000d000067ba0000008e01",
    "hex"
  );

  return rospecBody;
}

const ROSPEC_BUILDERS = [
  buildROSpecTemplateAntenna1,
  buildROSpecTemplateAllAntennas,
  buildROSpecTemplateLegacy,
  buildROSpecTemplateLegacyAntenna1,
];

function addROSpecFromTemplate(index) {
  const rospec = ROSPEC_BUILDERS[index]();
  return Buffer.concat([buildHeader(MSG.ADD_ROSPEC, 10 + rospec.length), rospec]);
}

/* ============================= */
/* STATUS DECODER */
/* ============================= */

function parseSubParameter(value, offset) {
  if (offset + 4 > value.length) return null;

  const type = value.readUInt16BE(offset) & 0x03ff;
  const len = value.readUInt16BE(offset + 2);

  if (len < 4 || offset + len > value.length) return null;

  return {
    type,
    len,
    value: value.slice(offset + 4, offset + len),
    nextOffset: offset + len,
  };
}

function parseStatusDetail(llrpStatusValue) {
  // LLRPStatus value: statusCode(2) + errorDescLen(2) + errorDesc(n) + optional sub-params
  if (llrpStatusValue.length < 4) return null;

  const errorDescLen = llrpStatusValue.readUInt16BE(2);
  const subStart = 4 + errorDescLen;

  if (subStart > llrpStatusValue.length) return null;

  const details = [];
  let off = subStart;

  while (off + 4 <= llrpStatusValue.length) {
    const p = parseSubParameter(llrpStatusValue, off);
    if (!p) break;

    if (p.type === 288 && p.value.length >= 4) {
      details.push({
        kind: 'FieldError',
        fieldNum: p.value.readUInt16BE(0),
        errorCode: p.value.readUInt16BE(2),
      });
    } else if (p.type === 289 && p.value.length >= 4) {
      details.push({
        kind: 'ParameterError',
        parameterType: p.value.readUInt16BE(0),
        errorCode: p.value.readUInt16BE(2),
      });
    }

    off = p.nextOffset;
  }

  return details;
}

function getResponseStatus(message) {
  let offset = 10;

  while (offset + 4 <= message.length) {
    const paramType = message.readUInt16BE(offset) & 0x03ff;
    const paramLen = message.readUInt16BE(offset + 2);

    if (paramLen < 4 || offset + paramLen > message.length) {
      return null;
    }

    // LLRPStatus
    if (paramType === 287) {
      if (paramLen < 6) return null;
      const value = message.slice(offset + 4, offset + paramLen);
      const code = value.readUInt16BE(0);
      const detail = parseStatusDetail(value);

      return {
        code,
        name: STATUS[code] || 'UnknownStatus',
        detail,
      };
    }

    offset += paramLen;
  }

  return null;
}

function isStatusSuccess(message) {
  const status = getResponseStatus(message);
  if (!status) return false;
  return status.code === 0;
}

function logResponse(label, message) {
  const status = getResponseStatus(message);

  if (!status) {
    console.log(label, "status unavailable");
    return;
  }

  console.log(label, "status:", status.code, status.name);

  if (status.detail && status.detail.length) {
    for (const d of status.detail) {
      if (d.kind === "ParameterError") {
        console.log(
          `${label} detail: ParameterError parameterType=${d.parameterType} errorCode=${d.errorCode}`
        );
      } else if (d.kind === "FieldError") {
        console.log(
          `${label} detail: FieldError fieldNum=${d.fieldNum} errorCode=${d.errorCode}`
        );
      }
    }
  }
}

/* ============================= */
/* LLRP FRAMING */
/* ============================= */

function handleData(chunk) {
  incomingBuffer = Buffer.concat([incomingBuffer, chunk]);

  while (incomingBuffer.length >= 10) {
    const length = incomingBuffer.readUInt32BE(2);

    if (length < 10) {
      console.log("Invalid frame length:", length);
      incomingBuffer = Buffer.alloc(0);
      return;
    }

    if (incomingBuffer.length < length) return;

    const message = incomingBuffer.slice(0, length);
    incomingBuffer = incomingBuffer.slice(length);

    processMessage(message);
  }
}

/* ============================= */
/* EPC EXTRACTION */
/* ============================= */

function tryReadEpcFromTagReportData(tagReportData) {
  // TV EPC-96: 0x8D + 12 bytes
  for (let i = 0; i + 13 <= tagReportData.length; i++) {
    if (tagReportData[i] === 0x8d) {
      return tagReportData.slice(i + 1, i + 13).toString("hex").toUpperCase();
    }
  }

  // TLV EPCData (type 241): type(2) len(2) bitLen(2) epc(n)
  for (let i = 0; i + 8 <= tagReportData.length; i++) {
    if (tagReportData[i] === 0x00 && tagReportData[i + 1] === 0xf1) {
      const paramLen = tagReportData.readUInt16BE(i + 2);
      if (paramLen < 6 || i + paramLen > tagReportData.length) continue;

      const epcBitLen = tagReportData.readUInt16BE(i + 4);
      const epcByteLen = Math.ceil(epcBitLen / 8);
      const epcStart = i + 6;
      const epcEnd = epcStart + epcByteLen;

      if (epcEnd <= i + paramLen) {
        return tagReportData.slice(epcStart, epcEnd).toString("hex").toUpperCase();
      }
    }
  }

  return null;
}

function extractEPCsFromAccessReport(message) {
  const epcs = [];
  let tagReportDataCount = 0;
  let offset = 10;

  while (offset + 4 <= message.length) {
    const paramType = message.readUInt16BE(offset) & 0x03ff;
    const paramLen = message.readUInt16BE(offset + 2);

    if (paramLen < 4 || offset + paramLen > message.length) break;

    if (paramType === 240) {
      tagReportDataCount++;
      const trd = message.slice(offset + 4, offset + paramLen);
      const epc = tryReadEpcFromTagReportData(trd);
      if (epc) epcs.push(epc);
    }

    offset += paramLen;
  }

  return { epcs, tagReportDataCount };
}

/* ============================= */
/* DUPLICATE FILTER */
/* ============================= */

function isDuplicate(epc) {
  if (seenTags.has(epc)) {
    return true;
  }

  seenTags.add(epc);
  return false;
}

/* ============================= */
/* TAG FLUSH */
/* ============================= */

function scheduleFlush() {
  if (flushTimer) return;

  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushTags();
  }, FLUSH_INTERVAL_MS);
}

function flushTags() {
  if (tagBuffer.size === 0) return;

  const tags = Array.from(tagBuffer);
  tagBuffer.clear();

  const payload = JSON.stringify({
    device_id: DEVICE_ID,
    store_id: STORE_ID,
    items: tags.map((tag) => ({ tag })),
  });

  const req = http.request(
    {
      hostname: ZYRO_HOST,
      port: ZYRO_PORT,
      path: SCAN_PATH,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-scan-key": SCAN_KEY,
        "Content-Length": Buffer.byteLength(payload),
      },
    },
    (res) => {
      let body = "";

      res.on("data", (chunk) => {
        body += chunk.toString();
      });

      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          console.log("Zyro POST failed. Status:", res.statusCode, body || "");

          // Release these tags from local dedupe so they can be retried on next read.
          for (const tag of tags) {
            seenTags.delete(tag);
          }
          return;
        }

        try {
          const parsed = body ? JSON.parse(body) : null;
          if (parsed && typeof parsed.inserted === "number") {
            console.log(
              `Zyro POST ok. inserted=${parsed.inserted}, duplicates_ignored=${parsed.duplicates_ignored ?? 0}`
            );
          }
        } catch {
          // ignore non-JSON response bodies
        }
      });
    }
  );

  req.on("error", (err) => {
    console.log("Zyro POST error:", err.message);

    // Requeue unsent tags and release dedupe lock so data is not lost.
    for (const tag of tags) {
      seenTags.delete(tag);
      tagBuffer.add(tag);
    }

    scheduleFlush();
  });

  req.write(payload);
  req.end();

  console.log(`[bridge ${INSTANCE_ID}] sent ${tags.length} unique tag(s) to Zyro`);
}

function postDecisionEvent(eventType, data) {
  const payloadObj = {
    event_type: eventType,
    data: {
      source: "llrp_bridge",
      device_id: DEVICE_ID,
      store_id: STORE_ID,
      zone_id: ZONE_ID,
      ts: new Date().toISOString(),
      ...data,
    },
  };

  const payload = JSON.stringify(payloadObj);

  const req = http.request({
    hostname: ZYRO_HOST,
    port: ZYRO_PORT,
    path: EVENTS_PATH,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-scan-key": SCAN_KEY,
      "Content-Length": Buffer.byteLength(payload),
    },
  });

  req.on("error", (err) => {
    console.log("Decision event POST error:", err.message);
  });

  req.write(payload);
  req.end();
}

function emitDecisionEvent(eventType, data) {
  const epcLog = data && data.epc ? ` ${data.epc}` : "";
  console.log(`[DECISION] ${eventType}${epcLog}`);
  postDecisionEvent(eventType, data);
}

function touchTagSession(epc) {
  const now = Date.now();
  const existing = tagSessions.get(epc);

  if (!existing) {
    tagSessions.set(epc, {
      enteredAt: now,
      lastSeenAt: now,
      lastDwellAt: now,
    });

    emitDecisionEvent("entered_zone", {
      epc,
      entered_at: new Date(now).toISOString(),
    });
    return;
  }

  existing.lastSeenAt = now;

  if (now - existing.lastDwellAt >= DWELL_HEARTBEAT_MS) {
    existing.lastDwellAt = now;
    emitDecisionEvent("dwell_heartbeat", {
      epc,
      dwell_ms: now - existing.enteredAt,
      entered_at: new Date(existing.enteredAt).toISOString(),
      last_seen_at: new Date(existing.lastSeenAt).toISOString(),
    });
  }
}

function stopZoneMonitor() {
  if (zoneMonitorTimer) {
    clearInterval(zoneMonitorTimer);
    zoneMonitorTimer = null;
  }
}

function startZoneMonitor() {
  stopZoneMonitor();

  zoneMonitorTimer = setInterval(() => {
    if (llrpState !== "running") return;

    const now = Date.now();
    for (const [epc, session] of tagSessions) {
      if (now - session.lastSeenAt < EXIT_AFTER_MS) continue;

      emitDecisionEvent("exited_zone", {
        epc,
        entered_at: new Date(session.enteredAt).toISOString(),
        exited_at: new Date(now).toISOString(),
        last_seen_at: new Date(session.lastSeenAt).toISOString(),
        dwell_ms: now - session.enteredAt,
      });

      tagSessions.delete(epc);
    }
  }, 1000);
}

function stopReportPolling() {
  if (reportPollTimer) {
    clearInterval(reportPollTimer);
    reportPollTimer = null;
  }
}

function startReportPolling() {
  stopReportPolling();

  reportPollTimer = setInterval(() => {
    if (llrpState !== "running") return;
    send(getReport(), "GET_REPORT", true);
  }, GET_REPORT_INTERVAL_MS);
}

function stopNoReportMonitor() {
  if (noReportTimer) {
    clearInterval(noReportTimer);
    noReportTimer = null;
  }
}

function startNoReportMonitor() {
  stopNoReportMonitor();

  noReportTimer = setInterval(() => {
    if (llrpState !== "running") return;

    const idleMs = Date.now() - lastReportAt;
    if (idleMs < NO_REPORT_SWITCH_MS) return;

    if (addTemplateIndex + 1 < ROSPEC_BUILDERS.length) {
      addTemplateIndex += 1;
      console.log(
        `No RO_ACCESS_REPORT for ${Math.round(idleMs / 1000)}s. Switching template to ${addTemplateIndex + 1}/${ROSPEC_BUILDERS.length}...`
      );
      sendDeleteROSpec();
      lastReportAt = Date.now();
      return;
    }

    console.log(
      `No RO_ACCESS_REPORT for ${Math.round(idleMs / 1000)}s and no more templates to try.`
    );
    lastReportAt = Date.now();
  }, 3000);
}

/* ============================= */
/* SEND HELPERS */
/* ============================= */

function send(message, label, silent = false) {
  if (!socket || socket.destroyed) return;
  socket.write(message);
  if (!silent) {
    console.log(`[bridge ${INSTANCE_ID}] sent:`, label);
  }
}

function sendDeleteROSpec() {
  llrpState = "waiting_delete";
  send(deleteROSpecAll(), "DELETE_ROSPEC");
}

function sendAddROSpec() {
  llrpState = "waiting_add";
  const msg = addROSpecFromTemplate(addTemplateIndex);
  send(msg, `ADD_ROSPEC (template ${addTemplateIndex + 1}/${ROSPEC_BUILDERS.length})`);
}

function sendEnableROSpec() {
  llrpState = "waiting_enable";
  send(enableROSpec(), "ENABLE_ROSPEC");
}

function sendStartROSpec() {
  llrpState = "waiting_start";
  send(startROSpec(), "START_ROSPEC");
}

/* ============================= */
/* PROCESS MESSAGE */
/* ============================= */

function processMessage(message) {
  const type = message.readUInt16BE(0) & 0x03ff;
  console.log("Message Type:", type);

  switch (type) {
    case MSG.READER_EVENT_NOTIFICATION:
      break;

    case MSG.KEEPALIVE:
      send(keepAliveAck(), "KEEPALIVE_ACK");
      break;

    case MSG.DELETE_ROSPEC_RESPONSE:
      logResponse("DELETE_ROSPEC_RESPONSE", message);
      if (isStatusSuccess(message)) {
        sendAddROSpec();
      } else {
        llrpState = "error";
        console.log("DELETE_ROSPEC failed. Stopping command chain.");
      }
      break;

    case MSG.ADD_ROSPEC_RESPONSE:
      logResponse("ADD_ROSPEC_RESPONSE", message);

      if (isStatusSuccess(message)) {
        sendEnableROSpec();
        break;
      }

      if (addTemplateIndex + 1 < ROSPEC_BUILDERS.length) {
        addTemplateIndex += 1;
        console.log("Trying next ROSpec template...");
        sendAddROSpec();
      } else {
        llrpState = "error";
        stopReportPolling();
        stopNoReportMonitor();
        stopZoneMonitor();
        console.log("All ROSpec templates failed. Reader rejected ADD_ROSPEC.");
      }
      break;

    case MSG.ENABLE_ROSPEC_RESPONSE:
      logResponse("ENABLE_ROSPEC_RESPONSE", message);

      if (isStatusSuccess(message)) {
        sendStartROSpec();
      } else {
        llrpState = "error";
        stopReportPolling();
        stopNoReportMonitor();
        stopZoneMonitor();
        console.log("ENABLE_ROSPEC failed. Stopping command chain.");
      }
      break;

    case MSG.START_ROSPEC_RESPONSE:
      logResponse("START_ROSPEC_RESPONSE", message);

      if (isStatusSuccess(message)) {
        llrpState = "running";
        lastReportAt = Date.now();
        send(enableEventsAndReports(), "ENABLE_EVENTS_AND_REPORTS");
        startReportPolling();
        startNoReportMonitor();
        startZoneMonitor();
        console.log("ROSpec started successfully");
      } else {
        llrpState = "error";
        stopReportPolling();
        stopNoReportMonitor();
        stopZoneMonitor();
        console.log("START_ROSPEC failed. Stopping command chain.");
      }
      break;

    case MSG.RO_ACCESS_REPORT: {
      lastReportAt = Date.now();
      const { epcs, tagReportDataCount } = extractEPCsFromAccessReport(message);

      if (!epcs.length) {
        console.log(
          `No EPC in RO_ACCESS_REPORT (TagReportData count: ${tagReportDataCount})`
        );
        break;
      }

      for (const epc of epcs) {
        touchTagSession(epc);

        if (!isDuplicate(epc)) {
          console.log("NEW EPC:", epc);
          tagBuffer.add(epc);
        } else {
          console.log("Duplicate ignored:", epc);
        }
      }

      scheduleFlush();
      break;
    }

    case MSG.ERROR_MESSAGE:
      logResponse("ERROR_MESSAGE", message);
      break;

    default:
      break;
  }
}

/* ============================= */
/* CONNECT */
/* ============================= */

function connect() {
  llrpState = "connecting";
  incomingBuffer = Buffer.alloc(0);
  stopReportPolling();
  stopNoReportMonitor();
  stopZoneMonitor();
  addTemplateIndex = 0;
  lastReportAt = Date.now();

  socket = new net.Socket();

  socket.connect(READER_PORT, READER_HOST, () => {
    console.log(
      `[bridge ${INSTANCE_ID}] connected to reader ${READER_HOST}:${READER_PORT}`
    );
    sendDeleteROSpec();
  });

  socket.on("data", handleData);

  socket.on("close", () => {
    console.log(
      `[bridge ${INSTANCE_ID}] reader disconnected. Reconnecting in ${Math.round(
        RECONNECT_DELAY_MS / 1000
      )}s...`
    );
    stopReportPolling();
    stopNoReportMonitor();
    stopZoneMonitor();

    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, RECONNECT_DELAY_MS);
    }
  });

  socket.on("error", (err) => {
    stopReportPolling();
    stopNoReportMonitor();
    stopZoneMonitor();
    console.log(`[bridge ${INSTANCE_ID}] socket error:`, err.message);
  });
}

connect();

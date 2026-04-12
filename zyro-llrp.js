const net = require("net");
const axios = require("axios");

const HOST = "192.168.100.50";
const PORT = 5084;

const API_URL = "http://localhost:3000/api/v1/scans/batch";
const SCAN_KEY = process.env.SCAN_API_KEY || "zyro_reader_001";

const DEVICE_ID = "FX9600_01";
const STORE_ID = "STORE_001";

let socket;
let messageID = 1;

/* ============================= */
/* LLRP HEADER BUILDER           */
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

/* ============================= */
/* LLRP COMMANDS                 */
/* ============================= */

function keepAliveAck() {
  return buildHeader(72, 10);
}

function deleteROSpec() {
  const header = buildHeader(20, 14);
  const body = Buffer.alloc(4);
  body.writeUInt32BE(0, 0);
  return Buffer.concat([header, body]);
}

function addROSpec() {
  const rospecBody = Buffer.from([
    0x00,0x00,0x00,0x01,
    0x00,
    0x00,
    0x00,0x00,

    0x00,0x01,
    0x00,0x12,

      0x00,0x01,
      0x00,0x06,
      0x01,
      0x00,

      0x00,0x02,
      0x00,0x06,
      0x00,
      0x00,

    0x00,0x02,
    0x00,0x1A,

      0x00,0x01,

      0x00,0x01,
      0x00,0x06,
      0x00,
      0x00,

      0x00,0x0A,
      0x00,0x08,
      0x00,0x01,
      0x00,0x00,

    0x00,0x07,
    0x00,0x0A,
    0x01,
    0x00,0x00,0x00,0x01
  ]);

  const header = buildHeader(22, 10 + rospecBody.length);
  return Buffer.concat([header, rospecBody]);
}

function enableROSpec() {
  const header = buildHeader(24, 14);
  const body = Buffer.alloc(4);
  body.writeUInt32BE(1, 0);
  return Buffer.concat([header, body]);
}

function startROSpec() {
  const header = buildHeader(26, 14);
  const body = Buffer.alloc(4);
  body.writeUInt32BE(1, 0);
  return Buffer.concat([header, body]);
}

/* ============================= */
/* EPC PARSER (FIXED)            */
/* ============================= */

function extractEPC(buffer) {
  // EPC-96 parameter type = 241 (0x00F1)
  const epcParamType = Buffer.from([0x00, 0xF1]);

  const index = buffer.indexOf(epcParamType);
  if (index === -1) return null;

  const epcLength = buffer.readUInt16BE(index + 2);
  const epcStart = index + 4;
  const epcEnd = index + epcLength;

  if (epcEnd > buffer.length) return null;

  const epcBuffer = buffer.slice(epcStart, epcEnd);
  return epcBuffer.toString("hex").toUpperCase();
}

/* ============================= */
/* SEND TO ZYRO                  */
/* ============================= */

async function sendToZyro(epc) {
  try {
    await axios.post(
      API_URL,
      {
        device_id: DEVICE_ID,
        store_id: STORE_ID,
        items: [
          {
            epc,
            ts: new Date().toISOString()
          }
        ]
      },
      {
        headers: {
          "x-scan-key": SCAN_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ Sent to Zyro:", epc);
  } catch (err) {
    console.log("❌ Zyro POST failed:", err.response?.data || err.message);
  }
}

/* ============================= */
/* MESSAGE HANDLER               */
/* ============================= */

function handleMessage(data) {
  const type = data.readUInt16BE(0) & 0x03ff;
  console.log("Received:", type);

  switch (type) {
    case 63:
      console.log("Reader Event");
      break;

    case 30:
      socket.write(addROSpec());
      break;

    case 32:
      socket.write(enableROSpec());
      break;

    case 34:
      socket.write(startROSpec());
      break;

    case 36:
      console.log("ROSpec Started");
      break;

    case 62:
      const epc = extractEPC(data);
      if (epc) {
        console.log("🔥 EPC:", epc);
        sendToZyro(epc);
      } else {
        console.log("Tag report but EPC not found");
      }
      break;

    case 100:
      socket.write(keepAliveAck());
      break;
  }
}

/* ============================= */
/* CONNECT + AUTO RECONNECT      */
/* ============================= */

function connect() {
  socket = new net.Socket();

  socket.connect(PORT, HOST, () => {
    console.log("Connected to FX9600");
    socket.write(deleteROSpec());
  });

  socket.on("data", handleMessage);

  socket.on("close", () => {
    console.log("Connection closed. Reconnecting in 3s...");
    setTimeout(connect, 3000);
  });

  socket.on("error", (err) => {
    console.log("Socket error:", err.message);
  });
}

connect();

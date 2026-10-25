const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 4000;
const DATA_FILE = path.join(__dirname, "elections-data.json");
const ADMIN_PASSWORD = "admin2026";

const PARTIES = [
  { id: "yashar", name: "ישר!", leader: "גדי איזנקוט" },
  { id: "likud", name: "הליכוד", leader: "בנימין נתניהו" },
  { id: "beyachad", name: "ביחד", leader: "נפתלי בנט + יאיר לפיד" },
  { id: "democrats", name: "הדמוקרטים", leader: "יאיר גולן" },
  { id: "yisrael_beiteinu", name: "ישראל ביתנו", leader: "אביגדור ליברמן" },
  { id: "shas", name: 'ש"ס', leader: "אריה דרעי" },
  { id: "otzma", name: "עוצמה יהודית", leader: "איתמר בן גביר" },
  { id: "utj", name: "יהדות התורה", leader: "יצחק גולדקנופף" },
  { id: "religious_zionism", name: "הציונות הדתית", leader: "בצלאל סמוטריץ'" },
  { id: "joint_list", name: "הרשימה המשותפת", leader: 'חד"ש-תע"ל-בל"ד' },
  { id: "raam", name: 'רע"ם', leader: "מנסור עבאס" },
  { id: "reservists", name: "המילואימניקים", leader: "יועז הנדל + ירון זליכה" },
  { id: "amcha", name: "עמך ישראל", leader: "עופר וינטר" },
  { id: "blue_white", name: "כחול לבן", leader: "בני גנץ" },
];

const PARTY_IDS = new Set(PARTIES.map((p) => p.id));
let data = { predictions: {}, actualResults: null };

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    data = JSON.parse(raw);
    if (!data.predictions) data.predictions = {};
  } catch (_) {
    data = { predictions: {}, actualResults: null };
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

loadData();

function buildState() {
  return { predictions: Object.values(data.predictions), actualResults: data.actualResults };
}

const connectedSockets = new Set();

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const ws of connectedSockets) {
    if (ws && ws.readyState === "open") ws.send(payload);
  }
}

function broadcastState() {
  broadcast({ type: "STATE", payload: buildState() });
}

function sendTo(ws, message) {
  if (ws && ws.readyState === "open") ws.send(JSON.stringify(message));
}

function handleSubmitPrediction(ws, payload) {
  const { name, predictions: preds, orderId: existingId } = payload || {};
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    sendTo(ws, { type: "ERROR", payload: { message: "שם נדרש." } });
    return;
  }
  if (!preds || typeof preds !== "object") {
    sendTo(ws, { type: "ERROR", payload: { message: "חיזוי לא תקין." } });
    return;
  }
  let total = 0;
  for (const [partyId, value] of Object.entries(preds)) {
    if (!PARTY_IDS.has(partyId)) {
      sendTo(ws, { type: "ERROR", payload: { message: "מפלגה לא מוכרת: " + partyId } });
      return;
    }
    const num = Number(value);
    if (!Number.isInteger(num) || num < 0) {
      sendTo(ws, { type: "ERROR", payload: { message: "ערך לא תקין עבור " + partyId } });
      return;
    }
    preds[partyId] = num;
    total += num;
  }
  if (total !== 120) {
    sendTo(ws, { type: "ERROR", payload: { message: 'סה"כ המנדטים חייב להיות 120. כרגע: ' + total } });
    return;
  }
  const orderId = existingId && data.predictions[existingId] ? existingId : crypto.randomUUID();
  data.predictions[orderId] = { name: name.trim(), orderId, predictions: preds, submittedAt: Date.now() };
  saveData();
  sendTo(ws, { type: "PREDICTION_SAVED", payload: { orderId } });
  broadcastState();
}

function handleSetResults(ws, payload) {
  const { password, results } = payload || {};
  if (password !== ADMIN_PASSWORD) {
    sendTo(ws, { type: "ERROR", payload: { message: "סיסמה שגויה." } });
    return;
  }
  if (!results || typeof results !== "object") {
    sendTo(ws, { type: "ERROR", payload: { message: "תוצאות לא תקינות." } });
    return;
  }
  let total = 0;
  for (const [partyId, value] of Object.entries(results)) {
    const num = Number(value);
    if (!Number.isInteger(num) || num < 0) {
      sendTo(ws, { type: "ERROR", payload: { message: "ערך לא תקין עבור " + partyId } });
      return;
    }
    results[partyId] = num;
    total += num;
  }
  if (total !== 120) {
    sendTo(ws, { type: "ERROR", payload: { message: 'סה"כ תוצאות חייב להיות 120. כרגע: ' + total } });
    return;
  }
  data.actualResults = results;
  saveData();
  broadcastState();
}

const server = http.createServer((req, res) => {
  const safePath = req.url.split("?")[0];
  const filePath = path.join(__dirname, "public-elections", safePath === "/" ? "/index.html" : safePath);
  if (!filePath.startsWith(path.join(__dirname, "public-elections"))) {
    res.writeHead(404);
    res.end();
    return;
  }
  fs.readFile(filePath, (err, fileData) => {
    if (err) { res.writeHead(404); res.end(); return; }
    const ext = path.extname(filePath);
    const typeMap = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };
    res.writeHead(200, { "Content-Type": typeMap[ext] || "text/plain" });
    res.end(fileData);
  });
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11", "binary").digest("base64");
  socket.write(["HTTP/1.1 101 Switching Protocols","Upgrade: websocket","Connection: Upgrade","Sec-WebSocket-Accept: " + accept].join("\r\n") + "\r\n\r\n");

  const ws = {
    socket, readyState: "open",
    send: (rawData) => {
      if (ws.readyState !== "open") return;
      const payload = Buffer.from(rawData);
      const frame = [0x81];
      if (payload.length < 126) frame.push(payload.length);
      else if (payload.length < 65536) frame.push(126, (payload.length >> 8) & 255, payload.length & 255);
      else frame.push(127, 0, 0, 0, 0, (payload.length >> 24) & 255, (payload.length >> 16) & 255, (payload.length >> 8) & 255, payload.length & 255);
      socket.write(Buffer.concat([Buffer.from(frame), payload]));
    },
  };

  connectedSockets.add(ws);
  sendTo(ws, { type: "STATE", payload: buildState() });
  let buffer = Buffer.alloc(0);

  socket.on("data", (incoming) => {
    buffer = Buffer.concat([buffer, incoming]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const isMasked = (buffer[1] & 0x80) === 0x80;
      let payloadLength = buffer[1] & 0x7f;
      let offset = 2;
      if (payloadLength === 126) { if (buffer.length < 4) return; payloadLength = buffer.readUInt16BE(2); offset = 4; }
      else if (payloadLength === 127) { if (buffer.length < 10) return; payloadLength = buffer.readUInt32BE(6); offset = 10; }
      const totalLength = offset + (isMasked ? 4 : 0) + payloadLength;
      if (buffer.length < totalLength) return;
      let payload = buffer.slice(offset, totalLength);
      if (isMasked) {
        const mask = buffer.slice(offset, offset + 4);
        payload = buffer.slice(offset + 4, totalLength);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      buffer = buffer.slice(totalLength);
      if (opcode === 0x8) { ws.readyState = "closed"; connectedSockets.delete(ws); socket.end(); return; }
      if (opcode === 0x9) { socket.write(Buffer.from([0x8a, 0x00])); continue; }
      if (opcode !== 0x1) continue;
      let message;
      try { message = JSON.parse(payload.toString("utf8")); } catch (_) { sendTo(ws, { type: "ERROR", payload: { message: "JSON לא תקין." } }); continue; }
      switch (message.type) {
        case "SUBMIT_PREDICTION": handleSubmitPrediction(ws, message.payload); break;
        case "GET_STATE": sendTo(ws, { type: "STATE", payload: buildState() }); break;
        case "SET_RESULTS": handleSetResults(ws, message.payload); break;
        default: sendTo(ws, { type: "ERROR", payload: { message: "סוג הודעה לא מוכר." } });
      }
    }
  });
  socket.on("close", () => { ws.readyState = "closed"; connectedSockets.delete(ws); });
  socket.on("error", () => { ws.readyState = "closed"; connectedSockets.delete(ws); });
});

server.listen(PORT, () => { console.log("Elections server listening on http://localhost:" + PORT); });

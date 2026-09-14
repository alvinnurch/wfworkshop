#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════
   Platform Workshop Terintegrasi — server
   ──────────────────────────────────────────────────────────────
   Satu berkas, TANPA dependensi (hanya modul bawaan Node.js).
   Menjalankan dua hal sekaligus:
     • menyajikan halaman aplikasi dari folder public/
     • menyediakan API di /api  (bentuknya sama seperti versi lama,
       jadi halaman tidak perlu diubah)

   Jalankan:   node server.js
   Pengaturan lewat variabel lingkungan (semuanya opsional):
     PORT=8080            port pendengar
     ADMIN_PASSWORD=...   sandi panitia (default: sayaadminnya)
     DATA_FILE=data.json  lokasi berkas data
   ══════════════════════════════════════════════════════════════ */

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const ADMIN = process.env.ADMIN_PASSWORD || 'sayaadminnya';
const DATA_FILE = path.resolve(process.env.DATA_FILE || path.join(__dirname, 'data.json'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'unggahan');

/* ── Data: dipegang di memori, ditulis ke berkas secara atomik ── */
const EMPTY = { sessions: [], activeSessionId: null, participants: [], groups: [], responses: {} };
let db = load();
let version = 1;
let writeTimer = null;

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.sessions)) return normalize(parsed);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[workshop] data.json tidak terbaca, memulai kosong:', e.message);
  }
  return JSON.parse(JSON.stringify(EMPTY));
}
function normalize(d) {
  d.sessions = d.sessions || [];
  d.participants = d.participants || [];
  d.groups = Array.isArray(d.groups) ? d.groups : [];
  d.responses = d.responses || {};
  d.sessions.forEach(s => {
    if (!d.responses[s.id]) d.responses[s.id] = { checkins: {}, quiz: {}, words: [], feedback: {}, forms: {} };
    const r = d.responses[s.id];
    r.checkins = r.checkins || {}; r.quiz = r.quiz || {};
    r.words = r.words || []; r.feedback = r.feedback || {}; r.forms = r.forms || {};
  });
  if (!d.activeSessionId && d.sessions[0]) d.activeSessionId = d.sessions[0].id;
  return d;
}
/* Tulis tertunda 400 ms lalu diganti-nama — aman bila server mati mendadak. */
function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    const tmp = DATA_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(db), 'utf8');
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) { console.error('[workshop] gagal menulis data:', e.message); }
  }, 400);
}
function touch() { version++; persist(); broadcast(); }
function slot(sessionId) {
  if (!db.responses[sessionId]) db.responses[sessionId] = { checkins: {}, quiz: {}, words: [], feedback: {}, forms: {} };
  return db.responses[sessionId];
}
function blockOf(sessionId, blockId) {
  const s = db.sessions.find(x => x.id === sessionId);
  return s ? (s.blocks || []).find(b => b.id === blockId) : null;
}

/* ── Realtime: server-sent events ── */
const clients = new Set();
function broadcast() {
  const line = 'data: ' + JSON.stringify({ version }) + '\n\n';
  for (const res of clients) { try { res.write(line); } catch (e) { clients.delete(res); } }
}

/* ── Utilitas HTTP ── */
function json(res, obj, code) {
  const body = JSON.stringify(obj);
  res.writeHead(code || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', c => {
      size += c.length;
      if (size > (limit || 12 * 1024 * 1024)) { reject(new Error('Kiriman terlalu besar.')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Terlarang'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Tidak ditemukan'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* ── API ── */
function handleAction(p) {
  const admin = p.password === ADMIN;

  switch (p.action) {
    case 'login': {
      const code = String(p.code || '').trim().toUpperCase();
      const hit = db.participants.filter(x => String(x.code || '').toUpperCase() === code);
      if (!hit.length) return { ok: false, error: 'Kode peserta tidak dikenali.' };
      if (hit.length > 1) return { ok: false, error: 'Kode ini terdaftar lebih dari sekali.' };
      return { ok: true, data: { id: hit[0].id, name: hit[0].name, group: hit[0].group } };
    }

    case 'checkin': {
      const b = blockOf(p.sessionId, p.blockId);
      if (!b) return { ok: false, error: 'Materi check in tidak ditemukan.' };
      if (!b.open) return { ok: false, error: 'Check in belum dibuka fasilitator.' };
      const want = String(b.token || '').toUpperCase();
      const got = String(p.token || '').toUpperCase().trim();
      const cocok = got === want || got === 'WS-CHECKIN:' + String(p.sessionId).toUpperCase() + ':' + want;
      if (!cocok) return { ok: false, error: 'Kode barcode tidak sesuai sesi ini.' };
      slot(p.sessionId).checkins[p.id] = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      touch();
      return { ok: true };
    }

    case 'quiz': {
      const b = blockOf(p.sessionId, p.blockId);
      if (!b) return { ok: false, error: 'Kuis tidak ditemukan.' };
      const qs = b.questions || [];
      const answers = p.answers || [];
      const benar = qs.filter((q, i) => answers[i] === q.answer).length;
      const score = qs.length ? Math.round(benar / qs.length * 100) : 0;
      const R = slot(p.sessionId);
      if (!R.quiz[p.blockId]) R.quiz[p.blockId] = {};
      const prev = R.quiz[p.blockId][p.id];
      const maxTries = b.allowRetake ? Math.max(1, b.retakeMax || 2) : 1;
      const tries = ((prev && prev.tries) || 0) + 1;
      if (tries > maxTries) return { ok: false, error: 'Kesempatan mengerjakan kuis sudah terpakai (' + maxTries + '×).' };
      R.quiz[p.blockId][p.id] = { answers, score, tries };
      touch();
      return { ok: true, data: { score } };
    }

    case 'word': {
      const R = slot(p.sessionId);
      const mine = R.words.filter(w => w.blockId === p.blockId && w.by === p.id);
      if (mine.length >= 3) return { ok: false, error: 'Kuota tiga kata sudah terpakai.' };
      const w = String(p.word || '').trim().toLowerCase();
      if (!w) return { ok: false, error: 'Kata kosong.' };
      R.words.push({ blockId: p.blockId, word: w, by: p.id });
      touch();
      return { ok: true };
    }

    case 'feedback': {
      const R = slot(p.sessionId);
      if (!R.feedback[p.blockId]) R.feedback[p.blockId] = {};
      R.feedback[p.blockId][p.id] = { emoji: p.emoji || '', note: p.note || '' };
      touch();
      return { ok: true };
    }

    case 'form': {
      const R = slot(p.sessionId);
      if (!R.forms[p.blockId]) R.forms[p.blockId] = {};
      R.forms[p.blockId][p.id] = p.values || {};
      touch();
      return { ok: true };
    }

    case 'upload': {
      try {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        const safe = String(p.fileName || 'berkas').replace(/[^\w.\-]/g, '_');
        const name = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '-' + safe;
        fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(p.dataBase64 || '', 'base64'));
        const url = 'unggahan/' + name;
        const R = slot(p.sessionId);
        if (!R.forms[p.blockId]) R.forms[p.blockId] = {};
        if (!R.forms[p.blockId][p.id]) R.forms[p.blockId][p.id] = {};
        R.forms[p.blockId][p.id][p.fieldId] = url;
        R.forms[p.blockId][p.id][p.fieldId + '_nama'] = p.fileName || '';
        touch();
        return { ok: true, data: { url } };
      } catch (e) { return { ok: false, error: 'Unggahan gagal: ' + e.message }; }
    }

    /* Admin menyimpan seluruh susunan; jawaban peserta tidak ditimpa. */
    case 'putDb': {
      if (!admin) return { ok: false, error: 'Kata sandi admin salah.' };
      const incoming = p.db || {};
      db.sessions = incoming.sessions || [];
      db.participants = incoming.participants || [];
      db.groups = Array.isArray(incoming.groups) ? incoming.groups : (db.groups || []);
      db.activeSessionId = incoming.activeSessionId || (db.sessions[0] ? db.sessions[0].id : null);
      const keep = db.responses || {};
      db.responses = {};
      db.sessions.forEach(s => {
        db.responses[s.id] = keep[s.id] || { checkins: {}, quiz: {}, words: [], feedback: {}, forms: {} };
      });
      normalize(db);
      touch();
      return { ok: true };
    }

    /* Kendali langsung: hanya status buka/aktif/hitungan. */
    case 'putLive': {
      if (!admin) return { ok: false, error: 'Kata sandi admin salah.' };
      const map = {};
      (p.open || []).forEach(o => { map[o.id] = !!o.open; });
      db.activeSessionId = p.activeSessionId || db.activeSessionId;
      db.sessions.forEach(s => {
        (s.blocks || []).forEach(b => { if (Object.prototype.hasOwnProperty.call(map, b.id)) b.open = map[b.id]; });
        if (s.id === p.sessionId) { s.active = p.active || null; s.run = p.run || null; }
      });
      touch();
      return { ok: true };
    }

    case 'checkAdmin':
      return admin ? { ok: true } : { ok: false, error: 'Kata sandi salah.' };

    case 'reset': {
      if (!admin) return { ok: false, error: 'Kata sandi admin salah.' };
      db.sessions.forEach(s => { db.responses[s.id] = { checkins: {}, quiz: {}, words: [], feedback: {}, forms: {} }; });
      touch();
      return { ok: true };
    }

    default:
      return { ok: false, error: 'Aksi tidak dikenal: ' + p.action };
  }
}

/* ── Server ── */
const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  if (req.method === 'OPTIONS') return json(res, { ok: true });

  /* Realtime: halaman berlangganan perubahan */
  if (url.startsWith('/api/events')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 3000\n\n');
    res.write('data: ' + JSON.stringify({ version }) + '\n\n');
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (url.startsWith('/api')) {
    if (req.method === 'GET') {
      if (url.indexOf('action=health') >= 0) return json(res, { ok: true, data: { version, sessions: db.sessions.length } });
      return json(res, { ok: true, data: db, version });
    }
    if (req.method === 'POST') {
      try {
        const body = await readBody(req);
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch (e) { return json(res, { ok: false, error: 'Kiriman bukan JSON yang sah.' }); }
        return json(res, handleAction(payload));
      } catch (e) { return json(res, { ok: false, error: e.message }); }
    }
    return json(res, { ok: false, error: 'Metode tidak didukung.' }, 405);
  }

  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log('┌───────────────────────────────────────────────');
  console.log('│ Platform Workshop Terintegrasi');
  console.log('│ Berjalan di   : http://localhost:' + PORT);
  console.log('│ Data          : ' + DATA_FILE);
  console.log('│ Sandi admin   : ' + (process.env.ADMIN_PASSWORD ? '(dari ADMIN_PASSWORD)' : ADMIN + '  ← segera ganti!'));
  console.log('└───────────────────────────────────────────────');
});

/* Simpan data sebelum berhenti */
['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => {
  clearTimeout(writeTimer);
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db), 'utf8'); } catch (e) {}
  process.exit(0);
}));

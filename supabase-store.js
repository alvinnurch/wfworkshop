/* ══════════════════════════════════════════════════════════════
   Platform Workshop Terintegrasi — penghubung ke Supabase
   ──────────────────────────────────────────────────────────────
   Berkas ini menerjemahkan permintaan halaman (yang semula ke
   Apps Script) menjadi panggilan ke Postgres milik Supabase.
   Halaman aplikasi TIDAK diubah: ia tetap memanggil
   window.WORKSHOP_API seperti biasa.

   Keuntungannya:
   • Realtime — perubahan admin sampai ke peserta & proyektor
     dalam hitungan milidetik, tanpa menunggu putaran pembacaan.
   • Pembacaan dilayani dari salinan di memori, jadi 1000 peserta
     sekaligus tidak membebani server.
   ══════════════════════════════════════════════════════════════ */
(function () {
  var CFG = window.SUPABASE || {};
  if (!CFG.url || !CFG.anonKey) {
    console.warn('[workshop] SUPABASE.url / SUPABASE.anonKey belum diisi di config.js — halaman berjalan dalam mode demo.');
    return;
  }
  var BASE = String(CFG.url).replace(/\/+$/, '');
  var KEY = CFG.anonKey;
  var SENTINEL = 'workshop://supabase';
  window.WORKSHOP_API = SENTINEL;

  var cache = null;         // salinan data terakhir
  var pending = null;       // pembacaan yang sedang berjalan
  var listeners = [];
  var lastFetch = 0;

  function rest(path, opts) {
    opts = opts || {};
    var headers = {
      apikey: KEY,
      Authorization: 'Bearer ' + KEY,
      'Content-Type': 'application/json'
    };
    if (opts.headers) for (var k in opts.headers) headers[k] = opts.headers[k];
    return fetch(BASE + '/rest/v1' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); });
      return r.status === 204 ? null : r.json();
    });
  }
  function rpc(name, args) { return rest('/rpc/' + name, { method: 'POST', body: args || {} }); }
  function upsert(table, row, onConflict) {
    return rest('/' + table + (onConflict ? '?on_conflict=' + onConflict : ''), {
      method: 'POST', body: [row],
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
    });
  }

  /* ── Susun ulang data menjadi bentuk yang dipakai halaman ── */
  function build() {
    return Promise.all([
      rest('/workshop_config?id=eq.1&select=doc'),
      rest('/live_state?id=eq.1&select=*'),
      rest('/participants?select=*&order=name.asc'),
      rest('/checkins?select=*'),
      rest('/quiz_answers?select=*'),
      rest('/words?select=*&order=id.asc'),
      rest('/feedback?select=*'),
      rest('/form_answers?select=*')
    ]).then(function (r) {
      var doc = (r[0] && r[0][0] && r[0][0].doc) || {};
      var live = (r[1] && r[1][0]) || {};
      var sessions = JSON.parse(JSON.stringify(doc.sessions || []));
      var openMap = live.open_blocks || {};

      sessions.forEach(function (s) {
        (s.blocks || []).forEach(function (b) {
          if (Object.prototype.hasOwnProperty.call(openMap, b.id)) b.open = !!openMap[b.id];
        });
        if (s.id === live.active_session_id) {
          s.active = live.active_block_id || null;
          s.run = live.run || null;
        }
      });

      var participants = (r[2] || []).map(function (p) {
        return { id: p.id, name: p.name, code: String(p.code || '').toUpperCase(), group: p.grp || '', org: p.org || '', phone: p.phone || '', email: p.email || '' };
      });

      var responses = {};
      function slot(sid) {
        if (!responses[sid]) responses[sid] = { checkins: {}, quiz: {}, words: [], feedback: {}, forms: {} };
        return responses[sid];
      }
      sessions.forEach(function (s) { slot(s.id); });
      (r[3] || []).forEach(function (c) { slot(c.session_id).checkins[c.participant_id] = c.at_label || '✓'; });
      (r[4] || []).forEach(function (q) {
        var R = slot(q.session_id);
        if (!R.quiz[q.block_id]) R.quiz[q.block_id] = {};
        R.quiz[q.block_id][q.participant_id] = { answers: q.answers || [], score: q.score || 0, tries: q.tries || 1 };
      });
      (r[5] || []).forEach(function (w) { slot(w.session_id).words.push({ blockId: w.block_id, word: w.word, by: w.participant_id }); });
      (r[6] || []).forEach(function (f) {
        var R = slot(f.session_id);
        if (!R.feedback[f.block_id]) R.feedback[f.block_id] = {};
        R.feedback[f.block_id][f.participant_id] = { emoji: f.emoji || '', note: f.note || '' };
      });
      (r[7] || []).forEach(function (a) {
        var R = slot(a.session_id);
        if (!R.forms[a.block_id]) R.forms[a.block_id] = {};
        if (!R.forms[a.block_id][a.participant_id]) R.forms[a.block_id][a.participant_id] = {};
        R.forms[a.block_id][a.participant_id][a.field_id] = a.value;
        if (a.file_name) R.forms[a.block_id][a.participant_id][a.field_id + '_nama'] = a.file_name;
      });

      return {
        sessions: sessions,
        activeSessionId: live.active_session_id || (sessions[0] ? sessions[0].id : null),
        participants: participants,
        responses: responses
      };
    });
  }

  function refresh() {
    if (pending) return pending;
    pending = build().then(function (db) {
      cache = db; lastFetch = Date.now(); pending = null;
      listeners.forEach(function (fn) { try { fn(db); } catch (e) {} });
      return db;
    }, function (err) { pending = null; throw err; });
    return pending;
  }

  /* ── Realtime: begitu ada perubahan, salinan disegarkan ── */
  var rtTimer = null;
  function nudge() {
    clearTimeout(rtTimer);
    rtTimer = setTimeout(function () { refresh().catch(function () {}); }, 120);
  }
  function connectRealtime() {
    try {
      var wsUrl = BASE.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(KEY) + '&vsn=1.0.0';
      var ws = new WebSocket(wsUrl);
      var ref = 0;
      ws.onopen = function () {
        ws.send(JSON.stringify({
          topic: 'realtime:workshop', event: 'phx_join', ref: String(++ref),
          payload: {
            config: {
              broadcast: { self: false }, presence: { key: '' },
              postgres_changes: [{ event: '*', schema: 'public' }]
            }
          }
        }));
        setInterval(function () {
          if (ws.readyState === 1) ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }));
        }, 25000);
      };
      ws.onmessage = function (ev) {
        try {
          var msg = JSON.parse(ev.data);
          if (msg.event === 'postgres_changes' || msg.event === 'INSERT' || msg.event === 'UPDATE' || msg.event === 'DELETE') nudge();
        } catch (e) {}
      };
      ws.onclose = function () { setTimeout(connectRealtime, 3000); };
      ws.onerror = function () { try { ws.close(); } catch (e) {} };
    } catch (e) {
      /* Tanpa realtime pun halaman tetap jalan: pembacaan berkala tetap ada. */
    }
  }
  connectRealtime();
  refresh().catch(function (e) { console.warn('[workshop] gagal memuat data awal', e); });

  /* ── Terjemahkan permintaan halaman ── */
  function ok(data) { return jsonResponse({ ok: true, data: data }); }
  function fail(msg) { return jsonResponse({ ok: false, error: String(msg) }); }
  function jsonResponse(obj) {
    return Promise.resolve(new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }

  function maxTriesOf(sessionId, blockId) {
    var db = cache || { sessions: [] };
    var s = (db.sessions || []).filter(function (x) { return x.id === sessionId; })[0];
    var b = s && (s.blocks || []).filter(function (x) { return x.id === blockId; })[0];
    if (!b) return 1;
    return b.allowRetake ? Math.max(1, b.retakeMax || 2) : 1;
  }

  function handle(p) {
    var pw = p.password || '';
    switch (p.action) {
      case 'login': {
        var code = String(p.code || '').toUpperCase().trim();
        var hit = ((cache && cache.participants) || []).filter(function (x) { return String(x.code).toUpperCase() === code; });
        if (!hit.length) return fail('Kode peserta tidak dikenali.');
        return ok({ id: hit[0].id, name: hit[0].name, group: hit[0].group });
      }
      case 'checkin':
        return upsert('checkins', {
          session_id: p.sessionId, participant_id: p.id,
          at_label: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
          method: 'barcode'
        }, 'session_id,participant_id').then(function () { nudge(); return ok(true); }, fail);

      case 'quiz': {
        var answers = p.answers || [];
        var db = cache || { sessions: [] };
        var s = (db.sessions || []).filter(function (x) { return x.id === p.sessionId; })[0];
        var b = s && (s.blocks || []).filter(function (x) { return x.id === p.blockId; })[0];
        var qs = (b && b.questions) || [];
        var correct = qs.filter(function (q, i) { return answers[i] === q.answer; }).length;
        var score = qs.length ? Math.round(correct / qs.length * 100) : 0;
        return rpc('submit_quiz', {
          p_session: p.sessionId, p_block: p.blockId, p_participant: p.id,
          p_answers: answers, p_score: score, p_max_tries: maxTriesOf(p.sessionId, p.blockId)
        }).then(function () { nudge(); return ok({ score: score }); }, fail);
      }

      case 'word':
        return rest('/words', {
          method: 'POST',
          body: [{ session_id: p.sessionId, block_id: p.blockId, participant_id: p.id, word: String(p.word || '').trim().toLowerCase() }],
          headers: { Prefer: 'return=minimal' }
        }).then(function () { nudge(); return ok(true); }, fail);

      case 'feedback':
        return upsert('feedback', {
          session_id: p.sessionId, block_id: p.blockId, participant_id: p.id,
          emoji: p.emoji || '', note: p.note || ''
        }, 'session_id,block_id,participant_id').then(function () { nudge(); return ok(true); }, fail);

      case 'form': {
        var vals = p.values || {};
        var rows = Object.keys(vals).filter(function (k) { return k.indexOf('_nama') < 0; }).map(function (fid) {
          return {
            session_id: p.sessionId, block_id: p.blockId, participant_id: p.id, field_id: fid,
            value: vals[fid] == null ? '' : String(vals[fid]), file_name: vals[fid + '_nama'] || ''
          };
        });
        if (!rows.length) return ok(true);
        return rest('/form_answers?on_conflict=session_id,block_id,participant_id,field_id', {
          method: 'POST', body: rows,
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
        }).then(function () { nudge(); return ok(true); }, fail);
      }

      case 'upload': {
        var name = Date.now() + '-' + String(p.fileName || 'berkas').replace(/[^\w.\-]/g, '_');
        var bin = atob(p.dataBase64 || '');
        var buf = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return fetch(BASE + '/storage/v1/object/' + (CFG.bucket || 'unggahan') + '/' + name, {
          method: 'POST',
          headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': p.mimeType || 'application/octet-stream' },
          body: buf
        }).then(function (r) {
          if (!r.ok) return fail('Unggahan gagal. Periksa bucket penyimpanan di Supabase.');
          var url = BASE + '/storage/v1/object/public/' + (CFG.bucket || 'unggahan') + '/' + name;
          return upsert('form_answers', {
            session_id: p.sessionId, block_id: p.blockId, participant_id: p.id,
            field_id: p.fieldId, value: url, file_name: p.fileName || ''
          }, 'session_id,block_id,participant_id,field_id').then(function () { nudge(); return ok({ url: url }); });
        }, fail);
      }

      case 'putDb': {
        var d = p.db || {};
        var doc = { sessions: d.sessions || [] };
        var openMap = {};
        var activeSession = d.activeSessionId || null;
        var activeBlock = null, run = null;
        (d.sessions || []).forEach(function (s) {
          (s.blocks || []).forEach(function (b) { openMap[b.id] = !!b.open; });
          if (s.id === activeSession) { activeBlock = s.active || null; run = s.run || null; }
        });
        return rpc('save_config', { p_password: pw, p_doc: doc })
          .then(function () { return rpc('save_participants', { p_password: pw, p_rows: d.participants || [] }); })
          .then(function () { return rpc('save_live', { p_password: pw, p_session: activeSession, p_block: activeBlock, p_run: run, p_open: openMap }); })
          .then(function () { nudge(); return ok(true); }, function (e) {
            return fail(/unauthorized/i.test(String(e)) ? 'Kata sandi admin tidak cocok dengan yang tersimpan di Supabase.' : e);
          });
      }

      case 'putLive': {
        var map = {};
        (p.open || []).forEach(function (o) { map[o.id] = !!o.open; });
        return rpc('save_live', {
          p_password: pw, p_session: p.activeSessionId || null,
          p_block: p.active || null, p_run: p.run || null, p_open: map
        }).then(function () { nudge(); return ok(true); }, fail);
      }

      default:
        return fail('unknown action');
    }
  }

  /* ── Sadap fetch hanya untuk alamat sentinel ── */
  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf(SENTINEL) !== 0) return nativeFetch(input, init);

    var method = ((init && init.method) || 'GET').toUpperCase();
    if (method === 'GET') {
      var fresh = cache && Date.now() - lastFetch < 800;
      var job = fresh ? Promise.resolve(cache) : refresh();
      return job.then(ok, function (e) { return fail(e); });
    }
    var payload = {};
    try { payload = JSON.parse((init && init.body) || '{}'); } catch (e) {}
    return handle(payload);
  };

  window.WORKSHOP_STORE = { refresh: refresh, onChange: function (fn) { listeners.push(fn); }, get: function () { return cache; } };
})();

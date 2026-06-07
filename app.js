/* ============================================================
   Android Track — Firebase Firestore sync edition
   All state lives in Firestore under a single shared doc.
   All devices listen via onSnapshot → instant real-time sync.
   ============================================================ */

/* ---------- Firebase init (CDN globals: firebase, db) ---------- */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCTB57lD1azZpwrRn5nk2LymqVd63UIJIU",
  authDomain: "android-tracker-1678c.firebaseapp.com",
  projectId: "android-tracker-1678c",
  storageBucket: "android-tracker-1678c.firebasestorage.app",
  messagingSenderId: "243093891807",
  appId: "1:243093891807:web:6ae4a161f5be3e782c176a"
};

firebase.initializeApp(FIREBASE_CONFIG);
const auth  = firebase.auth();
const db    = firebase.firestore();

// Enable offline persistence so app works without internet
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

// Single shared document — all your devices write to the same place
const DOC = db.collection('trackers').doc('neil');

/* ---------- local state (mirror of Firestore doc) ---------- */
let S = fresh();
let _saving = false; // debounce flag

function fresh() {
  return {
    tasks: {}, logs: [], apps: [],
    rem: { daily: false, git: false, apply: false, time: '18:00' },
    streak: 0, lastLog: null
  };
}

/* ---------- Firestore read/write ---------- */
async function saveToFirestore(patch) {
  try {
    await DOC.set(patch, { merge: true });
  } catch (e) {
    console.warn('Firestore write error', e);
    toast('⚠️ Offline — will sync when back online');
  }
}

// Debounced full save (for rapid checkbox tapping)
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveToFirestore(S), 600);
}

// Immediate save (for logs, apps, reminders)
function saveNow() {
  clearTimeout(saveTimer);
  return saveToFirestore(S);
}

/* ---------- Real-time listener ---------- */
function startListener() {
  const badge = document.getElementById('syncbadge');
  DOC.onSnapshot(snap => {
    if (badge) { badge.textContent = '✅ synced'; badge.style.color = 'var(--accent)'; }
    if (!snap.exists) {
      // First run — create the doc with fresh state, then render
      DOC.set(S).catch(() => {});
      renderAll();
      return;
    }
    const remote = snap.data();
    S = Object.assign(fresh(), remote);
    renderAll();
  }, err => {
    console.warn('Snapshot error', err);
    if (badge) { badge.textContent = '⚠️ offline'; badge.style.color = 'var(--warn)'; }
    renderAll(); // still render with local state
  });
}

/* ---------- Auth (anonymous — each browser session gets an ID) ---------- */
auth.signInAnonymously().then(() => {
  startListener();
}).catch(e => {
  console.warn('Auth failed, running offline', e);
  // Still render with whatever's in memory
  renderAll();
});

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function toast(m) {
  const t = $('#toast');
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function pcolor(p) {
  return getComputedStyle(document.documentElement).getPropertyValue('--p' + p).trim();
}

function currentWeek() {
  const diff = Math.floor((new Date() - PLAN_START) / (7 * 864e5)) + 1;
  return Math.min(16, Math.max(1, diff));
}

/* ---------- PLAN ---------- */
let activePhase = 0;

function renderPhases() {
  $('#phasestrip').innerHTML =
    `<button class="pchip ${activePhase === 0 ? 'on' : ''}" onclick="setPhase(0)">All weeks</button>` +
    PHASES.map(p => `<button class="pchip ${activePhase === p.id ? 'on' : ''}" onclick="setPhase(${p.id})">P${p.id} · ${p.name}</button>`).join('');
}

function setPhase(p) { activePhase = p; renderPhases(); renderWeeks(); }

function weekStats(w) {
  let done = 0, total = w.tasks.length;
  w.tasks.forEach((t, i) => { if (S.tasks[w.w + '-' + i]) done++; });
  return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
}

function renderWeeks() {
  const cur = currentWeek();
  const list = WEEKS.filter(w => activePhase === 0 || w.p === activePhase);
  $('#weeks').innerHTML = list.map(w => {
    const st = weekStats(w);
    const col = pcolor(w.p);
    const groups = [...new Set(w.tasks.map(t => t.g))];
    const isCur = w.w === cur;
    return `<div class="week ${isCur ? 'open' : ''}" id="wk${w.w}">
      <div class="wkhead" onclick="toggleWeek(${w.w})">
        <div class="wknum" style="background:${col}">${w.w}<small>WEEK</small></div>
        <div class="wkinfo">
          <h3>${w.focus}${w.apply ? '<span class="applybadge">APPLY</span>' : ''}</h3>
          <div class="dates">${w.dates} · Phase ${w.p}${isCur ? ' · 👈 this week' : ''}</div>
        </div>
        <div class="wkprog">
          <div class="wkbar"><i style="width:${st.pct}%;background:${col}"></i></div>
          <svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
        </div>
      </div>
      <div class="wkbody"><div class="wkbody-inner">
        ${groups.map(g => `<div class="grp ${g}"><h4>${GROUP_LABELS[g]}</h4>${
          w.tasks.map((t, i) => t.g === g ? taskRow(w.w, i, t) : '').join('')
        }</div>`).join('')}
      </div></div>
    </div>`;
  }).join('');
}

function taskRow(wk, i, t) {
  const id = wk + '-' + i, done = S.tasks[id];
  return `<div class="task ${done ? 'done' : ''}" id="task-${id}">
    <div class="cb ${done ? 'done' : ''}" onclick="toggleTask('${id}')"><svg viewBox="0 0 14 14"><path d="M2 7l3.5 3.5L12 3"/></svg></div>
    <div class="tasktext">${t.t}</div>
  </div>`;
}

function toggleWeek(w) { $('#wk' + w).classList.toggle('open'); }

function toggleTask(id) {
  S.tasks[id] = !S.tasks[id];
  // Update UI immediately (optimistic)
  const row = $('#task-' + id);
  if (row) {
    row.classList.toggle('done', S.tasks[id]);
    row.querySelector('.cb').classList.toggle('done', S.tasks[id]);
  }
  const wk = id.split('-')[0];
  const w = WEEKS.find(x => x.w == wk);
  const st = weekStats(w);
  const bar = $('#wk' + wk + ' .wkbar i');
  if (bar) bar.style.width = st.pct + '%';
  updateHeader(); updateStats();
  if (st.pct === 100) toast('🎉 Week ' + wk + ' complete!');
  // Debounced sync to Firestore
  save();
}

/* ---------- header ---------- */
function updateHeader() {
  const cur = currentWeek(); const w = WEEKS.find(x => x.w === cur);
  $('#curweek').textContent = 'Week ' + cur + ' · Phase ' + w.p;
  $('#curfocus').textContent = w.focus.replace(/[🚀🔑📐]/g, '').trim();
  const st = weekStats(w);
  const ring = $('#ring'), C = 132;
  ring.style.strokeDashoffset = C - (C * st.pct / 100);
  ring.style.stroke = pcolor(w.p);
  $('#ringpct').textContent = st.pct + '%';
  $('#streak').textContent = S.streak;
}

/* ---------- stats ---------- */
function updateStats() {
  let tdone = 0, ttotal = 0;
  WEEKS.forEach(w => { const s = weekStats(w); tdone += s.done; ttotal += s.total; });
  const hours = (S.logs || []).reduce((a, l) => a + (parseFloat(l.hours) || 0), 0);
  const gits  = (S.logs || []).filter(l => l.git).length;
  const lcs   = (S.logs || []).filter(l => l.lc && l.lc.trim()).length;
  if ($('#st-tasks')) {
    $('#st-tasks').textContent = tdone;
    $('#st-hours').textContent = Math.round(hours * 10) / 10;
    $('#st-git').textContent = gits;
    $('#st-lc').textContent = lcs;
    const pct = ttotal ? Math.round(tdone / ttotal * 100) : 0;
    $('#ov-label').textContent = tdone + ' / ' + ttotal + ' tasks';
    $('#ov-pct').textContent = pct + '%';
    $('#ov-bar').style.width = pct + '%';
  }
}

/* ---------- LOG ---------- */
async function saveLog() {
  const topic = $('#logtopic').value.trim();
  if (!topic) { toast('Add a topic first'); return; }
  const entry = {
    date: $('#logdate').value || new Date().toISOString().slice(0, 10),
    topic, what: $('#logwhat').value.trim(),
    hours: $('#loghours').value, lc: $('#loglc').value.trim(),
    git: $('#loggit').classList.contains('done'),
    ts: Date.now()
  };
  S.logs = [entry, ...(S.logs || [])];
  // Streak
  const today = new Date().toISOString().slice(0, 10);
  if (S.lastLog !== today) {
    const yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    S.streak = (S.lastLog === yest) ? (S.streak || 0) + 1 : 1;
    S.lastLog = today;
  }
  await saveNow();
  $('#logtopic').value = ''; $('#logwhat').value = ''; $('#loghours').value = ''; $('#loglc').value = '';
  $('#loggit').classList.remove('done');
  renderLogs(); updateHeader(); updateStats(); toast('✅ Session logged');
}

function renderLogs() {
  if (!(S.logs || []).length) {
    $('#logs').innerHTML = '<div class="empty">No sessions yet. Log your first study block above.</div>';
    return;
  }
  $('#logs').innerHTML = S.logs.slice(0, 40).map(l => `<div class="logentry">
    <div class="ld">${l.date}${l.hours ? ' · <span class="lh">' + l.hours + 'h</span>' : ''}${l.git ? ' · 🟣 pushed' : ''}</div>
    <b>${esc(l.topic)}</b>
    ${l.what ? '<div style="color:var(--dim);margin-top:3px">' + esc(l.what) + '</div>' : ''}
    ${l.lc ? '<div style="color:var(--p2);margin-top:3px">🧩 ' + esc(l.lc) + '</div>' : ''}
  </div>`).join('');
}

/* ---------- APPLICATIONS ---------- */
async function saveApp() {
  const comp = $('#acomp').value.trim();
  if (!comp) { toast('Add a company first'); return; }
  S.apps = [{
    comp, role: $('#arole').value.trim(), loc: $('#aloc').value.trim(),
    src: $('#asrc').value.trim(), status: $('#astatus').value,
    next: $('#anext').value.trim(), date: new Date().toISOString().slice(0, 10), ts: Date.now()
  }, ...(S.apps || [])];
  await saveNow();
  ['acomp', 'arole', 'aloc', 'asrc', 'anext'].forEach(id => $('#' + id).value = '');
  renderApps(); toast('📌 Application added');
}

function renderApps() {
  const apps = S.apps || [];
  $('#apptotal').textContent = apps.length;
  $('#appactive').textContent = apps.filter(a => a.status === 'applied' || a.status === 'interview').length;
  if (!apps.length) {
    $('#apps').innerHTML = '<div class="empty">No applications yet. Start Week 4 (Jun 24)!</div>';
    return;
  }
  const labels = { applied: 'Applied', interview: 'Interviewing', offer: 'Offer 🎉', rejected: 'Rejected', ghosted: 'Ghosted' };
  $('#apps').innerHTML = apps.map((a, i) => `<div class="appentry">
    <div style="display:flex;justify-content:space-between;align-items:start">
      <div><div class="acomp">${esc(a.comp)}</div><div class="arole">${esc(a.role || '')}${a.loc ? ' · ' + esc(a.loc) : ''}</div></div>
      <button onclick="delApp(${i})" style="background:none;border:none;color:var(--faint);font-size:18px;cursor:pointer">×</button>
    </div>
    <span class="statuspill s-${a.status}">${labels[a.status]}</span>
    <div style="font-size:11px;color:var(--faint);margin-top:5px">${a.date}${a.src ? ' · ' + esc(a.src) : ''}${a.next ? ' · ➡ ' + esc(a.next) : ''}</div>
  </div>`).join('');
}

async function delApp(i) {
  S.apps.splice(i, 1);
  await saveNow();
  renderApps();
}

/* ---------- REMINDERS ---------- */
function enableNotifs() {
  if (!('Notification' in window)) { toast('Notifications not supported'); return; }
  Notification.requestPermission().then(p => {
    if (p === 'granted') { toast('🔔 Notifications enabled'); $('#notifbtn').textContent = '✅ Notifications enabled'; }
    else toast('Permission denied — enable in phone settings');
  });
}

async function toggleRem(k) {
  S.rem[k] = !S.rem[k];
  $('#t-' + k).classList.toggle('on', S.rem[k]);
  if (S.rem[k] && Notification.permission !== 'granted') enableNotifs();
  toast(S.rem[k] ? 'Reminder on' : 'Reminder off');
  await saveNow();
  scheduleChecks();
}

async function setRemTime() {
  S.rem.time = $('#remtime').value;
  $('#dt-label').textContent = 'Every day at ' + fmtTime(S.rem.time);
  await saveNow();
  scheduleChecks();
}

function fmtTime(t) {
  const [h, m] = t.split(':'); const hh = +h;
  return ((hh % 12) || 12) + ':' + m + ' ' + (hh < 12 ? 'AM' : 'PM');
}

function syncRemUI() {
  const rem = S.rem || {};
  ['daily', 'git', 'apply'].forEach(k => $('#t-' + k).classList.toggle('on', !!rem[k]));
  $('#remtime').value = rem.time || '18:00';
  $('#dt-label').textContent = 'Every day at ' + fmtTime(rem.time || '18:00');
  if ('Notification' in window && Notification.permission === 'granted')
    $('#notifbtn').textContent = '✅ Notifications enabled';
}

let remTimer = null;
function scheduleChecks() {
  if (remTimer) clearInterval(remTimer);
  remTimer = setInterval(() => {
    if (Notification.permission !== 'granted') return;
    const now = new Date(); const hm = now.toTimeString().slice(0, 5);
    const today = now.toISOString().slice(0, 10);
    const fired = JSON.parse(localStorage.getItem('fired_' + today) || '{}');
    const rem = S.rem || {};
    if (rem.daily && hm === rem.time && !fired.daily) {
      notify('📱 Time to study Android', '2–3 hrs today. DSA + your weekly project. Keep the streak.');
      fired.daily = 1;
    }
    if (rem.git && now.getDay() === 0 && hm === '17:00' && !fired.git) {
      notify('🚀 Ship your weekly project', 'It\'s Sunday — push this week\'s GitHub project before midnight.');
      fired.git = 1;
    }
    if (rem.apply && today >= '2026-06-24' && hm === rem.time && !fired.apply) {
      const cur = currentWeek(); const w = WEEKS.find(x => x.w === cur);
      if (w && w.apply) { notify('💼 Send applications', 'Week ' + cur + ': send your job applications today.'); fired.apply = 1; }
    }
    localStorage.setItem('fired_' + today, JSON.stringify(fired));
  }, 30000);
}

function notify(title, body) {
  try { new Notification(title, { body, icon: 'icon-180.png' }); } catch (e) {}
}

/* ---------- DATA ---------- */
function exportData() {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'android-track-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  toast('⬇️ Backup downloaded');
}

function importData() { $('#importfile').click(); }

async function doImport(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    try {
      const imported = JSON.parse(r.result);
      S = Object.assign(fresh(), imported);
      await saveNow();
      renderAll();
      toast('⬆️ Backup restored & synced');
    } catch (err) { toast('Invalid backup file'); }
  };
  r.readAsText(f);
}

async function resetAll() {
  if (confirm('Reset ALL progress, logs and applications? This cannot be undone.')) {
    S = fresh();
    await saveNow();
    renderAll();
    toast('Reset complete');
  }
}

/* ---------- RESOURCES ---------- */
function renderResources() {
  $('#resources').innerHTML = RESOURCES.map(c => `<div class="card">
    <div class="cat">${c.cat}</div>
    ${c.items.map(r => `<div class="res">
      <div><div class="rname ${r.paid ? 'paid' : ''}">${r.paid ? '💰 ' : ''}${esc(r.n)}</div><div class="rwhen">${r.w}</div></div>
      <a href="${r.u}" target="_blank" rel="noopener">Open</a>
    </div>`).join('')}
  </div>`).join('');
}

/* ---------- TABS ---------- */
$$('.tab').forEach(t => t.onclick = () => {
  $$('.tab').forEach(x => x.classList.remove('on')); t.classList.add('on');
  $$('.view').forEach(v => v.classList.remove('on'));
  $('#v-' + t.dataset.v).classList.add('on');
  window.scrollTo(0, 0);
});

function esc(s) {
  return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------- BOOT ---------- */
function renderAll() {
  renderPhases(); renderWeeks(); updateHeader(); updateStats();
  renderLogs(); renderApps(); renderResources(); syncRemUI();
}

$('#logdate').value = new Date().toISOString().slice(0, 10);

// Render immediately with default state (Firebase will overwrite when connected)
renderAll();
$('#curfocus').textContent = 'Connecting to sync…';

// Service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

scheduleChecks();

'use strict';
// =====================================================================
//  VPS Cockpit : interface
//  Tout le texte venant du serveur est affiché avec textContent (jamais
//  innerHTML), pour qu'un contenu malveillant ne puisse rien exécuter.
// =====================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const NS = 'http://www.w3.org/2000/svg';

// ---------- icônes (constantes, aucune donnée externe) ----------
const ICONS = {
  disk: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><line x1="12" y1="18" x2="16" y2="10"/>',
  up: '<circle cx="12" cy="12" r="9"/><polyline points="8 12 12 8 16 12"/><line x1="12" y1="8" x2="12" y2="16"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  power: '<path d="M12 3v9"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  alert: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="7.5" x2="12" y2="13"/><circle cx="12" cy="16.5" r=".6"/>',
  check: '<circle cx="12" cy="12" r="9"/><polyline points="8 12.5 11 15.5 16 9"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/>',
};
function icon(name, cls) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
  s.innerHTML = ICONS[name] || '';
  return s;
}

// ---------- état ----------
const S = {
  page: 'home', stats: null, svc: { services: [], failed: [], docker: [], ports: [] },
  apps: [], res: [], du: null, duLoading: false, stamp: null,
  running: null, runId: null, runText: '', rebooting: false,
  newType: 'url', editIdx: null, dbs: null, logs: '', logsLoaded: false, refreshing: false, host: '', user: '',
};
let authMode = 'pw';
let profile = null;
let pollTimer = null;

// ---------- utilitaires ----------
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const pct = (a, b) => (b ? (a / b) * 100 : 0);
function fmtBytes(n) {
  if (!n) return '0 Go';
  const g = n / 1024 ** 3;
  if (g >= 100) return `${g.toFixed(0)} Go`;
  if (g >= 1) return `${g.toFixed(1).replace('.', ',')} Go`;
  return `${(n / 1024 ** 2).toFixed(0)} Mo`;
}
function frUptime(u) {
  if (!u) return '—';
  const parts = u.replace(/^up\s+/, '').split(',').map((x) => x.trim()).slice(0, 2);
  return parts.join(', ')
    .replace(/\bweeks?\b/g, (m) => (m === 'week' ? 'semaine' : 'semaines'))
    .replace(/\bdays?\b/g, (m) => (m === 'day' ? 'jour' : 'jours'))
    .replace(/\bhours?\b/g, (m) => (m === 'hour' ? 'heure' : 'heures'))
    .replace(/\bminutes?\b/g, (m) => (m === 'minute' ? 'minute' : 'minutes'));
}

function frDocker(st) {
  return String(st || '')
    .replace(/^Exited \((\d+)\) (.*) ago$/, 'Arrêté (code $1) il y a $2')
    .replace(/^Exited \((\d+)\)/, 'Arrêté (code $1)')
    .replace(/^Up\b/, 'Actif depuis').replace(/^Created/, 'Créé, jamais démarré').replace(/^Restarting/, 'En redémarrage').replace(/^Paused/, 'En pause')
    .replace(/About an? hour/, 'environ 1 heure').replace(/About an? minute/, 'environ 1 minute').replace(/Less than a second/, "moins d'une seconde")
    .replace(/\bseconds?\b/g, (m) => (m === 'second' ? 'seconde' : 'secondes')).replace(/\bminutes?\b/g, (m) => (m === 'minute' ? 'minute' : 'minutes'))
    .replace(/\bhours?\b/g, (m) => (m === 'hour' ? 'heure' : 'heures')).replace(/\bdays?\b/g, (m) => (m === 'day' ? 'jour' : 'jours'))
    .replace(/\bweeks?\b/g, (m) => (m === 'week' ? 'semaine' : 'semaines')).replace(/\bmonths?\b/g, 'mois')
    .replace(/\(unhealthy\)/, '(en difficulté)').replace(/\(healthy\)/, '(en bonne santé)').replace(/\s+/g, ' ').trim();
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop'); // rejoue l'animation d'arrivée
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 4500);
}
function chip(kind, text) { return el('span', 'chip ' + kind, text); }
function bar(p, cls) { const b = el('div', 'bar'); const i = el('i', cls); i.style.width = Math.min(100, Math.max(0, p)) + '%'; b.append(i); return b; }
function section(label, text) { const d = el('div', 'sec'); d.append(el('div', 'label', label), el('p', null, text)); return d; }
function tip(label, text) { const d = el('div', 'tip'); d.append(el('div', 'label', label), el('p', null, text)); return d; }
function clear(node) { node.replaceChildren(); return node; }
const CHIP_TXT = { ok: 'Tout va bien', warn: 'À surveiller', bad: 'À traiter' };

// ---------- fenêtre de confirmation ----------
function ask({ title, text, yes = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    const y = $('mYes'), n = $('mNo');
    $('mTitle').textContent = title; $('mText').textContent = text;
    y.textContent = yes; y.className = 'btn ' + (danger ? 'dng' : 'pri');
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    const done = (v) => { $('overlay').hidden = true; y.onclick = n.onclick = null; document.removeEventListener('keydown', onKey); resolve(v); };
    y.onclick = () => done(true); n.onclick = () => done(false);
    document.addEventListener('keydown', onKey);
    $('overlay').hidden = false; n.focus();
  });
}


// Fenêtre avec un champ texte. Retourne le texte saisi, ou null si annulé. Avec `expect`, il faut retaper exactement ce texte.
function askInput({ title, text, yes = 'Valider', placeholder = '', value = '', danger = false, expect = null }) {
  return new Promise((resolve) => {
    const y = $('mYes'), n = $('mNo'), inp = $('mInput');
    $('mTitle').textContent = title; $('mText').textContent = text;
    y.textContent = yes; y.className = 'btn ' + (danger ? 'dng' : 'pri');
    inp.hidden = false; inp.value = value; inp.placeholder = placeholder;
    const ok = () => (expect === null ? inp.value.trim().length > 0 : inp.value.trim() === expect);
    const sync = () => { y.disabled = !ok(); };
    inp.oninput = sync; sync();
    const onKey = (e) => { if (e.key === 'Escape') done(null); else if (e.key === 'Enter' && ok()) done(inp.value.trim()); };
    const done = (v) => { $('overlay').hidden = true; inp.hidden = true; inp.oninput = null; y.disabled = false; y.onclick = n.onclick = null; document.removeEventListener('keydown', onKey); resolve(v); };
    y.onclick = () => { if (ok()) done(inp.value.trim()); }; n.onclick = () => done(null);
    document.addEventListener('keydown', onKey);
    $('overlay').hidden = false; inp.focus(); inp.select();
  });
}

// =====================================================================
//  Connexion
// =====================================================================
function setMode(m) {
  authMode = m;
  $('modePw').classList.toggle('on', m === 'pw');
  $('modeKey').classList.toggle('on', m === 'key');
  $('pwBox').hidden = m !== 'pw';
  $('keyBox').hidden = m !== 'key';
}
$('modePw').onclick = () => setMode('pw');
$('modeKey').onclick = () => setMode('key');
$('pickKey').onclick = async () => { const p = await api.pickKey(); if (p) $('keyPath').value = p; };

function showMsg(text, kind) { const m = $('loginMsg'); m.textContent = text; m.className = 'msg ' + (kind || 'err'); m.hidden = false; }

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginMsg').hidden = true;
  if (authMode === 'key' && !$('keyPath').value) return showMsg('Choisis le fichier de ta clé privée.');
  const btn = $('goBtn'); btn.disabled = true; btn.textContent = 'Connexion…';
  const host = $('host').value.trim(), username = $('username').value.trim();
  const res = await api.connect({
    host, port: $('port').value, username, authMode,
    password: $('password').value, keyPath: $('keyPath').value, passphrase: $('passphrase').value,
    remember: $('remember').checked,
    reuseSecrets: !!profile && profile.host === host && profile.username === username,
  });
  btn.disabled = false; btn.textContent = 'Se connecter';
  if (!res.ok) return showMsg(res.error);
  $('password').value = ''; $('passphrase').value = '';
  S.host = host; S.user = username;
  $('login').hidden = true; $('dash').hidden = false;
  startSession();
});

$('disconnect').onclick = async () => { await api.disconnect(); endSession(); };
api.onClosed(() => {
  if ($('dash').hidden) return;
  const reboot = S.rebooting; S.rebooting = false;
  endSession();
  if (!reboot) api.notify('Connexion perdue', "VPS-Cockpit ne peut plus surveiller ton serveur : la connexion a été coupée. Reconnecte-toi.");
  if (reboot) showMsg('Le serveur redémarre. Reconnecte-toi dans 1 à 2 minutes.', 'info');
  else showMsg('La connexion avec le serveur a été coupée.');
});

function endSession() {
  clearInterval(pollTimer); pollTimer = null;
  $('dash').hidden = true; $('login').hidden = false;
  S.stats = null; S.res = []; S.du = null; S.logsLoaded = false; S.editIdx = null;
  AL.fails = {}; AL.down = {}; closeUserResult();
}

function startSession() {
  $('srvName').textContent = S.host; $('srvSub').textContent = `Connecté · ${S.user}`;
  setPage('home');
  refreshAll();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => refreshAll(), 30000);
}

// =====================================================================
//  Navigation
// =====================================================================
const PAGES = {
  home: ['Tableau de bord', "L'état de santé de ton serveur, en un coup d'œil."],
  apps: ['Mes apps', 'Vérifie en continu que tes sites et programmes fonctionnent. Contrôle automatique toutes les 30 secondes.'],
  care: ['Entretien', 'Les gestes qui gardent ton serveur à jour, propre et en bonne santé. Rien ne se lance sans ta confirmation.'],
  files: ['Fichiers et bases', 'Crée, modifie ou supprime des dossiers, des fichiers et des bases de données, en toute sécurité.'],
  services: ['Services', 'Les programmes qui tournent en permanence sur ton serveur, et comment les redémarrer.'],
  logs: ['Journal', 'Les erreurs récentes enregistrées par le serveur.'],
  settings: ['Réglages', "Comment l'application se comporte."],
  help: ['Aide', 'Les mots techniques expliqués simplement, et que faire en cas de problème.'],
};
function setPage(name) {
  S.page = name;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.page === name));
  document.querySelectorAll('.page').forEach((p) => (p.hidden = p.id !== 'page-' + name));
  $('pageTitle').textContent = PAGES[name][0]; $('pageSub').textContent = PAGES[name][1];
  document.querySelector('.pages').scrollTop = 0;
  const pg = $('page-' + name); pg.classList.remove('enter'); void pg.offsetWidth; pg.classList.add('enter');
  clearTimeout(setPage._t); setPage._t = setTimeout(() => pg.classList.remove('enter'), 700);
  if (name === 'logs' && !S.logsLoaded) loadLogs();
  if (name === 'files') openFiles();
}
$('nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setPage(b.dataset.page); });
$('refresh').onclick = () => refreshAll();
document.querySelectorAll('#nav button').forEach((b, i) => { b.title = `${b.querySelector('.lbl').textContent} (Ctrl + ${i + 1})`; });
// Raccourcis : F5 / Ctrl+R = actualiser, Ctrl+1…8 = pages du menu.
document.addEventListener('keydown', (e) => {
  if ($('dash').hidden || !$('overlay').hidden) return;
  if (e.key === 'F5' || (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r')) { e.preventDefault(); refreshAll(); return; }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[1-8]$/.test(e.key)) {
    const b = document.querySelectorAll('#nav button')[Number(e.key) - 1];
    if (b) { e.preventDefault(); setPage(b.dataset.page); }
  }
});
// « Mis à jour il y a … » : tenu à jour chaque seconde.
function showStamp() {
  if (!S.stamp) { $('stamp').textContent = ''; return; }
  const sec = Math.max(0, Math.round((Date.now() - S.stamp.getTime()) / 1000));
  $('stamp').textContent = sec < 5 ? "Mis à jour à l'instant" : sec < 60 ? `Mis à jour il y a ${sec} s` : `Mis à jour il y a ${Math.floor(sec / 60)} min`;
  $('stamp').title = 'Dernier contrôle à ' + S.stamp.toLocaleTimeString('fr-FR') + '. Contrôle automatique toutes les 30 secondes.';
}
setInterval(showStamp, 1000);

// =====================================================================
//  Chargement des données
// =====================================================================
async function refreshAll() {
  if (S.refreshing) return;
  S.refreshing = true; $('refresh').disabled = true; $('refresh').classList.add('busy'); $('refreshTxt').textContent = 'Actualisation…';
  try {
    await Promise.all([loadStats(), loadServices(), loadDbs()]);
    await checkApps();
    runAlerts();
    S.stamp = new Date();
  } finally {
    S.refreshing = false; $('refresh').disabled = false; $('refresh').classList.remove('busy'); $('refreshTxt').textContent = 'Actualiser';
    renderAll();
  }
}
async function loadStats() {
  const r = await api.run({ kind: 'stats' });
  if (!r.ok) { $('connDot').className = 'dot r'; toast(r.error); return; }
  $('connDot').className = 'dot g';
  S.stats = r.data;
  if (r.data.host) $('srvName').textContent = r.data.host;
}
async function loadServices() {
  const r = await api.run({ kind: 'services' });
  if (r.ok) S.svc = r.data;
}
async function loadDbs() {
  const r = await api.run({ kind: 'dblist' });
  S.dbs = r.ok ? r.data : null;
  fillDbSuggestions();
}

// =====================================================================
//  Rendu général
// =====================================================================
function renderAll() {
  renderHome(); renderApps(); renderCare(); renderServices(); renderBadges();
  showStamp();
}
function setBadge(id, n) { const b = $(id); b.hidden = !n; b.textContent = n; }
function renderBadges() {
  setBadge('bApps', S.res.filter((r) => r.state === 'red').length);
  setBadge('bCare', careCount());
  setBadge('bSvc', S.svc.failed.length);
}
function careCount() {
  const s = S.stats; if (!s) return 0;
  return (s.updates > 0 ? 1 : 0) + (s.rebootRequired ? 1 : 0) + (pct(s.diskUsed, s.diskTotal) >= 75 ? 1 : 0);
}

// =====================================================================
//  ACCUEIL
// =====================================================================
function buildTasks() {
  const s = S.stats, t = [];
  if (!s) return t;
  const dp = pct(s.diskUsed, s.diskTotal);
  if (dp >= 90) t.push({ lvl: 'bad', title: 'Le disque est presque plein', text: "Quand il est plein, les sites et les bases de données peuvent planter. Un nettoyage libère souvent plusieurs Go.", cta: 'Nettoyer le disque', page: 'care' });
  else if (dp >= 75) t.push({ lvl: 'warn', title: 'Le disque se remplit', text: 'Plus de 75 % utilisés. Un nettoyage maintenant évite les ennuis plus tard.', cta: 'Nettoyer le disque', page: 'care' });
  if (S.svc.failed.length) t.push({ lvl: 'bad', title: `${plural(S.svc.failed.length, 'service est', 'services sont')} en échec`, text: "Un programme a planté. Le redémarrer règle souvent le problème, sans toucher à tes données.", cta: 'Voir les services', page: 'services' });
  const red = S.res.filter((r) => r.state === 'red').length;
  if (red) t.push({ lvl: 'bad', title: `${plural(red, 'app ne répond', 'apps ne répondent')} plus`, text: 'Une ou plusieurs de tes apps surveillées sont hors service.', cta: 'Voir mes apps', page: 'apps' });
  if (s.updates > 0) t.push({ lvl: 'warn', title: `${plural(s.updates, 'mise à jour est disponible', 'mises à jour sont disponibles')}`, text: 'Elles corrigent des failles de sécurité et des bugs. Compte quelques minutes.', cta: 'Mettre à jour', page: 'care' });
  if (s.rebootRequired) t.push({ lvl: 'warn', title: 'Un redémarrage est nécessaire', text: 'Pour terminer des mises à jour déjà installées. Tes sites seront coupés environ 1 minute.', cta: 'Voir comment', page: 'care' });
  if (pct(s.memTotal - s.memAvail, s.memTotal) >= 92) t.push({ lvl: 'warn', title: 'La mémoire est presque saturée', text: 'Le serveur peut ralentir. Redémarrer un service ou le serveur peut aider.', cta: 'Voir les services', page: 'services' });
  if (s.cores && parseFloat((s.load || '0').split(' ')[0]) / s.cores >= 1) t.push({ lvl: 'warn', title: 'Le processeur est très sollicité', text: "Le serveur est surchargé en ce moment. Si ça dure, regarde quel programme consomme.", cta: 'Voir les services', page: 'services' });
  return t.sort((a, b) => (a.lvl === 'bad' ? 0 : 1) - (b.lvl === 'bad' ? 0 : 1));
}

function renderHome() {
  const hero = clear($('hero'));
  const s = S.stats;
  if (!s) {
    const c = el('section', 'card col'); c.append(el('p', 'soft', 'Chargement des informations de ton serveur…'), el('div', 'skel w60'), el('div', 'skel w40')); hero.append(c);
    const mk = clear($('metrics'));
    for (let i = 0; i < 3; i++) { const k = el('article', 'card col'); k.append(el('div', 'skel w40'), el('div', 'skel ring'), el('div', 'skel'), el('div', 'skel w60')); mk.append(k); }
    return;
  }
  const tasks = buildTasks();
  const bad = tasks.filter((t) => t.lvl === 'bad').length;
  const lvl = bad ? 'bad' : tasks.length ? 'warn' : 'ok';
  const card = el('section', `card hero ${lvl} ${lvl === 'ok' ? 'okc' : lvl === 'warn' ? 'warnc' : 'badc'}`);
  const big = el('div', 'big'); big.append(icon(lvl === 'ok' ? 'check' : 'alert')); card.append(big);
  const body = el('div', 'col grow');
  const head = el('div');
  head.append(el('h2', null, lvl === 'ok' ? 'Tout va bien' : bad ? plural(tasks.length, 'point demande', 'points demandent') + ' ton attention' : plural(tasks.length, 'point demande', 'points demandent') + ' ton attention'));
  head.append(el('p', 'soft', lvl === 'ok'
    ? 'Ton serveur est en bonne santé et tes apps répondent. Il n\'y a rien à faire pour le moment.'
    : bad ? 'Un ou plusieurs points sont à traiter en priorité. Voici ce que je te conseille, du plus important au moins important.'
          : 'Ton serveur fonctionne normalement. Voici ce que je te conseille de faire, du plus important au moins important.'));
  body.append(head);
  const tgrid = el('div', 'tasks' + (tasks.length > 1 ? ' two' : ''));
  tasks.forEach((t) => {
    const row = el('div', 'tip task');
    const txt = el('div', 'grow'); const tl = el('div', 'ttl'); tl.append(chip(t.lvl === 'bad' ? 'bad' : 'warn', t.lvl === 'bad' ? 'Urgent' : 'À faire'), el('b', null, t.title));
    txt.append(tl, el('div', 'muted small', t.text));
    const b = el('button', 'btn sm' + (t.lvl === 'bad' ? ' pri' : ''), t.cta); b.onclick = () => setPage(t.page);
    row.append(txt, b); tgrid.append(row);
  });
  if (tasks.length) body.append(tgrid);
  card.append(body); hero.append(card);

  // cartes de mesure
  const m = clear($('metrics'));
  const dp = pct(s.diskUsed, s.diskTotal), used = s.memTotal - s.memAvail, mp = pct(used, s.memTotal);
  const l = (s.load || '0 0 0').split(' ');
  const cp = s.cores ? (parseFloat(l[0]) / s.cores) * 100 : 0;
  const dS = dp >= 90 ? 'bad' : dp >= 75 ? 'warn' : 'ok', mS = mp >= 92 ? 'bad' : mp >= 80 ? 'warn' : 'ok', cS = cp >= 100 ? 'bad' : cp >= 70 ? 'warn' : 'ok';
  m.append(
    metricCard({ icon: 'disk', title: 'Espace disque', p: dp, st: dS,
      detail: `${fmtBytes(s.diskUsed)} utilisés sur ${fmtBytes(s.diskTotal)} · ${fmtBytes(s.diskTotal - s.diskUsed)} libres`,
      what: "Le stockage de ton serveur, comme le disque dur d'un PC. Il contient le système, tes sites, tes bases de données et les journaux.",
      advice: { ok: 'Il te reste beaucoup de place, rien à faire. Au-delà de 90 %, les sites risquent de planter.', warn: "Pense à lancer un nettoyage (page Entretien) avant que la place ne manque.", bad: 'Urgent : un disque plein fait planter les sites et les bases de données. Lance « Nettoyer le disque » maintenant.' }[dS] }),
    metricCard({ icon: 'chip', title: 'Mémoire', p: mp, st: mS,
      detail: `${fmtBytes(used)} utilisés sur ${fmtBytes(s.memTotal)} · ${fmtBytes(s.memAvail)} disponibles` + (s.swapTotal ? ` · échange ${fmtBytes(s.swapUsed)}` : ''),
      what: "L'espace de travail des programmes en cours (la RAM). Ce n'est pas du stockage : elle se vide à chaque redémarrage.",
      advice: { ok: 'Le serveur a de la marge.', warn: 'La mémoire est bien utilisée. Si ça dure ou si ça monte, un redémarrage peut aider.', bad: 'Mémoire presque saturée : le serveur peut ralentir ou arrêter des programmes. Redémarrer un service ou le serveur peut aider.' }[mS] }),
    metricCard({ icon: 'gauge', title: 'Processeur', p: cp, st: cS,
      detail: `Charge moyenne : ${l.join(' · ').replace(/\./g, ',')} (1, 5, 15 min) · ${plural(s.cores || 1, 'cœur', 'cœurs')}`,
      what: "L'effort demandé au « cerveau » du serveur. 100 % veut dire que tous les cœurs sont occupés en permanence.",
      advice: { ok: "Le serveur n'est pas sous pression. Des pics passagers sont normaux (sauvegardes, mises à jour).", warn: 'Le serveur travaille beaucoup. Normal par moments, à surveiller si ça dure.', bad: 'Le serveur est surchargé. Si ça dure, regarde quel programme consomme (page Services).' }[cS] }),
  );

  // Mon serveur
  const sc = clear($('srvCard'));
  sc.append(el('div', 'label', 'Mon serveur'), el('h3', null, s.host || S.host));
  sc.firstChild.nextSibling.style.fontSize = '20px';
  [['Système', s.os || '—'], ['Allumé depuis', frUptime(s.uptime)], ['Adresse', `${S.user}@${S.host}`], ['Processeur', plural(s.cores || 1, 'cœur', 'cœurs')], ['Mémoire / Disque', `${fmtBytes(s.memTotal)} / ${fmtBytes(s.diskTotal)}`]]
    .forEach(([k, v]) => { const r = el('div', 'kv'); r.append(el('span', 'muted', k), el('span', null, v)); sc.append(r); });
  sc.style.gap = '6px';

  // Mes apps (résumé)
  const ac = clear($('appsCard'));
  const redN = S.res.filter((r) => r.state === 'red').length;
  const top = el('div', 'row'); top.append(el('div', 'label grow', 'Mes apps'));
  if (S.apps.length) top.append(redN ? chip('bad', plural(redN, 'ne répond pas', 'ne répondent pas')) : chip('ok', 'Tout répond'));
  ac.append(top);
  if (!S.apps.length) ac.append(el('p', 'soft', 'Tu ne suis encore aucune app. Ajoute ton site ou tes services pour être prévenu dès que quelque chose ne répond plus.'));
  S.apps.slice(0, 5).forEach((a, i) => {
    const r = S.res[i] || { state: 'n', detail: '…' };
    const row = el('div', 'row'); row.append(el('span', 'pdot ' + stateCls(r.state)));
    const t = el('div', 'grow'); const nm = el('div', null, a.name); nm.style.fontWeight = '600';
    const dt = el('div', 'muted small', r.detail); if (r.state === 'red') dt.style.color = '#ff9a93';
    t.append(nm, dt); row.append(t); ac.append(row);
  });
  if (S.apps.length > 5) ac.append(el('p', 'muted small', `… et ${S.apps.length - 5} autre(s)`));
  const gb = el('button', 'btn', S.apps.length ? 'Gérer mes apps' : 'Ajouter une app'); gb.onclick = () => setPage('apps'); gb.style.marginTop = 'auto'; ac.append(gb);

  // Ce qui prend de la place
  const dc = clear($('duCard'));
  dc.append(el('div', 'label', 'Ce qui prend de la place'));
  if (S.duLoading) dc.append(el('p', 'soft', 'Analyse en cours… cela peut durer jusqu\'à une minute.'));
  else if (!S.du) {
    dc.append(el('p', 'soft', 'Pour savoir ce qui remplit ton disque (journaux, Docker, sites web…). L\'analyse peut durer jusqu\'à une minute.'));
    const b = el('button', 'btn pri', 'Analyser le disque'); b.onclick = runDu; b.style.marginTop = 'auto'; dc.append(b);
  } else {
    const max = S.du[0] ? S.du[0].bytes : 1;
    S.du.slice(0, 5).forEach((d) => {
      const info = DU[d.path] || { name: d.path, clean: false };
      const w = el('div'); const r = el('div', 'row between'); r.append(el('span', null, info.name), el('span', 'muted', fmtBytes(d.bytes))); w.append(r);
      const bb = bar(pct(d.bytes, max), 'g-amber'); bb.style.marginTop = '6px'; w.append(bb); dc.append(w);
    });
    dc.append(el('p', 'muted small', 'Les journaux, caches et fichiers temporaires se nettoient sans risque. Le reste, ce sont tes données : à garder.'));
    const b1 = el('button', 'btn', 'Aller à l\'entretien'); b1.onclick = () => setPage('care'); b1.style.marginTop = 'auto';
    const b2 = el('button', 'linkbtn', 'Relancer l\'analyse'); b2.onclick = runDu;
    dc.append(b1, b2);
  }
}
const DU = {
  '/var/log': { name: 'Journaux (logs)' }, '/var/lib/docker': { name: 'Docker (applications et images)' }, '/var/cache': { name: 'Caches' },
  '/var/www': { name: 'Sites web' }, '/home': { name: 'Dossiers des utilisateurs' }, '/root': { name: 'Dossier administrateur' },
  '/opt': { name: 'Logiciels installés à part' }, '/srv': { name: 'Données de services' }, '/tmp': { name: 'Fichiers temporaires' },
  '/var/lib/mysql': { name: 'Base de données MySQL' }, '/var/lib/postgresql': { name: 'Base de données PostgreSQL' },
  '/var/backups': { name: 'Sauvegardes système' }, '/snap': { name: 'Applications Snap' },
};
async function runDu() {
  S.duLoading = true; renderHome();
  const r = await api.run({ kind: 'diskusage' });
  S.duLoading = false;
  if (r.ok) S.du = r.data; else toast(r.error);
  renderHome();
}

const RING_C = 2 * Math.PI * 52;
const lastP = {}; // dernière valeur affichée de chaque jauge : l'animation repart de là, pas de zéro
function metricCard(m) {
  const c = el('article', 'card col metric');
  const head = el('div', 'row'); const ic = el('div', 'ico'); ic.append(icon(m.icon));
  head.append(ic, el('h3', null, m.title), chip(m.st, CHIP_TXT[m.st]));
  const to = Math.min(100, Math.max(0, m.p)), from = lastP[m.title] === undefined ? 0 : lastP[m.title];
  lastP[m.title] = to;
  const ring = el('div', 'ring');
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 120 120'); svg.setAttribute('aria-hidden', 'true');
  const mkc = (cls) => { const k = document.createElementNS(NS, 'circle'); k.setAttribute('cx', '60'); k.setAttribute('cy', '60'); k.setAttribute('r', '52'); k.setAttribute('class', cls); return k; };
  const arc = mkc('arc g-' + m.st);
  arc.style.strokeDasharray = String(RING_C);
  arc.style.strokeDashoffset = String(RING_C * (1 - from / 100));
  svg.append(mkc('track'), arc);
  const num = el('div', 'num', Math.round(from) + ' %');
  ring.append(svg, num);
  const side = el('div', 'col grow'); side.append(el('p', 'soft', m.detail));
  const what = el('details', 'what'); what.append(el('summary', null, "C'est quoi ?"), el('p', 'soft', m.what));
  const top = el('div', 'row gauge'); top.append(ring, side);
  c.append(head, top, tip('Mon avis', m.advice), what);
  if (from !== to) {
    requestAnimationFrame(() => requestAnimationFrame(() => { arc.style.strokeDashoffset = String(RING_C * (1 - to / 100)); }));
    const t0 = performance.now(), dur = 700;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3;
      num.textContent = Math.round(from + (to - from) * e) + ' %';
      if (k < 1 && num.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  return c;
}

// =====================================================================
//  MES APPS
// =====================================================================
const TYPES = {
  url: { name: 'Un site web', desc: "Vérifie qu'une adresse (https://…) répond bien.", label: "Adresse du site", ph: 'https://monsite.fr', hint: 'Contrôlé depuis ton PC, comme le ferait un visiteur.', tag: 'Site web' },
  service: { name: 'Un programme du serveur', desc: "Vérifie qu'un programme est actif, par exemple nginx.", label: 'Nom du programme', ph: 'nginx', hint: "Le nom du service sur le serveur. Les programmes détectés sont proposés plus bas.", tag: 'Programme' },
  docker: { name: 'Un conteneur Docker', desc: "Vérifie qu'une application Docker est démarrée.", label: 'Nom du conteneur', ph: 'mon-app', hint: "Le nom du conteneur (visible dans la page Services).", tag: 'Docker' },
  port: { name: 'Un port réseau', desc: 'Vérifie qu\'une « porte » est ouverte, par exemple 5432.', label: 'Numéro du port', ph: '5432', hint: 'Par exemple 5432 pour PostgreSQL, 3306 pour MySQL, 6379 pour Redis.', tag: 'Port' },
};
function buildTypeCards() {
  const box = clear($('typeCards'));
  Object.entries(TYPES).forEach(([k, t]) => {
    const b = el('button', 'type' + (S.newType === k ? ' sel' : '')); b.type = 'button';
    b.append(el('b', null, t.name), el('span', null, t.desc));
    b.onclick = () => { S.newType = k; $('appDb').value = ''; syncDbFields(); buildTypeCards(); };
    box.append(b);
  });
  const t = TYPES[S.newType];
  $('targetLabel').textContent = t.label; $('appTarget').placeholder = t.ph; $('appHint').textContent = t.hint;
  renderDetected();
}
const stateCls = (s) => ({ green: 'g', orange: 'o', red: 'r' }[s] || 'n');


// ----- Lecture de la route de santé (liaison site ↔ base) -----
const OK_WORDS = ['ok', 'up', 'connected', 'healthy', 'connecte', 'connectee', 'disponible', 'true'];
const BAD_WORDS = ['indisponible', 'down', 'error', 'erreur', 'ko', 'unavailable', 'disconnected', 'false', 'fail', 'failed'];
function verdictOf(v) {
  if (v === true) return 'ok'; if (v === false) return 'bad';
  if (v && typeof v === 'object') return verdictOf(v.status ?? v.statut ?? v.state);
  const s = String(v == null ? '' : v).toLowerCase().trim();
  if (OK_WORDS.includes(s)) return 'ok'; if (BAD_WORDS.includes(s)) return 'bad';
  return null;
}
function findDbKey(j) {
  if (!j || typeof j !== 'object') return null;
  const KEYS = ['base', 'db', 'database', 'postgres', 'postgresql', 'mysql'];
  for (const k of Object.keys(j)) if (KEYS.includes(k.toLowerCase())) { const v = verdictOf(j[k]); if (v) return v; }
  for (const k of ['info', 'error', 'details', 'checks']) if (j[k] && typeof j[k] === 'object') { const v = findDbKey(j[k]); if (v) return v; }
  return null;
}
// Retourne { known, ok, text }
function healthLink(a, r) {
  let j = null;
  try { j = JSON.parse(r.body || ''); } catch { /* pas du JSON */ }
  const v = findDbKey(j);
  if (v === 'ok') return { known: true, ok: true, text: "l'app arrive à lire sa base" };
  if (v === 'bad') return { known: true, ok: false, text: "le site répond, mais n'arrive pas à lire sa base" };
  let path = ''; try { path = new URL(/^https?:\/\//i.test(a.target) ? a.target : 'https://' + a.target).pathname; } catch { /* adresse invalide */ }
  if (/health|sant|status|ping/i.test(path)) {
    if (r.status >= 200 && r.status < 300) return { known: true, ok: true, text: `la route de santé répond (${r.status})` };
  }
  return { known: false, text: 'non vérifiable : cette adresse ne dit rien sur la base' };
}

// ----- Lecture de la base côté serveur -----
const ENGINES = { postgres: 'PostgreSQL', mysql: 'MySQL / MariaDB' };
function dbLine(a) {
  const name = ENGINES[a.db];
  const line = (state, text) => ({ state, label: `Base « ${a.dbName} »`, text });
  if (!S.dbs) return line('n', 'non vérifiable pour le moment');
  const e = S.dbs[a.db];
  if (e.state === 'none') return line('r', `${name} est introuvable sur ce serveur`);
  if (e.state === 'down') return line('r', `${name} ne répond pas`);
  if (!e.dbs.includes(a.dbName)) return line('r', `cette base n'existe pas sur le serveur`);
  return line('g', `${name} répond`);
}
// Assemble les lignes Site / Base / Liaison et prend la pire couleur.
function withDb(a, r) {
  const main = { state: stateCls(r.state), label: a.type === 'url' ? 'Site' : a.type === 'docker' ? 'Conteneur' : a.type === 'port' ? 'Port' : 'Programme', text: r.detail, rd: r.state === 'red' };
  const base = dbLine(a);
  const lines = [main, base];
  let link = null;
  if (a.type === 'url') {
    const l = r.link || { known: false, text: 'non vérifiable' };
    link = { state: l.known ? (l.ok ? 'g' : 'r') : 'n', label: 'Liaison', text: l.text };
    if (r.state === 'red' && !l.known) link = { state: 'n', label: 'Liaison', text: 'non vérifiable : le site ne répond pas' };
    lines.push(link);
  }
  const rank = { g: 0, n: 1, o: 1, r: 2 };
  const worst = lines.reduce((w, l) => (rank[l.state] > rank[w] ? l.state : w), 'g');
  const mainRed = r.state === 'red';
  let word, state;
  if (mainRed) { word = r.word; state = 'red'; }
  else if (base.state === 'r') { word = 'Base en panne'; state = 'red'; }
  else if (link && link.state === 'r') { word = 'Liaison coupée'; state = 'red'; }
  else if (worst === 'g') { word = r.word; state = 'green'; }
  else { word = r.state === 'orange' ? r.word : 'À vérifier'; state = 'orange'; }
  if (state === 'green') word = a.type === 'url' ? 'Tout va bien' : r.word;
  // Résumé d'une phrase pour le tableau de bord : la 1re ligne qui pose problème, sinon un « tout va bien ».
  const bad = lines.find((l) => l.state === 'r') || lines.find((l) => l.state === 'n');
  const detail = bad ? `${bad.label} : ${bad.text}` : a.db ? 'Le site, la base et leur liaison fonctionnent.' : r.detail;
  return { state, word, lines, detail };
}

async function checkOne(a) {
  const r = await checkMain(a);
  return a.db && a.dbName ? withDb(a, r) : r;
}
async function checkMain(a) {
  if (a.type === 'url') {
    const r = await api.checkUrl(a.target);
    const link = a.db && a.dbName ? healthLink(a, r) : null;
    // Un site qui répond en 503 mais dit lui-même « base indisponible » est bien en ligne : c'est la liaison qui est coupée.
    const answered = r.ok || (r.status >= 500 && link && link.known);
    if (answered) {
      const slow = r.ms > 3000;
      // 4xx : le site répond mais l'adresse pose problème
      if (r.status >= 400 && r.status < 500) return { state: 'orange', word: 'À vérifier', detail: `Le site répond, mais l'adresse donne une erreur (${r.status}).`, link };
      return slow
        ? { state: 'orange', word: 'Lent', detail: `Répond en ${(r.ms / 1000).toFixed(1).replace('.', ',')} s : plus long que d'habitude.`, link }
        : { state: 'green', word: 'En ligne', detail: r.status >= 500 ? `Répond en ${r.ms} ms · il signale lui-même un problème (${r.status}).` : `Répond en ${r.ms} ms · réponse normale (${r.status})`, link };
    }
    return { state: 'red', word: 'Hors service', detail: r.status ? `Le site répond avec une erreur (${r.status}).` : `Le site ne répond pas (${r.error || 'injoignable'}).`, link };
  }
  if (a.type === 'service') {
    const n = a.target.replace(/\.service$/, '');
    if (S.svc.services.includes(n)) return { state: 'green', word: 'Actif', detail: 'Le programme tourne normalement.' };
    if (S.svc.failed.includes(n)) return { state: 'red', word: 'En échec', detail: 'Le programme a planté.' };
    return { state: 'red', word: 'Hors service', detail: 'Le programme est arrêté ou introuvable.' };
  }
  if (a.type === 'docker') {
    const c = S.svc.docker.find((d) => d.name === a.target);
    if (!c) return { state: 'red', word: 'Introuvable', detail: 'Conteneur introuvable : vérifie son nom.' };
    if (/^Up/i.test(c.status)) return /unhealthy/i.test(c.status)
      ? { state: 'orange', word: 'À vérifier', detail: 'Le conteneur tourne mais signale un problème.' }
      : { state: 'green', word: 'Démarré', detail: `Le conteneur est démarré (${frDocker(c.status)}).` };
    return { state: 'red', word: 'Hors service', detail: `Le conteneur est arrêté (${frDocker(c.status)}).` };
  }
  if (a.type === 'port') {
    return S.svc.ports.includes(Number(a.target))
      ? { state: 'green', word: 'Ouvert', detail: `Le port ${a.target} accepte les connexions.` }
      : { state: 'red', word: 'Fermé', detail: `Le port ${a.target} ne répond pas.` };
  }
  return { state: 'n', word: '?', detail: '' };
}
async function checkApps() {
  S.res = await Promise.all(S.apps.map(checkOne));
}

function renderApps() {
  const box = clear($('pastilles'));
  $('appsEmpty').hidden = S.apps.length > 0;
  S.apps.forEach((a, i) => {
    const r = S.res[i] || { state: 'n', word: '…', detail: 'Vérification…' };
    const c = el('article', 'card pas' + (r.state === 'red' ? ' bad' : r.state === 'orange' ? ' warn' : ''));
    const top = el('div', 'row'); top.append(el('span', 'pdot ' + stateCls(r.state)), el('h3', null, a.name),
      chip(r.state === 'green' ? 'ok' : r.state === 'orange' ? 'warn' : r.state === 'red' ? 'bad' : 'info', r.word));
    let det;
    if (r.lines) {
      det = el('div', 'lines');
      r.lines.forEach((l) => {
        const row = el('div', 'chk'); const t = el('div');
        const bad = l.state === 'r';
        const b = el('b', bad ? 'rd' : null, l.label); const s = el('span', bad ? 'rd' : 'muted', ' · ' + l.text);
        t.append(b, s); row.append(el('span', 'dot ' + l.state), t); det.append(row);
      });
    } else { det = el('p', r.state === 'red' ? '' : 'muted', r.detail); if (r.state === 'red') det.style.color = '#ff9a93'; }
    const tags = el('div', 'row wrap'); tags.append(el('span', 'code', TYPES[a.type].tag), el('span', 'code', a.target)); if (a.db) tags.append(el('span', 'code', `${ENGINES[a.db]} · ${a.dbName}`));
    const foot = el('div', 'row between');
    if (r.state === 'red' && (a.type === 'service' || a.type === 'docker')) {
      const b = el('button', 'btn pri sm', a.type === 'docker' && /^Exited|Created/i.test((S.svc.docker.find((d) => d.name === a.target) || {}).status || '') ? 'Démarrer' : 'Redémarrer');
      b.onclick = () => svcAction(a.type, b.textContent === 'Démarrer' ? 'start' : 'restart', a.target, a.name);
      foot.append(b);
    } else foot.append(el('span', 'muted small', S.stamp ? 'Contrôlé à ' + S.stamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''));
    const rm = el('button', 'linkbtn', 'Ne plus suivre');
    rm.onclick = async () => {
      if (!(await ask({ title: `Ne plus suivre « ${a.name} » ?`, text: "Elle ne sera plus surveillée. Ton app, elle, n'est pas touchée.", yes: 'Ne plus suivre' }))) return;
      if (S.editIdx === i) cancelEdit(); else if (S.editIdx !== null && S.editIdx > i) S.editIdx--;
      S.apps.splice(i, 1); S.apps = await api.saveApps(S.apps); await checkApps(); renderAll(); renderDetected();
    };
    const ed = el('button', 'linkbtn', 'Modifier'); ed.onclick = () => startEdit(i);
    const acts = el('div', 'row'); acts.append(ed, rm); foot.append(acts);
    if (S.editIdx === i) c.classList.add('editing');
    c.append(top, det, tags, foot); box.append(c);
  });
  renderDetected();
}

function renderDetected() {
  const box = clear($('detected'));
  const tracked = (type, target) => S.apps.some((a) => a.type === type && a.target === target);
  const sugg = [];
  S.svc.services.forEach((n) => { const k = describeService(n); if (k.known && !k.tech && !tracked('service', n)) sugg.push({ name: k.title, type: 'service', target: n, label: k.title }); });
  S.svc.docker.forEach((d) => { if (!tracked('docker', d.name)) sugg.push({ name: d.name, type: 'docker', target: d.name, label: `Conteneur « ${d.name} »` }); });
  $('detectedCard').hidden = !sugg.length;
  if (!sugg.length) return;
  sugg.slice(0, 8).forEach((s) => {
    const b = el('button', 'btn sm', '+ ' + s.label); b.type = 'button';
    b.onclick = async () => { S.apps.push({ name: s.name, type: s.type, target: s.target }); S.apps = await api.saveApps(S.apps); await checkApps(); renderAll(); };
    box.append(b);
  });
}

$('appForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('appErr'); err.hidden = true;
  const name = $('appName').value.trim(); const target = $('appTarget').value.trim();
  const bad = (m) => { err.textContent = m; err.hidden = false; };
  if (S.newType === 'port' && !(/^\d{1,5}$/.test(target) && Number(target) > 0 && Number(target) < 65536)) return bad('Le port doit être un nombre entre 1 et 65535.');
  if ((S.newType === 'service' || S.newType === 'docker') && !/^[A-Za-z0-9@._:-]{1,100}$/.test(target)) return bad("Ce nom n'est pas valide : lettres, chiffres et . _ - seulement, sans espace.");
  if (S.newType === 'url') { try { new URL(/^https?:\/\//i.test(target) ? target : 'https://' + target); } catch { return bad("Cette adresse n'est pas valide. Exemple : https://monsite.fr"); } }
  const db = $('appDb').value; const dbName = $('appDbName').value.trim();
  if (db && !/^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$/.test(dbName)) return bad("Indique le nom de la base (lettres, chiffres, _ et - seulement). Il est proposé dans la liste si je l'ai détecté.");
  const item = { name, type: S.newType, target, db: db || '', dbName: db ? dbName : '' };
  const editing = S.editIdx !== null && S.apps[S.editIdx];
  if (editing) S.apps[S.editIdx] = item; else S.apps.push(item);
  S.apps = await api.saveApps(S.apps);
  cancelEdit();
  toast(editing ? `« ${name} » a été modifiée.` : `« ${name} » est maintenant surveillée.`);
  await checkApps(); renderAll();
});

// ----- modifier une app déjà suivie -----
function startEdit(i) {
  const a = S.apps[i]; if (!a) return;
  S.editIdx = i; S.newType = a.type; buildTypeCards();
  $('appName').value = a.name; $('appTarget').value = a.target;
  $('appDb').value = a.db || ''; $('appDbName').value = a.dbName || ''; syncDbFields();
  $('formTitle').textContent = `Modifier « ${a.name} »`;
  $('formSub').textContent = 'Change ce que tu veux : le type, le nom ou la cible. Rien n\'est à recréer.';
  $('appSubmit').textContent = 'Enregistrer'; $('appCancel').hidden = false; $('appErr').hidden = true;
  renderApps();
  document.querySelector('.pages').scrollTop = 0; $('appName').focus();
}
function cancelEdit() {
  S.editIdx = null; $('appName').value = ''; $('appTarget').value = ''; $('appDb').value = ''; $('appDbName').value = ''; syncDbFields(); $('appErr').hidden = true;
  $('formTitle').textContent = 'Ajouter une app à surveiller';
  $('formSub').textContent = 'Étape 1 : choisis ce que tu veux surveiller. Étape 2 : donne-lui un nom et indique où la trouver. Étape 3 (facultative) : indique la base de données qu\'elle utilise.';
  $('appSubmit').textContent = 'Ajouter'; $('appCancel').hidden = true;
  renderApps();
}
$('appCancel').onclick = cancelEdit;

// ----- champs « Base de données » du formulaire -----
function fillDbSuggestions() {
  const eng = $('appDb').value; const dl = clear($('dbNames'));
  const names = eng && S.dbs ? S.dbs[eng].dbs : [];
  names.forEach((n) => { const o = el('option'); o.value = n; dl.append(o); });
  const hint = $('dbHint');
  hint.hidden = !eng;
  if (!eng) return;
  if (!S.dbs) hint.textContent = "Je n'ai pas pu lire la liste des bases du serveur : tape le nom à la main.";
  else if (S.dbs[eng].state === 'none') hint.textContent = `${ENGINES[eng]} ne semble pas installé sur ce serveur.`;
  else if (S.dbs[eng].state === 'down') hint.textContent = `${ENGINES[eng]} ne répond pas pour le moment : tape le nom à la main.`;
  else hint.textContent = (names.length ? `Détectées sur ton serveur : ${names.join(' · ')}. ` : 'Aucune base détectée. ') + "Cockpit vérifie tout seul que la base répond et que ton app arrive à la lire : tu n'as rien d'autre à régler.";
}
function syncDbFields() {
  const eng = $('appDb').value;
  $('dbNameBox').hidden = !eng;
  if (!eng) $('appDbName').value = '';
  fillDbSuggestions();
}
$('appDb').addEventListener('change', syncDbFields);


// =====================================================================
//  ENTRETIEN
// =====================================================================
const ACTS = [
  { id: 'update', icon: 'up', title: 'Mettre à jour le système',
    what: 'Installe les dernières versions des logiciels du serveur, dont les correctifs de sécurité.',
    when: "Une fois par semaine, ou dès que l'accueil t'en signale.", safe: ['Ce que ça ne touche pas', 'Tes sites, tes bases de données et tes fichiers restent intacts.'],
    time: '1 à 10 minutes', risk: ['ok', 'Sans risque'], cta: 'Lancer la mise à jour', btn: 'pri',
    confirm: { title: 'Mettre à jour le système ?', text: 'Les logiciels du serveur vont être mis à jour. Cela prend entre 1 et 10 minutes. Tes sites restent en ligne pendant ce temps.', yes: 'Lancer la mise à jour' },
    status: (s) => s.updates > 0 ? ['warn', plural(s.updates, 'mise à jour disponible', 'mises à jour disponibles')] : s.updates === 0 ? ['ok', 'Le système est à jour'] : ['info', 'Statut inconnu'] },
  { id: 'clean', icon: 'trash', title: 'Nettoyer le disque',
    what: 'Supprime ce qui ne sert plus : paquets orphelins, caches, journaux de plus de 7 jours, images Docker inutilisées.',
    when: 'Une fois par mois, ou quand le disque dépasse 75 %.', safe: ['Ce que ça ne touche pas', 'Tes fichiers, sites, bases de données et conteneurs en marche.'],
    time: "Moins d'une minute", risk: ['ok', 'Sans risque'], cta: 'Nettoyer maintenant', btn: '',
    confirm: { title: 'Nettoyer le disque ?', text: "Je supprime les paquets inutiles, les journaux de plus de 7 jours et les images Docker orphelines.\nTes fichiers, sites, bases de données et conteneurs ne sont pas touchés.", yes: 'Nettoyer' },
    status: (s) => { const p = Math.round(pct(s.diskUsed, s.diskTotal)); return p >= 90 ? ['bad', `Disque à ${p} % : urgent`] : p >= 75 ? ['warn', `Disque à ${p} % : conseillé`] : ['ok', `Disque à ${p} % : pas urgent`]; } },
  { id: 'reboot', icon: 'power', title: 'Redémarrer le serveur',
    what: "Éteint puis rallume le serveur. Obligatoire après certaines mises à jour pour qu'elles prennent effet.",
    when: "Quand l'accueil te le demande, de préférence à un moment calme.", safe: ["Ce qu'il faut savoir", "Aucune donnée n'est perdue, mais tes sites sont coupés environ 1 minute et l'application se déconnecte."],
    time: 'Environ 1 minute', risk: ['warn', 'Coupure brève'], cta: 'Redémarrer le serveur', btn: 'dng',
    confirm: { title: 'Redémarrer le serveur ?', text: "Le serveur va s'éteindre puis se rallumer. Tes sites et tes apps seront coupés environ 1 minute, et l'application va se déconnecter.\nAucune donnée n'est perdue.", yes: 'Redémarrer', danger: true },
    status: (s) => s.rebootRequired ? ['warn', 'Redémarrage nécessaire'] : ['ok', "Pas nécessaire pour l'instant"] },
];

function renderCare() {
  const box = clear($('actCards')); const s = S.stats;
  ACTS.forEach((a) => {
    const needs = s && ((a.id === 'reboot' && s.rebootRequired));
    const c = el('article', 'card col act' + (needs ? ' warnc' : ''));
    const head = el('div', 'row'); const ic = el('div', 'ico'); ic.append(icon(a.icon)); head.append(ic, el('h3', null, a.title)); c.append(head);
    if (s) { const [k, t] = a.status(s); const st = chip(k, t); st.style.alignSelf = 'flex-start'; c.append(st); }
    c.append(section('Ce que ça fait', a.what), section('Quand le faire', a.when), section(a.safe[0], a.safe[1]));
    const meta = el('div', 'meta');
    const t1 = el('span', 'mchip'); t1.append(icon('clock'), document.createTextNode(a.time));
    const t2 = el('span', 'mchip ' + a.risk[0]); t2.append(icon('shield'), document.createTextNode(a.risk[1]));
    meta.append(t1, t2); c.append(meta);
    const b = el('button', 'btn ' + a.btn, a.cta); b.dataset.act = a.id; b.disabled = !!S.running;
    b.onclick = () => runAction(a); c.append(b); box.append(c);
  });
}

async function runAction(a) {
  if (S.running) return;
  if (!(await ask(a.confirm))) return;
  S.running = a.id; S.runId = String(Date.now()); S.runText = '';
  const out = $('runOut'), rc = $('runChip'); out.textContent = ''; rc.hidden = false; rc.className = 'chip info'; rc.textContent = 'En cours…'; $('copyRun').hidden = true;
  document.querySelectorAll('[data-act]').forEach((b) => (b.disabled = true));
  const r = await api.run({ kind: a.id, id: S.runId });
  S.running = null;
  document.querySelectorAll('[data-act]').forEach((b) => (b.disabled = false));
  if (!r.ok) { rc.className = 'chip bad'; rc.textContent = 'Échec'; out.textContent += '\n' + r.error; return; }
  const good = r.code === 0;
  rc.className = 'chip ' + (good ? 'ok' : 'bad'); rc.textContent = good ? 'Terminé' : `Terminé avec une erreur (code ${r.code})`;
  out.textContent += `\n\n${good ? 'Terminé.' : 'Une erreur est survenue : copie ce déroulé et montre-le à Claude.'}`;
  out.scrollTop = out.scrollHeight; $('copyRun').hidden = false;
  if (a.id === 'reboot') S.rebooting = true; else refreshAll();
}
api.onData((m) => {
  if (m.id !== S.runId) return;
  const out = $('runOut'); out.textContent += m.chunk; out.scrollTop = out.scrollHeight;
});
$('copyRun').onclick = async () => { await api.copy($('runOut').textContent); toast('Déroulé copié.'); };

// =====================================================================
//  SERVICES
// =====================================================================
// [motif, titre, description, avertissement (optionnel), technique?]
const KNOWN = [
  [/^(ssh|sshd)$/, 'Accès à distance (SSH)', "Permet de se connecter au serveur, comme le fait cette application.", "Ne l'arrête jamais : tu perdrais l'accès au serveur. Le redémarrer est sans danger pour ta connexion actuelle."],
  [/^nginx$/, 'Serveur web Nginx', 'Affiche tes sites web aux visiteurs.'],
  [/^(apache2|httpd)$/, 'Serveur web Apache', 'Affiche tes sites web aux visiteurs.'],
  [/^caddy$/, 'Serveur web Caddy', 'Affiche tes sites web aux visiteurs.'],
  [/^traefik$/, 'Traefik', 'Aiguille les visiteurs vers les bonnes applications.'],
  [/^docker$/, 'Docker', 'Fait tourner tes applications dans des conteneurs.', 'Redémarrer Docker coupe brièvement toutes tes applications Docker.'],
  [/^containerd$/, 'Containerd', 'Moteur interne de Docker.', null, true],
  [/^cron$/, 'Tâches planifiées', 'Lance automatiquement les tâches programmées (sauvegardes, nettoyages…).'],
  [/^ufw$/, 'Pare-feu (UFW)', 'Filtre les connexions autorisées vers le serveur.'],
  [/^fail2ban$/, 'Anti-intrusion (Fail2ban)', 'Bloque les adresses qui essaient de deviner ton mot de passe.'],
  [/^postgresql.*$/, 'Base de données PostgreSQL', 'Stocke les données de tes applications.', 'Les applications qui utilisent la base seront brièvement coupées.'],
  [/^(mysql|mariadb)$/, 'Base de données MySQL / MariaDB', 'Stocke les données de tes applications.', 'Les applications qui utilisent la base seront brièvement coupées.'],
  [/^redis(-server)?$/, 'Redis', 'Mémoire rapide utilisée par certaines applications.'],
  [/^mongod$/, 'Base de données MongoDB', 'Stocke les données de tes applications.', 'Les applications qui utilisent la base seront brièvement coupées.'],
  [/^php[\d.]*-fpm$/, 'PHP', 'Fait fonctionner WordPress et les autres sites PHP.'],
  [/^unattended-upgrades$/, 'Mises à jour automatiques', 'Installe seul les correctifs de sécurité.'],
  [/^tailscaled$/, 'Tailscale (VPN)', 'Accès privé et sécurisé à ton serveur.'],
  [/^cloudflared$/, 'Cloudflare Tunnel', 'Expose tes sites via Cloudflare sans ouvrir de port.'],
  [/^wg-quick.*$/, 'WireGuard (VPN)', 'Connexion privée et chiffrée.'],
  [/^certbot.*$/, 'Certificats HTTPS (Certbot)', 'Renouvelle les cadenas HTTPS de tes sites.'],
  [/^(rsyslog|systemd-journald)$/, 'Journaux système', 'Enregistre ce qui se passe sur le serveur.', null, true],
  [/^(chrony|chronyd|ntp|systemd-timesyncd)$/, 'Heure du serveur', "Garde l'horloge du serveur à l'heure.", null, true],
  [/^qemu-guest-agent$/, "Agent de l'hébergeur", "Permet à l'hébergeur de gérer la machine virtuelle.", null, true],
];
const TECH_RE = /^(systemd-|user@|user-runtime|getty|serial-getty|dbus|polkit|udev|multipathd|snapd|packagekit|networkd-dispatcher|ModemManager|accounts-daemon|irqbalance|lvm|cloud-|open-vm|vmtoolsd|apport|ubuntu-|rpc|nfs|blk|console|keyboard|plymouth|setvtrgb|lxd|thermald|fwupd|wpa_supplicant|NetworkManager|networking|e2scrub|finalrd|motd|sysstat|hv_|walinuxagent|google-|amazon-|oracle-)/;
function describeService(name) {
  for (const [re, title, desc, warn, tech] of KNOWN) if (re.test(name)) return { known: true, title, desc, warn: warn || '', tech: !!tech, name };
  return { known: false, title: name, desc: TECH_RE.test(name) ? 'Service technique du système.' : 'Programme installé sur ton serveur.', warn: '', tech: TECH_RE.test(name), name };
}
const VERB = { restart: 'Redémarrer', stop: 'Arrêter', start: 'Démarrer' };

async function svcAction(kind, verb, name, label, warn) {
  if (verb !== 'start') {
    const ok = await ask({ title: `${VERB[verb]} « ${label} » ?`, text: (warn ? warn + '\n' : '') + (verb === 'stop' ? 'Il restera arrêté jusqu\'à ce que tu le redémarres.' : 'Tes données ne sont pas touchées. Le programme sera brièvement indisponible.'), yes: VERB[verb], danger: verb === 'stop' });
    if (!ok) return;
  }
  toast(`${VERB[verb]} « ${label} »…`);
  const r = await api.run({ kind, verb, name });
  toast(r.ok ? `Fait : ${VERB[verb].toLowerCase()} « ${label} ».` : r.error);
  refreshAll();
}

function svcRow({ dot, title, tech, desc, buttons }) {
  const row = el('div', 'svc'); row.append(el('span', 'dot ' + dot));
  const t = el('div', 'grow'); const tt = el('div', 't', title); t.append(tt);
  if (tech && tech !== title) { const c = el('span', 'code', tech); c.style.marginLeft = '8px'; tt.append(c); }
  if (desc) t.append(el('div', 'd', desc));
  row.append(t); buttons.forEach((b) => row.append(b)); return row;
}
function actBtn(kind, verb, name, label, warn) {
  const b = el('button', 'btn sm' + (verb === 'stop' ? ' dng' : ''), VERB[verb]); b.onclick = () => svcAction(kind, verb, name, label, warn); return b;
}

function renderServices() {
  const sum = clear($('svcSummary'));
  sum.append(chip('info', plural(S.svc.services.length, 'service actif', 'services actifs')),
    S.svc.failed.length ? chip('bad', plural(S.svc.failed.length, 'service en échec', 'services en échec')) : chip('ok', 'Aucun service en échec'),
    chip('info', plural(S.svc.docker.length, 'conteneur Docker', 'conteneurs Docker')));

  const fc = clear($('failedCard'));
  if (S.svc.failed.length) {
    const c = el('article', 'card col badc'); c.append(el('h3', null, 'Services en échec'));
    c.firstChild.style.fontSize = '19px';
    c.append(el('p', 'soft', 'Ces programmes ont planté. Les redémarrer règle souvent le problème.'));
    S.svc.failed.forEach((n) => { const d = describeService(n); c.append(svcRow({ dot: 'r', title: d.title, tech: n, desc: d.desc, buttons: [actBtn('service', 'restart', n, d.title, d.warn)] })); });
    fc.append(c);
  }

  const dl = clear($('dockerList'));
  if (!S.svc.docker.length) dl.append(el('p', 'muted', "Aucun conteneur Docker détecté sur ton serveur."));
  S.svc.docker.forEach((c) => {
    const up = /^Up/i.test(c.status);
    dl.append(svcRow({ dot: up ? 'g' : 'r', title: c.name, desc: `${frDocker(c.status)} · image ${c.image}`,
      buttons: up ? [actBtn('docker', 'restart', c.name, c.name), actBtn('docker', 'stop', c.name, c.name)] : [actBtn('docker', 'start', c.name, c.name)] }));
  });

  const q = $('svcSearch').value.trim().toLowerCase(), showTech = $('svcTech').checked;
  const sl = clear($('svcList')); let n = 0;
  S.svc.services.forEach((name) => {
    const d = describeService(name);
    if (d.tech && !showTech) return;
    if (q && !(d.title + ' ' + name).toLowerCase().includes(q)) return;
    n++; sl.append(svcRow({ dot: 'g', title: d.title, tech: name, desc: d.desc, buttons: [actBtn('service', 'restart', name, d.title, d.warn)] }));
  });
  if (!n) sl.append(el('p', 'muted', q ? 'Aucun service ne correspond à ta recherche.' : 'Aucun service à afficher. Coche « Afficher aussi les services techniques » pour tout voir.'));
}
$('svcSearch').addEventListener('input', renderServices);
$('svcTech').addEventListener('change', renderServices);

// =====================================================================
//  JOURNAL
// =====================================================================
async function loadLogs() {
  $('logsBox').textContent = 'Chargement…';
  const r = await api.run({ kind: 'logs', id: 'logs' });
  S.logs = r.ok ? r.out.trim() : r.error; S.logsLoaded = !!r.ok; renderLogs();
}
function renderLogs() {
  const f = $('logFilter').value.trim().toLowerCase();
  const lines = (S.logs || '').split('\n').filter((l) => !f || l.toLowerCase().includes(f));
  $('logsBox').textContent = lines.length && lines.join('') ? lines.join('\n') : (S.logs ? 'Aucune ligne ne correspond à ton filtre.' : 'Aucune erreur récente. Tout est calme.');
  $('logCount').textContent = S.logs ? plural(lines.length, 'ligne', 'lignes') : '';
  const box = $('logsBox'); box.scrollTop = box.scrollHeight;
}
$('logFilter').addEventListener('input', renderLogs);
$('refreshLogs').onclick = loadLogs;
$('copyLogs').onclick = async () => { await api.copy($('logsBox').textContent); toast('Journal copié.'); };

// =====================================================================
//  AIDE : rapport de diagnostic
// =====================================================================
$('diagBtn').onclick = async () => {
  const b = $('diagBtn'); b.disabled = true; b.textContent = 'Création du rapport…';
  const r = await api.run({ kind: 'diagnostic' });
  b.disabled = false; b.textContent = 'Créer un rapport de diagnostic';
  const out = $('diagOut'); out.hidden = false;
  out.textContent = r.ok ? r.out.trim() : r.error;
  $('diagCopy').hidden = !r.ok;
};
$('diagCopy').onclick = async () => { await api.copy($('diagOut').textContent); toast('Rapport copié : colle-le dans ta conversation avec Claude.'); };

// =====================================================================
//  Démarrage
// =====================================================================
(async function init() {
  profile = await api.loadProfile();
  S.apps = await api.loadApps();
  if (profile) {
    $('host').value = profile.host; $('username').value = profile.username; $('port').value = profile.port;
    $('remember').checked = profile.remember !== false;
    setMode(profile.authMode === 'key' ? 'key' : 'pw');
    $('keyPath').value = profile.keyPath || '';
    if (profile.hasPassword) $('password').placeholder = '•••••••• (mémorisé)';
    if (profile.hasPassphrase) $('passphrase').placeholder = '•••••••• (mémorisée)';
  }
  buildTypeCards();
})();



// =====================================================================
//  FICHIERS ET BASES DE DONNÉES
// =====================================================================
const F = { path: '', entries: [], editing: null, creating: false };
// Mêmes règles que remote.js (qui les revérifie sur le serveur) : lecture partout, écriture partout sauf la racine,
// les dossiers de premier niveau et les systèmes virtuels. Hors des dossiers de travail, un dossier ne se renomme
// ou ne se supprime qu'à partir du 3e niveau, et un fichier écrasé ou supprimé est d'abord copié dans SYS_BACKUP_DIR.
const WORK_ROOTS = [['/home', 2], ['/root', 1], ['/var/www', 1], ['/srv', 1], ['/opt', 1], ['/tmp', 1]];
const VIRTUAL_ROOTS = ['/proc', '/sys', '/dev', '/run'];
const SYS_BACKUP_DIR = '/var/backups/vps-cockpit';
const depthOf = (p) => p.split('/').filter(Boolean).length;
const isVirtual = (p) => VIRTUAL_ROOTS.some((r) => p === r || p.startsWith(r + '/'));
const isWork = (p) => WORK_ROOTS.some(([r, d]) => p.startsWith(r + '/') && p.slice(r.length + 1).split('/').length >= d);
const canWrite = (p) => depthOf(p) >= 2 && !isVirtual(p);
const canMoveDir = (p) => isWork(p) || (canWrite(p) && depthOf(p) >= 3);
const canBackup = (p) => p !== '/' && !isVirtual(p);
const fmtSize = (n) => (n < 1024 ? `${n} o` : n < 1048576 ? `${(n / 1024).toFixed(1).replace('.', ',')} Ko` : fmtBytes(n));
const joinPath = (d, n) => (d === '/' ? '' : d) + '/' + n;
const parentOf = (p) => { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };
const VALID_NAME = /^[A-Za-z0-9._@:+~ -]{1,120}$/;
function showErr(id, msg) { const e = $(id); e.textContent = msg || ''; e.hidden = !msg; }
function frErr(m) {
  if (/Permission denied/i.test(m)) return "Droits insuffisants pour cette action. Connecte-toi en root, ou choisis un dossier qui t'appartient.";
  if (/already exists|existe déjà/i.test(m)) return m.includes('existe') ? m : 'Cela existe déjà.';
  if (/being accessed by other users/i.test(m)) return "Cette base est utilisée en ce moment. Arrête l'application qui s'en sert, puis réessaie.";
  if (/1396|DROP USER failed/i.test(m)) return "Cet utilisateur n'existe pas (ou plus).";
  if (/cannot be dropped because some objects depend on it/i.test(m)) return "Cet utilisateur possède encore des tables ou des droits ailleurs : je ne le supprime pas pour ne rien casser.";
  if (/No space left/i.test(m)) return "Le disque est plein : impossible d'écrire.";
  return m;
}
// Lance une action fichier / base ; retourne { ok, msg, out }.
async function fsRun(req) {
  const r = await api.run(req);
  if (!r.ok) return { ok: false, msg: r.error };
  const e = /^ERR=(.*)$/m.exec(r.out || ''), o = /^OK=(.*)$/m.exec(r.out || '');
  if (e) return { ok: false, msg: frErr(e[1]) };
  if (req.op !== 'list' && req.op !== 'read' && !o) return { ok: false, msg: frErr((r.out || 'Réponse inattendue du serveur.').trim().slice(0, 300)) };
  return { ok: true, msg: o ? o[1] : '', out: r.out || '' };
}
async function openFiles() {
  if (!F.path) F.path = S.user === 'root' ? '/root' : `/home/${S.user}`;
  await loadDir(F.path);
  loadDbs().then(() => { renderDbs(); return loadUsers(); }).then(renderUsers);
}
async function loadDir(path) {
  showErr('fErr', '');
  $('fPath').value = path;
  const r = await fsRun({ kind: 'fs', op: 'list', args: { path } });
  if (!r.ok) { showErr('fErr', r.msg); return; }
  const real = /^PATH=(.*)$/m.exec(r.out); F.path = real ? real[1] : path; $('fPath').value = F.path;
  F.entries = r.out.split('\n').map((l) => l.split('|')).filter((p) => p.length >= 4 && /^[dfl]$/.test(p[0]))
    .map((p) => ({ type: p[0], size: Number(p[1]) || 0, date: p[2], name: p.slice(3).join('|') }));
  renderFiles();
}
function renderCrumbs() {
  const nav = clear($('fCrumbs'));
  const parts = F.path.split('/').filter(Boolean);
  const mk = (label, path, last) => { const b = el('button', 'crumb' + (last ? ' on' : ''), label); b.type = 'button'; if (last) b.disabled = true; else b.onclick = () => loadDir(path); return b; };
  nav.append(mk('Racine', '/', parts.length === 0));
  let acc = '';
  parts.forEach((p, i) => { acc += '/' + p; nav.append(el('span', 'sep', '›'), mk(p, acc, i === parts.length - 1)); });
}
document.querySelectorAll('#fTabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#fTabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('#page-files [data-pane]').forEach((p) => p.classList.toggle('tabhide', p.dataset.pane !== b.dataset.tab));
  };
});
function renderFiles() {
  renderCrumbs();
  const box = clear($('fList'));
  const writable = canWrite(F.path + '/x');
  if (!F.entries.length) box.append(el('p', 'muted', 'Ce dossier est vide.'));
  F.entries.forEach((e) => {
    const full = joinPath(F.path, e.name);
    const row = el('div', 'frow');
    const nm = el('div', 'fname'); nm.append(icon(e.type === 'd' ? 'folder' : 'file'));
    if (e.type === 'd') { const b = el('button', 'linkbtn name', e.name); b.onclick = () => loadDir(full); nm.append(b); }
    else if (e.type === 'f') { const b = el('button', 'linkbtn name', e.name); b.onclick = () => openEditor(full); nm.append(b); }
    else nm.append(el('span', null, e.name + (e.type === 'l' ? ' (lien)' : '')));
    const meta = el('div', 'fmeta', (e.type === 'd' ? 'Dossier' : fmtSize(e.size)) + ' · ' + e.date);
    const acts = el('div', 'row');
    if (e.type === 'd' && canBackup(full)) { const bk = el('button', 'linkbtn bkbtn', 'Sauvegarder'); bk.onclick = () => runBackup({ kind: 'dir', path: full }, e.name); acts.append(bk); }
    if (e.type === 'd' ? canMoveDir(full) : canWrite(full)) {
      if (e.type === 'f') { const m = el('button', 'linkbtn', 'Modifier'); m.onclick = () => openEditor(full); acts.append(m); }
      const rn = el('button', 'linkbtn', 'Renommer'); rn.onclick = () => renameEntry(e, full); acts.append(rn);
      const dl = el('button', 'linkbtn dng', 'Supprimer'); dl.onclick = () => deleteEntry(e, full); acts.append(dl);
    }
    row.append(nm, meta, acts); box.append(row);
  });
  $('fBackup').disabled = !canBackup(F.path);
  $('fBackup').title = canBackup(F.path) ? '' : 'Je ne sauvegarde ni la racine entière, ni /proc, /sys, /dev et /run.';
  $('fNewDir').disabled = $('fNewFile').disabled = !writable;
  $('fNewDir').title = $('fNewFile').title = writable ? '' : 'Je ne crée rien ici : la racine et les dossiers /proc, /sys, /dev et /run sont protégés.';
}
$('fGo').onclick = () => loadDir($('fPath').value.trim() || '/');
$('fPath').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('fGo').click(); });
$('fUp').onclick = () => loadDir(parentOf(F.path));

async function newDir() {
  const n = await askInput({ title: 'Nouveau dossier', text: `Dans ${F.path}`, placeholder: 'nom-du-dossier', yes: 'Créer' });
  if (n === null) return;
  if (!VALID_NAME.test(n) || n === '.' || n === '..') return showErr('fErr', 'Nom invalide : lettres, chiffres et . _ - @ : + ~ espace seulement.');
  const r = await fsRun({ kind: 'fs', op: 'mkdir', args: { path: joinPath(F.path, n) } });
  if (!r.ok) return showErr('fErr', r.msg);
  toast('Dossier créé.'); loadDir(F.path);
}
async function newFile() {
  const n = await askInput({ title: 'Nouveau fichier', text: `Dans ${F.path}`, placeholder: 'notes.txt', yes: 'Créer' });
  if (n === null) return;
  if (!VALID_NAME.test(n) || n === '.' || n === '..') return showErr('fErr', 'Nom invalide : lettres, chiffres et . _ - @ : + ~ espace seulement.');
  F.editing = joinPath(F.path, n); F.creating = true;
  $('fEditTitle').textContent = `Nouveau fichier : ${n}`; $('fText').value = ''; showErr('fEditErr', '');
  $('fEdit').hidden = false; $('fText').focus();
}
$('fNewDir').onclick = newDir; $('fNewFile').onclick = newFile;
$('fBackup').classList.add('bkbtn');
$('fBackup').onclick = () => runBackup({ kind: 'dir', path: F.path }, F.path);

async function openEditor(path) {
  showErr('fErr', '');
  const r = await fsRun({ kind: 'fs', op: 'read', args: { path } });
  if (!r.ok) return showErr('fErr', r.msg);
  const i = r.out.indexOf('[contenu]\n');
  F.editing = path; F.creating = false;
  $('fEditTitle').textContent = `Modifier : ${path}`; $('fText').value = i >= 0 ? r.out.slice(i + 10) : '';
  showErr('fEditErr', ''); $('fEdit').hidden = false;
  $('fEdit').scrollIntoView({ behavior: 'smooth' });
}
$('fSave').onclick = async () => {
  if (!F.editing) return;
  const sys = !isWork(F.editing);
  const warn = sys
    ? `${F.editing} est un fichier du système : une erreur peut empêcher un service, ou le serveur, de fonctionner. L'ancienne version sera d'abord copiée dans ${SYS_BACKUP_DIR}.`
    : `Le contenu de ${F.editing} sera remplacé par ce que tu as écrit. Il n'y a pas de retour en arrière : garde une copie si tu hésites.`;
  if ((!F.creating || sys) && !(await ask({ title: F.creating ? 'Créer ce fichier système ?' : 'Enregistrer les modifications ?', text: F.creating ? `${F.editing} sera créé hors de tes dossiers de travail. Un fichier mal placé peut perturber un service.` : warn, yes: F.creating ? 'Créer' : 'Enregistrer', danger: sys }))) return;
  const r = await fsRun({ kind: 'fs', op: 'write', args: { path: F.editing, content: $('fText').value, create: F.creating } });
  if (!r.ok) return showErr('fEditErr', r.msg);
  toast(r.msg || 'Fichier enregistré.');
  if (F.creating) { F.creating = false; $('fEditTitle').textContent = `Modifier : ${F.editing}`; loadDir(F.path); }
};
$('fClose').onclick = () => { F.editing = null; F.creating = false; $('fEdit').hidden = true; };

async function renameEntry(e, full) {
  const sys = !isWork(full);
  const n = await askInput({ title: `Renommer « ${e.name} »`, text: `Dans ${F.path}` + (sys ? "\nAttention : cet élément est hors de tes dossiers de travail. Un service qui s'en sert sous son nom actuel ne le trouvera plus." : ''), value: e.name, yes: 'Renommer', danger: sys });
  if (n === null || n === e.name) return;
  if (!VALID_NAME.test(n) || n === '.' || n === '..') return showErr('fErr', 'Nom invalide : lettres, chiffres et . _ - @ : + ~ espace seulement.');
  const r = await fsRun({ kind: 'fs', op: 'rename', args: { from: full, to: joinPath(F.path, n) } });
  if (!r.ok) return showErr('fErr', r.msg);
  toast('Renommé.'); loadDir(F.path);
}
async function deleteEntry(e, full) {
  const isDir = e.type === 'd';
  const n = await askInput({
    title: `Supprimer ${isDir ? 'le dossier' : 'le fichier'} « ${e.name} » ?`,
    text: (isDir ? 'Le dossier ET tout ce qu\'il contient seront supprimés. ' : '')
      + (isWork(full) ? '' : 'Attention : cet élément est hors de tes dossiers de travail, le supprimer peut casser un service ou le serveur. ' + (e.type === 'f' ? `Une copie du fichier sera gardée dans ${SYS_BACKUP_DIR}. ` : 'Aucune copie n\'est gardée pour un dossier. '))
      + `Cette action est définitive : il n'y a pas de corbeille.\nPour confirmer, retape exactement : ${e.name}`,
    placeholder: e.name, yes: 'Supprimer', danger: true, expect: e.name,
  });
  if (n === null) return;
  const r = await fsRun({ kind: 'fs', op: 'delete', args: { path: full } });
  if (!r.ok) return showErr('fErr', r.msg);
  if (F.editing === full) $('fClose').click();
  toast(r.msg || 'Supprimé.'); loadDir(F.path);
}

// ----- sauvegardes -----
const BK = { busy: false };
function bkSay(title, text, { show = false, close = false } = {}) {
  $('bkCard').hidden = false; $('bkTitle').textContent = title; $('bkText').textContent = text;
  $('bkShow').hidden = !show; $('bkClose').hidden = !close;
}
$('bkShow').onclick = () => api.backupShow();
$('bkClose').onclick = () => { $('bkCard').hidden = true; };
api.onBackupProgress((p) => { if (BK.busy) $('bkText').textContent = `${fmtSize(p.bytes)} reçus sur ton PC…`; });
async function runBackup(req, what) {
  if (BK.busy) return toast('Une sauvegarde est déjà en cours.');
  BK.busy = true;
  bkSay('Sauvegarde en cours', "Choisis où l'enregistrer sur ton PC…");
  document.querySelectorAll('.bkbtn').forEach((b) => (b.disabled = true));
  try {
    const r = await api.backup(req);
    if (r.canceled) { $('bkCard').hidden = true; return; }
    if (!r.ok) return bkSay('La sauvegarde a échoué', frErr(r.error), { close: true });
    bkSay('Sauvegarde terminée', `« ${what} » a été enregistré sur ton PC (${fmtSize(r.size)}) : ${r.file}`, { show: true, close: true });
    toast('Sauvegarde terminée.');
  } finally {
    BK.busy = false;
    document.querySelectorAll('.bkbtn').forEach((b) => (b.disabled = false));
  }
}

// ----- bases de données -----
const ENGINE_NAMES = { postgres: 'PostgreSQL', mysql: 'MySQL / MariaDB' };
const PROTECTED_DB = ['postgres', 'template0', 'template1', 'mysql', 'information_schema', 'performance_schema', 'sys'];
function renderDbs() {
  const box = clear($('dbList'));
  if (!S.dbs) { box.append(el('p', 'muted', "Je n'ai pas pu lire la liste des bases du serveur.")); return; }
  ['postgres', 'mysql'].forEach((eng) => {
    const info = S.dbs[eng];
    box.append(el('div', 'label', ENGINE_NAMES[eng]));
    if (info.state === 'none') { box.append(el('p', 'muted', 'Pas installé sur ce serveur.')); return; }
    if (info.state === 'down') { box.append(el('p', 'muted', 'Installé, mais il ne répond pas pour le moment.')); return; }
    const list = info.dbs.filter((d) => !PROTECTED_DB.includes(d.toLowerCase()));
    if (!list.length) box.append(el('p', 'muted', 'Aucune base à toi pour le moment.'));
    list.forEach((d) => {
      const row = el('div', 'frow'); const nm = el('div', 'fname'); nm.append(icon('disk'), el('span', null, d));
      const bk = el('button', 'linkbtn bkbtn', 'Sauvegarder'); bk.onclick = () => runBackup({ kind: 'db', engine: eng, name: d }, d);
      const dl = el('button', 'linkbtn dng', 'Supprimer'); dl.onclick = () => dropDb(eng, d);
      const acts = el('div', 'row'); acts.append(bk, dl); row.append(nm, acts); box.append(row);
    });
  });
}
$('dbCreate').onclick = async () => {
  showErr('dbErr', '');
  const eng = $('dbEng').value, n = $('dbNew').value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(n)) return showErr('dbErr', 'Nom invalide : il commence par une lettre, puis lettres, chiffres et _ (sans espace ni tiret).');
  if (PROTECTED_DB.includes(n.toLowerCase())) return showErr('dbErr', 'Ce nom est réservé par le serveur.');
  if (!(await ask({ title: `Créer la base « ${n} » ?`, text: `Une base vide ${ENGINE_NAME_OF(eng)} nommée « ${n} » sera créée sur ton serveur.`, yes: 'Créer' }))) return;
  const r = await fsRun({ kind: 'dbadmin', op: 'create', engine: eng, name: n });
  if (!r.ok) return showErr('dbErr', r.msg);
  $('dbNew').value = ''; toast(`Base « ${n} » créée.`); await loadDbs(); renderDbs(); fillUserDbs();
};
const ENGINE_NAME_OF = (e) => ENGINE_NAMES[e];
async function dropDb(eng, n) {
  showErr('dbErr', '');
  const t = await askInput({
    title: `Supprimer la base « ${n} » ?`,
    text: `Toutes les données de cette base ${ENGINE_NAMES[eng]} seront effacées définitivement, sans retour en arrière. Vérifie qu'aucune application ne l'utilise.\nPour confirmer, retape exactement : ${n}`,
    placeholder: n, yes: 'Supprimer la base', danger: true, expect: n,
  });
  if (t === null) return;
  const r = await fsRun({ kind: 'dbadmin', op: 'drop', engine: eng, name: n });
  if (!r.ok) return showErr('dbErr', r.msg);
  toast(`Base « ${n} » supprimée.`); await loadDbs(); renderDbs(); fillUserDbs();
}

// ----- utilisateurs de bases -----
const U = { pass: '', url: '' };
function genPassword(n = 24) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const out = []; const buf = new Uint8Array(64);
  while (out.length < n) { crypto.getRandomValues(buf); for (const b of buf) { if (b < 248 && out.length < n) out.push(A[b % 62]); } } // 248 = 62 × 4 : pas de biais
  return out.join('');
}
async function loadUsers() {
  const r = await api.run({ kind: 'dbusers' });
  S.users = r.ok ? r.data : null;
}
function fillUserDbs() {
  const sel = $('uDb'); const eng = $('uEng').value; const keep = sel.value;
  sel.replaceChildren();
  const info = S.dbs && S.dbs[eng];
  const list = info && info.state === 'up' ? info.dbs.filter((d) => !PROTECTED_DB.includes(d.toLowerCase())) : [];
  if (!list.length) { const o = el('option', null, 'Aucune base disponible'); o.value = ''; sel.append(o); return; }
  list.forEach((d) => { const o = el('option', null, d); o.value = d; sel.append(o); });
  if (list.includes(keep)) sel.value = keep;
}
function renderUsers() {
  fillUserDbs();
  const box = clear($('uList'));
  if (!S.users) { box.append(el('p', 'muted', "Je n'ai pas pu lire la liste des utilisateurs du serveur.")); return; }
  ['postgres', 'mysql'].forEach((eng) => {
    const info = S.users[eng];
    box.append(el('div', 'label', ENGINE_NAMES[eng]));
    if (info.state === 'none') { box.append(el('p', 'muted', 'Pas installé sur ce serveur.')); return; }
    if (info.state === 'down') { box.append(el('p', 'muted', 'Installé, mais il ne répond pas pour le moment.')); return; }
    if (!info.users.length) box.append(el('p', 'muted', 'Aucun utilisateur pour le moment.'));
    info.users.forEach((u) => {
      const row = el('div', 'frow'); const nm = el('div', 'fname'); nm.append(icon('disk'), el('span', null, u));
      const dl = el('button', 'linkbtn dng', 'Supprimer'); dl.onclick = () => dropUser(eng, u);
      const acts = el('div', 'row'); acts.append(dl); row.append(nm, acts); box.append(row);
    });
  });
}
$('uEng').onchange = fillUserDbs;
function closeUserResult() { U.pass = ''; U.url = ''; $('uResPass').textContent = ''; $('uResult').hidden = true; }
$('uResClose').onclick = closeUserResult;
$('uCopyPass').onclick = async () => { await api.copy(U.pass); toast('Mot de passe copié.'); };
$('uCopyUrl').onclick = async () => { await api.copy(U.url); toast('Adresse de connexion copiée.'); };
$('uCreate').onclick = async () => {
  showErr('uErr', ''); closeUserResult();
  const eng = $('uEng').value, db = $('uDb').value, u = $('uName').value.trim();
  if (!db) return showErr('uErr', 'Choisis une base : crée-en une d\'abord dans la carte du dessus.');
  if (!/^[a-z][a-z0-9_]{0,30}$/.test(u)) return showErr('uErr', "Nom invalide : minuscules, chiffres et _ seulement, il commence par une lettre (31 caractères maximum).");
  if (['postgres', 'root', 'mysql', 'mariadb', 'admin', 'public', 'debian'].includes(u) || /^pg_/.test(u)) return showErr('uErr', 'Ce nom est réservé par le serveur.');
  if (!(await ask({ title: `Créer l'utilisateur « ${u} » ?`, text: `Il aura un accès complet à la base « ${db} » (${ENGINE_NAMES[eng]}), et à aucune autre. Son mot de passe sera généré puis affiché une seule fois.`, yes: 'Créer' }))) return;
  const pw = genPassword();
  const r = await fsRun({ kind: 'dbuser', op: 'create', engine: eng, user: u, db, password: pw });
  if (!r.ok) return showErr('uErr', r.msg);
  U.pass = pw;
  U.url = eng === 'postgres' ? `postgresql://${u}:${pw}@localhost:5432/${db}` : `mysql://${u}:${pw}@localhost:3306/${db}`;
  $('uResUser').textContent = u; $('uResPass').textContent = pw; $('uResult').hidden = false;
  $('uName').value = ''; await loadUsers(); renderUsers();
  $('uResult').scrollIntoView({ behavior: 'smooth' });
};
async function dropUser(eng, u) {
  showErr('uErr', '');
  const t = await askInput({
    title: `Supprimer l'utilisateur « ${u} » ?`,
    text: `Les applications qui se connectent avec « ${u} » n'y arriveront plus. Les données de la base ne sont pas touchées.\nPour confirmer, retape exactement : ${u}`,
    placeholder: u, yes: "Supprimer l'utilisateur", danger: true, expect: u,
  });
  if (t === null) return;
  const r = await fsRun({ kind: 'dbuser', op: 'drop', engine: eng, user: u });
  if (!r.ok) return showErr('uErr', r.msg);
  toast(`Utilisateur « ${u} » supprimé.`); await loadUsers(); renderUsers();
}

// =====================================================================
//  ALERTES WINDOWS
// =====================================================================
const AL = { on: true, fails: {}, down: {} };
const alKey = (a) => `${a.type}|${a.target}|${a.name}`;
// Une panne n'est annoncée qu'au 2e contrôle raté d'affilée ; le retour à la normale est annoncé une fois.
function runAlerts() {
  const seen = new Set();
  S.apps.forEach((a, i) => {
    const r = S.res[i]; if (!r) return;
    const k = alKey(a); seen.add(k);
    if (r.state === 'red') {
      AL.fails[k] = (AL.fails[k] || 0) + 1;
      if (AL.fails[k] >= 2 && !AL.down[k]) { AL.down[k] = true; api.notify(`${a.name} : problème`, `${r.word}. ${r.detail || ''}`.trim()); }
    } else if (r.state === 'green' || r.state === 'orange') {
      AL.fails[k] = 0;
      if (AL.down[k]) { AL.down[k] = false; api.notify(`${a.name} : de nouveau en ligne`, 'Tout est revenu à la normale.'); }
    }
  });
  Object.keys(AL.fails).forEach((k) => { if (!seen.has(k)) { delete AL.fails[k]; delete AL.down[k]; } });
}
function showAlModes() { document.querySelectorAll('#alModes .type').forEach((b) => b.classList.toggle('sel', (b.dataset.on === '1') === AL.on)); }
document.querySelectorAll('#alModes .type').forEach((b) => {
  b.onclick = async () => {
    const r = await api.alertsSet(b.dataset.on === '1'); AL.on = r.on; showAlModes();
    $('alMsg').textContent = AL.on ? 'Alertes activées.' : 'Alertes désactivées : aucune notification ne sera envoyée.';
  };
});
$('alTest').onclick = async () => {
  const sent = await api.notify('VPS-Cockpit', 'Ceci est une notification de test : les alertes fonctionnent.');
  $('alMsg').textContent = sent ? 'Notification envoyée. Si tu ne vois rien, regarde les réglages Windows (Notifications, assistant de concentration).' : (AL.on ? "Windows n'a pas pu afficher la notification." : "Les alertes sont désactivées : active-les d'abord.");
};
(async () => { const r = await api.alertsGet(); AL.on = r.on; showAlModes(); })();

// =====================================================================
//  MISES À JOUR
// =====================================================================
const upd = { busy: false, mode: 'auto' };
function updMsg(text, bad) { const m = $('updMsg'); m.textContent = text; m.className = (bad ? 'msg err' : 'muted') + ' small'; }
function showModes() { document.querySelectorAll('#updModes .type').forEach((b) => b.classList.toggle('sel', b.dataset.mode === upd.mode)); }
// Télécharge, vérifie, remplace, redémarre.
async function installUpdate() {
  if (upd.busy) return;
  upd.busy = true; $('updBtns').hidden = true; $('updBar').hidden = false; $('updProg').hidden = false; $('updFill').style.width = '0%';
  $('updInstall').hidden = true;
  $('updTitle').textContent = upd.newVer ? `Mise à jour vers v${upd.newVer}` : 'Mise à jour en cours';
  $('updText').textContent = 'Téléchargement…';
  const res = await api.updateInstall();
  if (res.ok) { $('updTitle').textContent = 'Mise à jour installée'; $('updText').textContent = "L'application redémarre…"; return; }
  upd.busy = false; $('updProg').hidden = true; $('updBtns').hidden = false;
  $('updTitle').textContent = 'La mise à jour a échoué'; $('updText').textContent = res.error;
}
// auto = true : on installe tout de suite si une mise à jour existe ; sinon on propose le bouton « Installer ».
async function checkUpdate(auto, silent) {
  if (upd.busy) return;
  const r = await api.updateCheck();
  if (!r.ok) { if (!silent) updMsg(r.error, true); return; }
  if (r.current) $('updCur').textContent = 'v' + r.current;
  if (r.upToDate) { $('updInstall').hidden = true; $('updNewBox').hidden = true; upd.newVer = ''; if (!silent) updMsg(`VPS-Cockpit est à jour (v${r.current}).`); return; }
  upd.newVer = r.version || ''; $('updNew').textContent = upd.newVer ? 'v' + upd.newVer : ''; $('updNewBox').hidden = !upd.newVer;
  if (auto) { updMsg(`La version v${r.version} est disponible : installation en cours.`); await installUpdate(); return; }
  updMsg(`La version v${r.version} est disponible.`); $('updInstall').hidden = false;
}
document.querySelectorAll('#updModes .type').forEach((b) => {
  b.onclick = async () => { const r = await api.updateSetMode(b.dataset.mode); upd.mode = r.mode; showModes(); updMsg(r.mode === 'auto' ? "Mise à jour automatique activée : elle se fera au démarrage de l'application." : "Mise à jour manuelle activée : rien ne se fera sans toi."); };
});
$('updCheck').onclick = async () => { updMsg('Vérification…'); $('updInstall').hidden = true; await checkUpdate(false, false); };
$('updInstall').onclick = () => installUpdate();
$('updLater').onclick = () => { if (!upd.busy) $('updBar').hidden = true; };
$('updGo').onclick = () => installUpdate();
api.onUpdateProgress((p) => {
  const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
  $('updFill').style.width = pct + '%';
  $('updText').textContent = `Téléchargement : ${pct} %`;
});
(async () => {
  const i = await api.updateInfo();
  upd.mode = i.mode; showModes(); $('updCur').textContent = 'v' + i.version;
  if (i.repo && i.mode === 'auto') await checkUpdate(true, true);
})();

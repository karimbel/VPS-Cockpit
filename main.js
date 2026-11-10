'use strict';
const { app, BrowserWindow, Menu, ipcMain, dialog, safeStorage, net, clipboard, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { Client } = require('ssh2');
const R = require('./remote');
const U = require('./updater');
const pkg = require('./package.json');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

let win = null;
let conn = null;
let session = null; // { isRoot, password }

const dataFile = () => path.join(app.getPath('userData'), 'cockpit.json');

function loadData() {
  try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')); }
  catch { return { profile: null, hostKeys: {}, apps: [] }; }
}
function saveData(d) {
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(d, null, 2));
}
const enc = (s) => (s && safeStorage.isEncryptionAvailable()) ? safeStorage.encryptString(s).toString('base64') : '';
const dec = (s) => { try { return s ? safeStorage.decryptString(Buffer.from(s, 'base64')) : ''; } catch { return ''; } };

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 640, show: false,
    backgroundColor: '#17110f', title: 'VPS Cockpit', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => { if (!process.env.COCKPIT_NO_MAXIMIZE) win.maximize(); });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.setAppUserModelId('VPS-Cockpit');
Menu.setApplicationMenu(null); // pas de menu caché : Ctrl+R ne recharge plus la fenêtre (ce qui coupait la session)
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (conn) conn.end(); app.quit(); });


// ---------- Mises à jour (GitHub) ----------
// Principe : on lit la dernière « release » du dépôt, on compare son empreinte à celle de l'exe en cours,
// on télécharge, on vérifie l'empreinte, puis on remplace l'exe et on relance. Aucun numéro de version.
const exePath = () => process.env.PORTABLE_EXECUTABLE_FILE || '';
function getRepo() {
  const d = loadData();
  if (U.validRepo(d.updateRepo)) return d.updateRepo;
  const def = pkg.cockpit && pkg.cockpit.updateRepo;
  return U.validRepo(def) ? def : '';
}
const getMode = () => (loadData().updateMode === 'manual' ? 'manual' : 'auto');
let pending = null; // dernière mise à jour trouvée (les URL ne viennent jamais de l'interface)

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

ipcMain.handle('update:info', () => ({ version: app.getVersion(), repo: getRepo(), mode: getMode(), portable: !!exePath() }));
ipcMain.handle('update:setMode', (_e, mode) => { const d = loadData(); d.updateMode = mode === 'manual' ? 'manual' : 'auto'; saveData(d); return { ok: true, mode: getMode() }; });
ipcMain.handle('update:setRepo', (_e, repo) => {
  const r = String(repo || '').trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/+$/, '');
  if (r && !U.validRepo(r)) return { ok: false, error: 'Format attendu : nom-du-compte/nom-du-dépôt, par exemple monnom/vps-cockpit.' };
  const d = loadData(); d.updateRepo = r; saveData(d); pending = null;
  return { ok: true, repo: getRepo() };
});
ipcMain.handle('update:check', async () => {
  const repo = getRepo();
  if (!repo) return { ok: false, error: "Aucun dépôt de mises à jour n'est réglé. Renseigne-le dans les Réglages." };
  if (!exePath()) return { ok: false, error: "Les mises à jour ne fonctionnent qu'avec l'application installée (le fichier .exe)." };
  try {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 10000);
    const res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      signal: ctrl.signal, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'VPS-Cockpit' },
    });
    if (res.status === 404) { clearTimeout(to); return { ok: false, error: `Aucune mise à jour publiée sur « ${repo} » (ou le dépôt est privé ou introuvable).` }; }
    if (!res.ok) { clearTimeout(to); return { ok: false, error: `GitHub a répondu avec une erreur (${res.status}). Réessaie plus tard.` }; }
    const info = U.pickRelease(repo, await res.json());
    if (!info) { clearTimeout(to); return { ok: true, upToDate: true, current: app.getVersion() }; }
    clearTimeout(to);
    if (info.incomplete) return { ok: false, error: "La publication ne contient pas d'exe nommé VPS-Cockpit-vX.Y.Z.exe avec son empreinte." };
    const remoteSha = info.sha;
    const localSha = await hashFile(exePath());
    const localMtime = fs.statSync(exePath()).mtimeMs;
    if (!U.isNewer({ localSha, remoteSha, publishedAt: info.publishedAt, localMtime })) return { ok: true, upToDate: true, current: app.getVersion() };
    pending = { ...info };
    return { ok: true, upToDate: false, size: info.size, version: info.version, current: app.getVersion() };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'GitHub ne répond pas (délai dépassé).' : 'Impossible de joindre GitHub. Vérifie ta connexion.' };
  }
});
ipcMain.handle('update:install', async (e) => {
  const old = exePath();
  let part = '';
  try {
    if (!pending) throw new Error("Vérifie d'abord s'il existe une mise à jour.");
    if (!old) throw new Error("Les mises à jour ne fonctionnent qu'avec l'application installée (le fichier .exe).");
    // Le nouvel exe est téléchargé À CÔTÉ de l'ancien (on ne remplace jamais un exe qui tourne).
    const dir = path.dirname(old);
    let finalPath = path.join(dir, pending.exeName);
    if (finalPath.toLowerCase() === old.toLowerCase()) finalPath = finalPath.replace(/\.exe$/i, '-maj.exe');
    part = finalPath + '.part';
    // 1. téléchargement, avec calcul de l'empreinte au fil de l'eau
    const res = await net.fetch(pending.exeUrl, { headers: { 'User-Agent': 'VPS-Cockpit' } });
    if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${res.status}).`);
    const total = Number(res.headers.get('content-length')) || pending.size || 0;
    const hash = crypto.createHash('sha256'); let done = 0; let last = 0;
    const counter = async function* (src) {
      for await (const chunk of src) {
        hash.update(chunk); done += chunk.length;
        if (Date.now() - last > 200) { last = Date.now(); e.sender.send('update:progress', { done, total }); }
        yield chunk;
      }
    };
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part));
    // 2. vérification
    if (hash.digest('hex') !== pending.sha) throw new Error("Le fichier téléchargé ne correspond pas à son empreinte : il a été supprimé, rien n'a été installé.");
    e.sender.send('update:progress', { done: total || done, total: total || done });
    // 3. le nouvel exe prend son nom définitif (un fichier du même nom déjà présent, jamais en cours d'utilisation, est remplacé)
    try { fs.unlinkSync(finalPath); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    fs.renameSync(part, finalPath); part = '';
    // 4. relance : la nouvelle version supprime l'ancienne une fois celle-ci fermée
    const { spawn } = require('child_process');
    spawn(finalPath, ['--cockpit-remplace=' + old], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 400);
    return { ok: true };
  } catch (err) {
    if (part) { try { fs.unlinkSync(part); } catch { /* rien */ } }
    const code = err && err.code ? ` (${err.code})` : '';
    const perm = /EACCES|EPERM|EROFS|EBUSY/.test(String(err && err.code));
    const msg = perm
      ? `Impossible d'écrire à côté de l'application${code}. Déplace VPS-Cockpit dans un dossier à toi (par exemple Documents), puis relance-la.`
      : `${(err && err.message) || 'Échec de la mise à jour.'}${code}`;
    return { ok: false, error: msg };
  }
});
// Après une mise à jour : on supprime l'ancien exe (et seulement lui), dès qu'il est fermé.
(function cleanupOld() {
  if (!exePath()) return;
  const arg = process.argv.find((a) => a.startsWith('--cockpit-remplace='));
  const target = arg ? U.safeOldExe(arg.slice('--cockpit-remplace='.length), exePath()) : null;
  for (const stray of [exePath() + '.part']) { try { fs.unlinkSync(stray); } catch { /* rien */ } }
  if (!target) return;
  let tries = 0;
  const t = setInterval(() => {
    try { fs.unlinkSync(target); clearInterval(t); } catch (err) { if (err.code === 'ENOENT' || ++tries > 40) clearInterval(t); }
  }, 1500);
})();

// ---------- Données sauvegardées ----------
ipcMain.handle('profile:load', () => {
  const d = loadData();
  if (!d.profile) return null;
  const { passwordEnc, passphraseEnc, ...rest } = d.profile;
  return { ...rest, hasPassword: !!passwordEnc, hasPassphrase: !!passphraseEnc };
});

ipcMain.handle('key:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choisir ta clé privée SSH',
    defaultPath: path.join(os.homedir(), '.ssh'),
    properties: ['openFile', 'showHiddenFiles'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text || '').slice(0, 2_000_000)); return true; });

ipcMain.handle('apps:load', () => loadData().apps || []);
ipcMain.handle('apps:save', (_e, apps) => {
  const clean = (Array.isArray(apps) ? apps : []).slice(0, 100).map((a) => ({
    name: String(a.name || '').slice(0, 60),
    type: ['service', 'docker', 'url', 'port'].includes(a.type) ? a.type : 'service',
    target: String(a.target || '').slice(0, 300),
    db: ['postgres', 'mysql'].includes(a.db) && R.DB_NAME_RE.test(String(a.dbName || '')) ? a.db : '',
    dbName: ['postgres', 'mysql'].includes(a.db) && R.DB_NAME_RE.test(String(a.dbName || '')) ? String(a.dbName) : '',
  })).filter((a) => a.name && a.target);
  const d = loadData(); d.apps = clean; saveData(d);
  return clean;
});

// ---------- Connexion SSH ----------
function connect(p) {
  return new Promise((resolve, reject) => {
    const stored = loadData();
    const c = new Client();
    let serverMethods = null;
    const tried = new Set();
    const order = p.authMode === 'key' ? ['none', 'publickey'] : ['none', 'password', 'keyboard-interactive'];
    const cfg = {
      host: p.host, port: Number(p.port) || 22, username: p.username,
      readyTimeout: 15000, keepaliveInterval: 20000,
      tryKeyboard: p.authMode !== 'key',
      // On essaie les méthodes dans l'ordre et on retient celles que le serveur accepte (pour le diagnostic)
      authHandler: (methodsLeft, _partial, next) => {
        if (methodsLeft) serverMethods = methodsLeft;
        const m = order.find((x) => !tried.has(x) && (methodsLeft === null || x === 'none' || methodsLeft.includes(x)));
        if (!m) return next(false);
        tried.add(m);
        return next(m);
      },
      hostHash: 'sha256',
      hostVerifier: (fp, cb) => {
        const id = `${p.host}:${Number(p.port) || 22}`;
        const known = stored.hostKeys[id];
        if (known === fp) return cb(true);
        const question = known
          ? { level: 'danger', msg: `ATTENTION : l'empreinte du serveur a CHANGÉ.\nAncienne : ${known}\nNouvelle : ${fp}\n\nCela peut être une réinstallation du VPS… ou une attaque. Continuer ?` }
          : { level: 'info', msg: `Première connexion à ${p.host}.\nEmpreinte du serveur :\n${fp}\n\nFaire confiance à ce serveur ?` };
        dialog.showMessageBox(win, {
          type: known ? 'warning' : 'question', buttons: ['Annuler', 'Faire confiance'], defaultId: 0, cancelId: 0,
          title: 'Vérification du serveur', message: question.msg,
        }).then((r) => {
          if (r.response === 1) {
            const d = loadData(); d.hostKeys[id] = fp; saveData(d); cb(true);
          } else cb(false);
        });
      },
    };
    if (p.authMode === 'key') {
      try { cfg.privateKey = fs.readFileSync(p.keyPath); }
      catch { return reject(new Error('Impossible de lire le fichier de clé : ' + p.keyPath)); }
      if (p.passphrase) cfg.passphrase = p.passphrase;
    } else {
      cfg.password = p.password;
    }
    // Serveurs qui demandent le mot de passe via « keyboard-interactive »
    c.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
      finish(prompts.map(() => p.password || ''));
    });
    c.on('ready', () => resolve(c));
    c.on('error', (e) => { e.serverMethods = serverMethods; e.authMode = p.authMode; e.triedUser = p.username; reject(e); });
    c.connect(cfg);
  });
}

function friendlyError(e) {
  const m = String(e && e.message || e);
  if (/All configured authentication methods failed/i.test(m)) {
    const sm = (e && e.serverMethods) || [];
    const list = sm.length ? sm.join(', ') : 'inconnues';
    const canPw = sm.includes('password') || sm.includes('keyboard-interactive');
    if (e.authMode !== 'key' && sm.length && !canPw) {
      return `Ce serveur n'accepte PAS les mots de passe (méthodes acceptées : ${list}).\nIl faut se connecter avec une clé SSH : choisis « Clé SSH » en haut du formulaire.`;
    }
    if (e.authMode === 'key' && sm.length && !sm.includes('publickey')) {
      return `Ce serveur n'accepte pas les clés SSH (méthodes acceptées : ${list}). Essaie avec « Mot de passe ».`;
    }
    if (e.authMode === 'key') {
      return `Clé refusée par le serveur pour l'utilisateur « ${e.triedUser} ».\nVérifie que c'est bien la clé associée à ce serveur, et que l'utilisateur est le bon (root, ubuntu, debian…).`;
    }
    return `Le serveur a refusé l'utilisateur « ${e.triedUser} » avec ce mot de passe (méthodes acceptées : ${list}).\nPistes : le bon utilisateur n'est peut-être pas « root » (essaie ubuntu, debian…), ou la connexion root par mot de passe est désactivée chez ton hébergeur.`;
  }
  if (/ENOTFOUND/.test(m)) return 'Adresse introuvable. Vérifie l\'IP ou le nom du serveur.';
  if (/ECONNREFUSED/.test(m)) return 'Connexion refusée. Le port SSH est-il bon ? Le serveur est-il allumé ?';
  if (/ETIMEDOUT|Timed out/i.test(m)) return 'Le serveur ne répond pas (délai dépassé). Pare-feu, mauvaise IP ou serveur éteint ?';
  if (/encrypted private key|passphrase/i.test(m)) return 'La clé est protégée par une phrase secrète : renseigne-la.';
  if (/Cannot parse privateKey|Unsupported key format/i.test(m)) return 'Format de clé non reconnu. Utilise la clé privée OpenSSH (pas le .pub, ni un .ppk).';
  if (/host key|verification/i.test(m)) return 'Connexion annulée : serveur non approuvé.';
  return m;
}

ipcMain.handle('ssh:connect', async (_e, p) => {
  try {
    if (conn) { conn.end(); conn = null; }
    const d = loadData();
    const old = d.profile || {};
    const full = {
      ...p,
      password: p.password || (p.reuseSecrets ? dec(old.passwordEnc) : ''),
      passphrase: p.passphrase || (p.reuseSecrets ? dec(old.passphraseEnc) : ''),
    };
    if (!full.host || !full.username) throw new Error('Renseigne au moins l\'adresse et l\'utilisateur.');
    conn = await connect(full);
    conn.on('close', () => { conn = null; session = null; if (win && !win.isDestroyed()) win.webContents.send('ssh:closed'); });
    session = { isRoot: full.username === 'root', password: full.password };
    // sudo sans mot de passe en clé ? on laisse le test se faire à la 1ère action.
    d.profile = {
      host: full.host, port: Number(full.port) || 22, username: full.username, authMode: full.authMode, keyPath: full.keyPath || '',
      passwordEnc: p.remember ? enc(full.password) : '', passphraseEnc: p.remember ? enc(full.passphrase) : '',
      remember: !!p.remember,
    };
    saveData(d);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
});

ipcMain.handle('ssh:disconnect', () => { if (conn) conn.end(); conn = null; return true; });

// ---------- Exécution ----------
function exec(def, onData) {
  return new Promise((resolve, reject) => {
    if (!conn) return reject(new Error('Non connecté'));
    const cmd = R.wrap(def.script, { sudo: def.sudo, isRoot: session.isRoot });
    const needPw = def.sudo && !session.isRoot;
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream.on('data', (b) => { const s = b.toString('utf8'); out += s; onData && onData(s); });
      stream.stderr.on('data', (b) => { const s = b.toString('utf8'); out += s; onData && onData(s); });
      stream.on('close', (code) => resolve({ code, out }));
      if (needPw) stream.write((session.password || '') + '\n');
    });
  });
}

ipcMain.handle('run', async (e, req) => {
  try {
    let def;
    if (req.kind === 'service') def = R.serviceAction(req.verb, req.name);
    else if (req.kind === 'docker') def = R.dockerAction(req.verb, req.name);
    else if (req.kind === 'fs') def = R.fsAction(req.op, req.args);
    else if (req.kind === 'dbadmin') def = R.dbAdmin(req.op, req.engine, req.name);
    else if (req.kind === 'dbuser') def = R.dbUserAdmin(req.op, req.engine, req.user, req.db, req.password);
    else def = R.ACTIONS[req.kind];
    if (!def) throw new Error('Action inconnue');
    const stream = !def.quiet;
    const r = await exec(def, stream ? (s) => e.sender.send('run:data', { id: req.id, chunk: s }) : null);
    let data = null;
    if (req.kind === 'stats') data = R.parseStats(r.out);
    else if (req.kind === 'services') data = R.parseServices(r.out);
    else if (req.kind === 'diskusage') data = R.parseDiskUsage(r.out);
    else if (req.kind === 'dblist') data = R.parseDbList(r.out);
    else if (req.kind === 'dbusers') data = R.parseDbUsers(r.out);
    if (def.sudo && !session.isRoot && /incorrect password|sorry, try again|is not in the sudoers/i.test(r.out)) {
      return { ok: false, error: 'sudo a refusé : mot de passe incorrect ou utilisateur non autorisé. Connecte-toi plutôt en root, ou avec un utilisateur sudo en mode mot de passe.' };
    }
    return { ok: true, code: r.code, out: (stream || def.keepOut) ? r.out : '', data, label: def.label };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
});

// ---------- Sauvegardes : l'archive arrive en flux depuis le serveur et s'écrit directement sur le PC ----------
const MAX_BACKUP = 2 * 1024 * 1024 * 1024; // 2 Go : au-delà on s'arrête (disque du PC protégé)
let backing = false;
let lastBackup = '';
function execToFile(def, file, onProgress) {
  return new Promise((resolve, reject) => {
    if (!conn) return reject(new Error('Non connecté'));
    const cmd = R.wrap(def.script, { sudo: def.sudo, isRoot: session.isRoot });
    const needPw = def.sudo && !session.isRoot;
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      const out = fs.createWriteStream(file);
      let bytes = 0, errText = '', code = null, tooBig = false, diskErr = null, outClosed = false, chanClosed = false, aborted = false, last = 0;
      // En cas d'arrêt volontaire (trop gros, disque plein) on n'attend pas la confirmation du serveur pour rendre la main.
      const finish = () => { if (outClosed && (chanClosed || aborted)) resolve({ code, bytes, err: errText, tooBig, diskErr }); };
      const count = new Transform({
        transform(chunk, _enc, cb) {
          bytes += chunk.length;
          if (bytes > MAX_BACKUP) { tooBig = true; return cb(new Error('trop gros')); }
          if (Date.now() - last > 250) { last = Date.now(); onProgress && onProgress(bytes); }
          cb(null, chunk);
        },
      });
      const abort = () => { aborted = true; try { stream.close(); } catch { /* déjà fermé */ } finish(); };
      count.on('error', () => { abort(); out.destroy(); });
      out.on('error', (e) => { diskErr = e; abort(); });
      out.on('close', () => { outClosed = true; finish(); });
      stream.on('exit', (c) => { code = c; });
      stream.on('close', () => { chanClosed = true; if (!out.writableEnded && !out.destroyed) count.end(); finish(); });
      stream.stderr.on('data', (b) => { if (errText.length < 2000) errText += b.toString('utf8'); });
      stream.pipe(count).pipe(out);
      if (needPw) stream.write((session.password || '') + '\n');
    });
  });
}
const pad2 = (n) => String(n).padStart(2, '0');
ipcMain.handle('backup:run', async (e, req) => {
  if (backing) return { ok: false, error: 'Une sauvegarde est déjà en cours.' };
  let part = '';
  try {
    if (!conn) throw new Error('Non connecté');
    const def = R.backupAction(req.kind, req);
    const d = new Date();
    const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}`;
    const pick = await dialog.showSaveDialog(win, {
      title: 'Où enregistrer la sauvegarde ?',
      defaultPath: path.join(app.getPath('documents'), def.fileName(stamp)),
      filters: [{ name: 'Archive compressée', extensions: ['gz'] }],
    });
    if (pick.canceled || !pick.filePath) return { ok: true, canceled: true };
    backing = true;
    const file = pick.filePath;
    part = file + '.part';
    const res = await execToFile(def, part, (b) => e.sender.send('backup:progress', { bytes: b }));
    if (res.diskErr) throw new Error(`Impossible d'écrire sur ton PC (${res.diskErr.code || 'erreur'}). Choisis un autre emplacement.`);
    if (res.tooBig) throw new Error('La sauvegarde dépasse 2 Go : elle a été arrêtée. Sauvegarde un dossier plus petit.');
    if (def.sudo && !session.isRoot && /incorrect password|sorry, try again|is not in the sudoers/i.test(res.err)) {
      throw new Error('sudo a refusé : mot de passe incorrect ou utilisateur non autorisé. Connecte-toi plutôt en root, ou avec un utilisateur sudo en mode mot de passe.');
    }
    if (res.code !== 0 || res.bytes === 0) {
      const msg = res.err.replace(/\[sudo\][^\n]*\n?/g, '').trim().slice(0, 300);
      throw new Error(msg || `La sauvegarde a échoué (code ${res.code === null ? 'inconnu' : res.code}).`);
    }
    fs.renameSync(part, file); part = '';
    lastBackup = file;
    return { ok: true, file, size: res.bytes, label: def.label };
  } catch (err) {
    if (part) { try { fs.unlinkSync(part); } catch { /* rien */ } }
    return { ok: false, error: friendlyError(err) };
  } finally { backing = false; }
});
ipcMain.handle('backup:show', () => { if (lastBackup && fs.existsSync(lastBackup)) { shell.showItemInFolder(lastBackup); return true; } return false; });

// ---------- Alertes Windows ----------
const alertsOn = () => loadData().alerts !== false;
ipcMain.handle('alerts:get', () => ({ on: alertsOn(), supported: Notification.isSupported() }));
ipcMain.handle('alerts:set', (_e, on) => { const d = loadData(); d.alerts = !!on; saveData(d); return { on: alertsOn() }; });
ipcMain.handle('alerts:notify', (_e, n) => {
  if (!alertsOn() || !Notification.isSupported()) return false;
  const title = String((n && n.title) || '').slice(0, 100), body = String((n && n.body) || '').slice(0, 250);
  if (!title) return false;
  const note = new Notification({ title, body, silent: false });
  note.on('click', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  note.show();
  return true;
});

// ---------- Vérification d'adresses web (depuis ton PC) ----------
ipcMain.handle('check:url', async (_e, url) => {
  const t0 = Date.now();
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const res = await net.fetch(u.toString(), { method: 'GET', signal: ctrl.signal, redirect: 'follow' });
    const ms = Date.now() - t0;
    let body = '';
    try { body = (await res.text()).slice(0, 4000); } catch { /* corps illisible : on garde le code */ }
    clearTimeout(to);
    return { ok: res.status < 500, status: res.status, ms, body };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, body: '', error: e.name === 'AbortError' ? 'délai dépassé' : 'injoignable' };
  }
});

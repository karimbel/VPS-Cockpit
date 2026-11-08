'use strict';
// Mise à jour : logique pure (testable sans Electron). Aucun numéro de version :
// une mise à jour existe quand l'exe publié est différent du tien ET plus récent que le tien.
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const EXE_RE = /^VPS-Cockpit-v(\d+\.\d+\.\d+)\.exe$/;

const validRepo = (r) => REPO_RE.test(String(r || '')) && !String(r).split('/').some((p) => /^\.+$/.test(p)) && !String(r).startsWith('.');

// Analyse la réponse « latest release » de GitHub. L'exe s'appelle VPS-Cockpit-vX.Y.Z.exe et son empreinte SHA-256
// est donnée par GitHub lui-même (champ « digest » de l'asset) : aucun fichier .sha256 à publier.
// Retourne null (rien d'exploitable), { incomplete:true } ou { exeUrl, sha, size, publishedAt }.
function pickRelease(repo, rel) {
  if (!rel || typeof rel !== 'object' || rel.draft || rel.prerelease) return null;
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const exe = assets.find((a) => a && EXE_RE.test(String(a.name)));
  const version = exe ? EXE_RE.exec(String(exe.name))[1] : '';
  const okUrl = (a) => a && typeof a.browser_download_url === 'string'
    && a.browser_download_url.startsWith(`https://github.com/${repo}/releases/download/`);
  const m = exe && /^sha256:([A-Fa-f0-9]{64})$/.exec(String(exe.digest || ''));
  if (!okUrl(exe) || !m) return { incomplete: true };
  const publishedAt = Date.parse(rel.published_at || rel.created_at || '') || 0;
  return { version, exeName: exe.name, exeUrl: exe.browser_download_url, sha: m[1].toLowerCase(), size: Number(exe.size) || 0, publishedAt };
}

// Extrait l'empreinte SHA-256 d'un fichier « .sha256 » (format « hex  nom » ou « hex » seul).
function parseSha(text) {
  const m = /^\s*([A-Fa-f0-9]{64})\b/.exec(String(text || ''));
  return m ? m[1].toLowerCase() : null;
}

// Mise à jour disponible ? Le fichier publié doit différer du mien ET avoir été publié après la date de mon exe
// (ça évite de « revenir en arrière » vers une vieille version publiée).
const isNewer = ({ localSha, remoteSha, publishedAt, localMtime }) => !!remoteSha && remoteSha !== localSha && publishedAt > localMtime;

// L'ancien exe à supprimer après une mise à jour : même dossier que le nouveau, nom VPS-Cockpit*.exe, et différent du nouveau.
const path = require('path');
function safeOldExe(oldPath, ownPath) {
  if (!oldPath || !ownPath) return null;
  const a = path.win32.parse(String(oldPath)), b = path.win32.parse(String(ownPath));
  if (!/^VPS-Cockpit[A-Za-z0-9._ -]*\.exe$/i.test(a.base)) return null;
  if (a.dir.toLowerCase() !== b.dir.toLowerCase() || a.base.toLowerCase() === b.base.toLowerCase()) return null;
  return String(oldPath);
}

module.exports = { safeOldExe, validRepo, pickRelease, parseSha, isNewer, EXE_RE };

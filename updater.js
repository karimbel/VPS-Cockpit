'use strict';
// Mise à jour : logique pure (testable sans Electron). Aucun numéro de version :
// une mise à jour existe quand l'exe publié est différent du tien ET plus récent que le tien.
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const EXE_NAME = 'VPS-Cockpit.exe';

const validRepo = (r) => REPO_RE.test(String(r || '')) && !String(r).split('/').some((p) => /^\.+$/.test(p)) && !String(r).startsWith('.');

// Analyse la réponse « latest release » de GitHub.
// Retourne null (rien d'exploitable), { incomplete:true } ou { exeUrl, shaUrl, size, publishedAt }.
function pickRelease(repo, rel) {
  if (!rel || typeof rel !== 'object' || rel.draft || rel.prerelease) return null;
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const exe = assets.find((a) => a && a.name === EXE_NAME);
  const sha = assets.find((a) => a && a.name === EXE_NAME + '.sha256');
  const okUrl = (a) => a && typeof a.browser_download_url === 'string'
    && a.browser_download_url.startsWith(`https://github.com/${repo}/releases/download/`);
  if (!okUrl(exe) || !okUrl(sha)) return { incomplete: true };
  const publishedAt = Date.parse(rel.published_at || rel.created_at || '') || 0;
  return { exeUrl: exe.browser_download_url, shaUrl: sha.browser_download_url, size: Number(exe.size) || 0, publishedAt };
}

// Extrait l'empreinte SHA-256 d'un fichier « .sha256 » (format « hex  nom » ou « hex » seul).
function parseSha(text) {
  const m = /^\s*([A-Fa-f0-9]{64})\b/.exec(String(text || ''));
  return m ? m[1].toLowerCase() : null;
}

// Mise à jour disponible ? Le fichier publié doit différer du mien ET avoir été publié après la date de mon exe
// (ça évite de « revenir en arrière » vers une vieille version publiée).
const isNewer = ({ localSha, remoteSha, publishedAt, localMtime }) => !!remoteSha && remoteSha !== localSha && publishedAt > localMtime;

module.exports = { validRepo, pickRelease, parseSha, isNewer, EXE_NAME };

'use strict';
// Commandes exécutées sur le VPS. Le rendu (interface) ne peut JAMAIS envoyer
// de commande libre : il ne peut demander que les actions listées ici.

const SERVICE_RE = /^[A-Za-z0-9@._:-]{1,100}$/;

const STATS_SCRIPT = String.raw`
export LC_ALL=C
echo "os=$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")"
echo "host=$(hostname)"
echo "uptime=$(uptime -p 2>/dev/null)"
echo "cores=$(nproc 2>/dev/null)"
echo "load=$(cut -d' ' -f1-3 /proc/loadavg)"
df -P -B1 / | awk 'NR==2{print "disk_total="$2"\ndisk_used="$3}'
free -b | awk '/^Mem:/{print "mem_total="$2"\nmem_used="$3"\nmem_avail="$7}'
free -b | awk '/^Swap:/{print "swap_total="$2"\nswap_used="$3}'
if [ -f /var/run/reboot-required ]; then echo "reboot_required=1"; else echo "reboot_required=0"; fi
if command -v apt-get >/dev/null 2>&1; then
  echo "updates=$(apt-get -s upgrade 2>/dev/null | grep -c '^Inst')"
else
  echo "updates=-1"
fi
echo "failed=$(systemctl --failed --no-legend --plain 2>/dev/null | wc -l)"
`;

const SERVICES_SCRIPT = String.raw`
export LC_ALL=C
echo "[services]"
systemctl list-units --type=service --state=running --no-legend --no-pager --plain 2>/dev/null | awk '{print $1}'
echo "[failed]"
systemctl --failed --no-legend --no-pager --plain 2>/dev/null | awk '{print $1}'
echo "[docker]"
if command -v docker >/dev/null 2>&1; then
  docker ps -a --format '{{.Names}}|{{.Status}}|{{.Image}}' 2>/dev/null
fi
echo "[ports]"
ss -ltnH 2>/dev/null | awk '{n=split($4,a,":"); print a[n]}' | sort -un
`;

const NONINT = 'export DEBIAN_FRONTEND=noninteractive; export LC_ALL=C;';


const DBLIST_SCRIPT = `cd /tmp
if command -v psql >/dev/null 2>&1; then
  o=$(runuser -u postgres -- psql -d postgres -tAc "select datname from pg_database where not datistemplate order by 1" 2>&1); c=$?
  if [ $c -eq 0 ]; then echo "[postgres:up]"; echo "$o"; else echo "[postgres:down]"; fi
else echo "[postgres:none]"; fi
M=$(command -v mysql || command -v mariadb)
if [ -n "$M" ]; then
  o=$("$M" -N -B -e "show databases" 2>&1); c=$?
  if [ $c -eq 0 ]; then echo "[mysql:up]"; echo "$o" | grep -Eiv '^(information_schema|performance_schema|mysql|sys)$'; else echo "[mysql:down]"; fi
else echo "[mysql:none]"; fi
`;

const DBUSERS_SCRIPT = `cd /tmp
if command -v psql >/dev/null 2>&1; then
  o=$(runuser -u postgres -- psql -d postgres -tAc "select rolname from pg_roles where rolcanlogin and rolname !~ '^pg_' and rolname <> 'postgres' order by 1" 2>&1); c=$?
  if [ $c -eq 0 ]; then echo "[postgres:up]"; echo "$o"; else echo "[postgres:down]"; fi
else echo "[postgres:none]"; fi
M=$(command -v mysql || command -v mariadb)
if [ -n "$M" ]; then
  o=$("$M" -N -B -e "select distinct user from mysql.user where host='localhost' and user not in ('','root','mysql','mariadb.sys','mysql.sys','mysql.session','mysql.infoschema','debian-sys-maint') order by 1" 2>&1); c=$?
  if [ $c -eq 0 ]; then echo "[mysql:up]"; echo "$o"; else echo "[mysql:down]"; fi
else echo "[mysql:none]"; fi
`;

const ACTIONS = {
  stats: { script: STATS_SCRIPT, quiet: true },
  services: { script: SERVICES_SCRIPT, quiet: true },
  logs: {
    script: `journalctl -p err -n 80 --no-pager 2>&1 || echo "journalctl indisponible"`,
    sudo: true,
  },
  // Rapport en LECTURE SEULE, sans mot de passe ni clé : l'utilisateur peut le relire avant de le partager.
  diagnostic: {
    quiet: true,
    keepOut: true,
    script: String.raw`
export LC_ALL=C
echo "== Système"; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"); uname -r
echo "== Utilisateur de connexion"; whoami; (sudo -n true 2>/dev/null && echo "sudo sans mot de passe: oui" || echo "sudo sans mot de passe: non")
echo "== Connexion SSH (réglages)"; grep -hiE "^(PermitRootLogin|PasswordAuthentication|KbdInteractiveAuthentication|PubkeyAuthentication|Port) " /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null
echo "== Disque"; df -h / | tail -1
echo "== Mémoire"; free -h | head -2
echo "== Processeur"; nproc; cut -d' ' -f1-3 /proc/loadavg
echo "== Services actifs"; systemctl list-units --type=service --state=running --no-legend --no-pager --plain 2>/dev/null | awk '{print $1}'
echo "== Services en échec"; systemctl --failed --no-legend --no-pager --plain 2>/dev/null | awk '{print $1}'
echo "== Docker (nom | état | image)"; if command -v docker >/dev/null 2>&1; then docker ps -a --format '{{.Names}} | {{.Status}} | {{.Image}}' 2>&1 | head -30; else echo "docker non installé"; fi
echo "== Ports en écoute"; ss -ltnH 2>/dev/null | awk '{print $4}' | sort -u
echo "== Mises à jour disponibles"; if command -v apt-get >/dev/null 2>&1; then apt-get -s upgrade 2>/dev/null | grep -c '^Inst'; else echo "apt non disponible"; fi
echo "== Redémarrage requis"; [ -f /var/run/reboot-required ] && echo oui || echo non`,
  },
  dblist: { script: DBLIST_SCRIPT, sudo: true, quiet: true },
  dbusers: { script: DBUSERS_SCRIPT, sudo: true, quiet: true },
  diskusage: {
    sudo: true,
    quiet: true,
    script: String.raw`
for d in /var/log /var/lib/docker /var/cache /var/www /home /root /opt /srv /tmp /var/lib/mysql /var/lib/postgresql /var/backups /snap; do
  if [ -d "$d" ]; then echo "$d|$(timeout 15 du -xsb "$d" 2>/dev/null | cut -f1)"; fi
done`,
  },
  update: {
    label: 'Mettre à jour le système',
    sudo: true,
    script: `${NONINT} apt-get update 2>&1 && apt-get -y -o Dpkg::Options::=--force-confold upgrade 2>&1`,
  },
  clean: {
    label: 'Nettoyer le disque',
    sudo: true,
    script: `${NONINT}
echo "== Espace avant =="; df -h / | tail -1
echo "== Paquets inutiles =="; apt-get -y autoremove 2>&1 | tail -3; apt-get clean 2>&1
echo "== Anciens journaux (> 7 jours) =="; journalctl --vacuum-time=7d 2>&1 | tail -2
if command -v docker >/dev/null 2>&1; then echo "== Images Docker orphelines =="; docker image prune -f 2>&1 | tail -2; fi
echo "== Espace après =="; df -h / | tail -1`,
  },
  reboot: {
    label: 'Redémarrer le serveur',
    sudo: true,
    script: `echo "Redémarrage dans 3 secondes..."; (sleep 3; systemctl reboot) >/dev/null 2>&1 &`,
  },
};

function serviceAction(kind, name) {
  if (!SERVICE_RE.test(name)) throw new Error('Nom de service invalide');
  const verbs = { restart: 'Redémarrer', stop: 'Arrêter', start: 'Démarrer' };
  if (!verbs[kind]) throw new Error('Action inconnue');
  return {
    label: `${verbs[kind]} ${name}`,
    sudo: true,
    script: `systemctl ${kind} '${name}' 2>&1 && echo "OK : ${kind} ${name}" && systemctl is-active '${name}' 2>&1 || true`,
  };
}

function dockerAction(kind, name) {
  if (!SERVICE_RE.test(name)) throw new Error('Nom de conteneur invalide');
  if (!['restart', 'stop', 'start'].includes(kind)) throw new Error('Action inconnue');
  return {
    label: `Docker ${kind} ${name}`,
    sudo: true,
    script: `docker ${kind} '${name}' 2>&1`,
  };
}

// Enveloppe le script : bash, et sudo si l'utilisateur n'est pas root.
function wrap(script, { sudo, isRoot }) {
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  const run = `echo ${b64} | base64 -d | bash`;
  if (!sudo || isRoot) return `bash -c '${run}'`;
  // -S : lit le mot de passe sur stdin ; -p '' : pas d'invite parasite
  return `sudo -S -p '' bash -c '${run}'`;
}

function parseStats(text) {
  const kv = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const n = (k) => Number(kv[k] || 0);
  return {
    os: kv.os || '', host: kv.host || '', uptime: kv.uptime || '',
    cores: n('cores'), load: kv.load || '',
    diskTotal: n('disk_total'), diskUsed: n('disk_used'),
    memTotal: n('mem_total'), memUsed: n('mem_used'), memAvail: n('mem_avail'),
    swapTotal: n('swap_total'), swapUsed: n('swap_used'),
    rebootRequired: kv.reboot_required === '1',
    updates: n('updates'), failed: n('failed'),
  };
}

function parseServices(text) {
  const out = { services: [], failed: [], docker: [], ports: [] };
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line === '[services]') { cur = 'services'; continue; }
    if (line === '[failed]') { cur = 'failed'; continue; }
    if (line === '[docker]') { cur = 'docker'; continue; }
    if (line === '[ports]') { cur = 'ports'; continue; }
    if (cur === 'ports') {
      const p = Number(line);
      if (p > 0) out.ports.push(p);
    } else if (cur === 'docker') {
      const [name, status, image] = line.split('|');
      if (name) out.docker.push({ name, status: status || '', image: image || '' });
    } else if (cur) {
      out[cur].push(line.replace(/\.service$/, ''));
    }
  }
  return out;
}


// Bases de données détectées : { postgres:{state:'up'|'down'|'none', dbs:[]}, mysql:{...} }
function parseDbList(text) {
  const out = { postgres: { state: 'none', dbs: [] }, mysql: { state: 'none', dbs: [] } };
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const m = /^\[(postgres|mysql):(up|down|none)\]$/.exec(line);
    if (m) { cur = out[m[1]]; cur.state = m[2]; continue; }
    if (cur && /^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$/.test(line)) cur.dbs.push(line);
  }
  return out;
}
const DB_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$/;

// Utilisateurs de bases : même forme que parseDbList, avec la liste des noms de comptes.
function parseDbUsers(text) {
  const out = { postgres: { state: 'none', users: [] }, mysql: { state: 'none', users: [] } };
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const m = /^\[(postgres|mysql):(up|down|none)\]$/.exec(line);
    if (m) { cur = out[m[1]]; cur.state = m[2]; continue; }
    if (cur && /^[A-Za-z0-9_.-]{1,64}$/.test(line)) cur.users.push(line);
  }
  return out;
}


// ---------- Fichiers et bases de données (écriture) ----------
// Toutes les valeurs sont validées ici AVANT d'être mises dans un script, et le script revérifie
// le chemin réel (realpath) : on ne peut agir que dans les dossiers autorisés.
const PATH_RE = /^\/[A-Za-z0-9._\/@:+~ -]{0,300}$/;
const WRITE_ROOTS = [['/home', 2], ['/root', 1], ['/var/www', 1], ['/srv', 1], ['/opt', 1], ['/tmp', 1]];
const DB_NAME_STRICT = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
const DB_PROTECTED = ['postgres', 'template0', 'template1', 'mysql', 'information_schema', 'performance_schema', 'sys'];
const MAX_FILE = 40000;
const PROTECTED_MSG = 'Dossier protégé : je ne modifie que /home (dans un dossier utilisateur), /root, /var/www, /srv, /opt et /tmp.';

function cleanPath(p) {
  let s = String(p || '').trim();
  if (s.length > 1) s = s.replace(/\/+$/, '');
  if (!PATH_RE.test(s) || s.split('/').includes('..') || s.includes('//')) throw new Error('Chemin invalide : il doit commencer par / et ne contenir que des lettres, chiffres et . _ - @ : + ~ espace.');
  return s;
}
function writablePath(p) {
  const ok = WRITE_ROOTS.some(([r, d]) => p.startsWith(r + '/') && p.slice(r.length + 1).split('/').length >= d);
  if (!ok) throw new Error(PROTECTED_MSG);
  return p;
}
const quote = (s) => "'" + s + "'"; // s est validé : jamais d'apostrophe dedans
const toB64 = (s) => Buffer.from(s, 'utf8').toString('base64');
// Contrôle shell du chemin réel (suit les liens symboliques) ; utilise $P, définit $R.
const GUARD = String.raw`R=$(realpath -m -- "$P") || exit 1
case "$R" in
  /home/*/*|/root/*|/var/www/*|/srv/*|/opt/*|/tmp/*) ;;
  *) echo "ERR=${PROTECTED_MSG}"; exit 0;;
esac
`;

function fsAction(op, a = {}) {
  const base = { sudo: true, quiet: true, keepOut: true };
  if (op === 'list') {
    const p = cleanPath(a.path);
    return { ...base, label: 'Lister un dossier', script: String.raw`export LC_ALL=C
P=${quote(p)}
if [ ! -d "$P" ]; then echo "ERR=Ce dossier n'existe pas."; exit 0; fi
echo "PATH=$(realpath -- "$P")"
find "$P" -mindepth 1 -maxdepth 1 -printf '%y|%s|%TY-%Tm-%Td %TH:%TM|%f\n' 2>/dev/null | sort -t'|' -k1,1 -k4,4 | head -500
` };
  }
  if (op === 'read') {
    const p = writablePath(cleanPath(a.path));
    return { ...base, label: 'Lire un fichier', script: String.raw`export LC_ALL=C
P=${quote(p)}
${GUARD}[ -f "$R" ] || { echo "ERR=Ce n'est pas un fichier."; exit 0; }
S=$(stat -c %s -- "$R"); [ "$S" -le ${MAX_FILE} ] || { echo "ERR=Fichier trop gros pour être modifié ici (maximum 40 Ko)."; exit 0; }
tr -d '\000' < "$R" | cmp -s - "$R" || { echo "ERR=Ce fichier n'est pas du texte."; exit 0; }
echo "[contenu]"
cat -- "$R"
` };
  }
  if (op === 'write') {
    const p = writablePath(cleanPath(a.path));
    const content = String(a.content == null ? '' : a.content);
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE) throw new Error('Fichier trop gros : 40 Ko maximum.');
    return { ...base, label: 'Enregistrer un fichier', script: String.raw`export LC_ALL=C
P=${quote(p)}
${GUARD}D=$(dirname -- "$R")
[ -d "$D" ] || { echo "ERR=Le dossier parent n'existe pas."; exit 0; }
[ -d "$R" ] && { echo "ERR=C'est un dossier, pas un fichier."; exit 0; }
if [ ${a.create ? 1 : 0} = 1 ] && [ -e "$R" ]; then echo "ERR=Ce fichier existe déjà."; exit 0; fi
NEW=0; [ -e "$R" ] || NEW=1
o=$(echo ${toB64(content)} | base64 -d > "$R" 2>&1) || { echo "ERR=$o"; exit 0; }
[ "$NEW" = 1 ] && chown --reference="$D" -- "$R" 2>/dev/null
echo "OK=Fichier enregistré."
` };
  }
  if (op === 'mkdir') {
    const p = writablePath(cleanPath(a.path));
    return { ...base, label: 'Créer un dossier', script: String.raw`export LC_ALL=C
P=${quote(p)}
${GUARD}D=$(dirname -- "$R")
[ -d "$D" ] || { echo "ERR=Le dossier parent n'existe pas."; exit 0; }
[ -e "$R" ] && { echo "ERR=Ce nom existe déjà."; exit 0; }
o=$(mkdir -- "$R" 2>&1) || { echo "ERR=$o"; exit 0; }
chown --reference="$D" -- "$R" 2>/dev/null
echo "OK=Dossier créé."
` };
  }
  if (op === 'rename') {
    const from = writablePath(cleanPath(a.from)), to = writablePath(cleanPath(a.to));
    return { ...base, label: 'Renommer', script: String.raw`export LC_ALL=C
P=${quote(from)}
${GUARD}A="$R"
P=${quote(to)}
${GUARD}B="$R"
[ -e "$A" ] || { echo "ERR=L'élément à renommer n'existe pas."; exit 0; }
[ -e "$B" ] && { echo "ERR=Ce nom existe déjà."; exit 0; }
[ -d "$(dirname -- "$B")" ] || { echo "ERR=Le dossier de destination n'existe pas."; exit 0; }
o=$(mv -n -- "$A" "$B" 2>&1) || { echo "ERR=$o"; exit 0; }
echo "OK=Renommé."
` };
  }
  if (op === 'delete') {
    const p = writablePath(cleanPath(a.path));
    return { ...base, label: 'Supprimer', script: String.raw`export LC_ALL=C
P=${quote(p)}
${GUARD}[ -e "$R" ] || [ -L "$R" ] || { echo "ERR=Cet élément n'existe déjà plus."; exit 0; }
if mountpoint -q -- "$R" 2>/dev/null; then echo "ERR=C'est un disque monté : je ne le supprime pas."; exit 0; fi
o=$(rm -rf --one-file-system -- "$R" 2>&1) || { echo "ERR=$o"; exit 0; }
echo "OK=Supprimé."
` };
  }
  throw new Error('Action inconnue');
}

function dbAdmin(op, engine, name) {
  if (!['create', 'drop'].includes(op)) throw new Error('Action inconnue');
  if (!['postgres', 'mysql'].includes(engine)) throw new Error('Type de base inconnu');
  const n = String(name || '');
  if (!DB_NAME_STRICT.test(n)) throw new Error('Nom de base invalide : il commence par une lettre, puis lettres, chiffres et _ (63 caractères maximum).');
  if (DB_PROTECTED.includes(n.toLowerCase())) throw new Error('Cette base est protégée : le serveur en a besoin.');
  const verb = op === 'create' ? 'CREATE DATABASE' : 'DROP DATABASE';
  const done = op === 'create' ? 'Base créée.' : 'Base supprimée.';
  const label = (op === 'create' ? 'Créer la base ' : 'Supprimer la base ') + n;
  if (engine === 'postgres') {
    return { label, sudo: true, quiet: true, keepOut: true, script: String.raw`cd /tmp
command -v psql >/dev/null 2>&1 || { echo "ERR=PostgreSQL n'est pas installé sur ce serveur."; exit 0; }
o=$(runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c '${verb} "${n}"' 2>&1) && echo "OK=${done}" || echo "ERR=$(echo "$o" | tr '\n' ' ')"
` };
  }
  const extra = op === 'create' ? ' CHARACTER SET utf8mb4' : '';
  return { label, sudo: true, quiet: true, keepOut: true, script: String.raw`cd /tmp
M=$(command -v mysql || command -v mariadb)
[ -n "$M" ] || { echo "ERR=MySQL / MariaDB n'est pas installé sur ce serveur."; exit 0; }
o=$("$M" -e 'SET SESSION sql_mode=CONCAT(@@sql_mode,",ANSI_QUOTES"); ${verb} "${n}"${extra}' 2>&1) && echo "OK=${done}" || echo "ERR=$(echo "$o" | tr '\n' ' ')"
` };
}

// ---------- Sauvegardes (lecture seule : le serveur envoie l'archive, l'application l'enregistre sur le PC) ----------
const BACKUP_ROOTS = [['/home', 1], ['/root', 0], ['/var/www', 0], ['/srv', 0], ['/opt', 0], ['/tmp', 1]];
const BACKUP_MSG = 'Je ne sauvegarde que les dossiers de travail : /home, /root, /var/www, /srv, /opt et /tmp.';
function backupPathOk(p) {
  return BACKUP_ROOTS.some(([r, d]) => (p === r ? d === 0 : p.startsWith(r + '/') && p.slice(r.length + 1).split('/').length >= Math.max(d, 1)));
}
// Même contrôle côté serveur, sur le chemin réel (liens symboliques suivis). Les erreurs vont sur stderr : stdout est l'archive.
const GUARD_BIN = String.raw`R=$(realpath -m -- "$P") || exit 3
case "$R" in
  /home/*|/root|/root/*|/var/www|/var/www/*|/srv|/srv/*|/opt|/opt/*|/tmp/*) ;;
  *) echo "${BACKUP_MSG}" >&2; exit 3;;
esac
`;
const safeFile = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'sauvegarde';

function backupAction(kind, a = {}) {
  if (kind === 'db') {
    const engine = a.engine, n = String(a.name || '');
    if (!['postgres', 'mysql'].includes(engine)) throw new Error('Type de base inconnu');
    if (!DB_NAME_RE.test(n)) throw new Error('Nom de base invalide.');
    const fileName = (stamp) => `${safeFile(n)}_${engine === 'postgres' ? 'postgresql' : 'mysql'}_${stamp}.sql.gz`;
    const label = `Sauvegarde de la base « ${n} »`;
    if (engine === 'postgres') {
      return { label, fileName, sudo: true, script: String.raw`cd /tmp
set -o pipefail
command -v pg_dump >/dev/null 2>&1 || { echo "PostgreSQL n'est pas installé sur ce serveur." >&2; exit 3; }
runuser -u postgres -- pg_dump --dbname='${n}' </dev/null | gzip -c
` };
    }
    return { label, fileName, sudo: true, script: String.raw`cd /tmp
set -o pipefail
D=$(command -v mysqldump || command -v mariadb-dump)
[ -n "$D" ] || { echo "MySQL / MariaDB n'est pas installé sur ce serveur." >&2; exit 3; }
"$D" --single-transaction --routines --triggers --default-character-set=utf8mb4 '${n}' </dev/null | gzip -c
` };
  }
  if (kind === 'dir') {
    const p = cleanPath(a.path);
    if (!backupPathOk(p)) throw new Error(BACKUP_MSG);
    const base = p.split('/').filter(Boolean).pop() || 'dossier';
    const fileName = (stamp) => `${safeFile(base)}_${stamp}.tar.gz`;
    return { label: `Sauvegarde du dossier ${p}`, fileName, sudo: true, script: String.raw`export LC_ALL=C
P=${quote(p)}
${GUARD_BIN}[ -d "$R" ] || { echo "Ce dossier n'existe pas." >&2; exit 3; }
tar -czf - -C "$(dirname -- "$R")" -- "$(basename -- "$R")" </dev/null
c=$?; [ $c -le 1 ] || exit $c
` };
  }
  throw new Error('Action inconnue');
}

// ---------- Utilisateurs de bases de données ----------
const DB_USER_RE = /^[a-z][a-z0-9_]{0,30}$/;
const DB_PASS_RE = /^[A-Za-z0-9]{16,64}$/;
const DB_USER_PROTECTED = ['postgres', 'root', 'mysql', 'mariadb', 'admin', 'public', 'debian'];
const BT = String.fromCharCode(96);

function dbUserAdmin(op, engine, user, db, password) {
  if (!['create', 'drop'].includes(op)) throw new Error('Action inconnue');
  if (!['postgres', 'mysql'].includes(engine)) throw new Error('Type de base inconnu');
  const u = String(user || '');
  if (!DB_USER_RE.test(u)) throw new Error("Nom d'utilisateur invalide : minuscules, chiffres et _ , il commence par une lettre (31 caractères maximum).");
  if (DB_USER_PROTECTED.includes(u) || /^pg_/.test(u)) throw new Error('Ce nom est réservé par le serveur.');
  const done = op === 'create' ? 'Utilisateur créé.' : 'Utilisateur supprimé.';
  const label = (op === 'create' ? 'Créer l\'utilisateur ' : 'Supprimer l\'utilisateur ') + u;
  const base = { label, sudo: true, quiet: true, keepOut: true };
  let d = '', pw = '';
  if (op === 'create') {
    d = String(db || ''); pw = String(password || '');
    if (!DB_NAME_RE.test(d)) throw new Error('Nom de base invalide.');
    if (!DB_PASS_RE.test(pw)) throw new Error('Mot de passe invalide : 16 à 64 lettres et chiffres.');
  }
  if (engine === 'postgres') {
    const head = String.raw`cd /tmp
command -v psql >/dev/null 2>&1 || { echo "ERR=PostgreSQL n'est pas installé sur ce serveur."; exit 0; }
PG() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 -q "$@" 2>&1; }
`;
    if (op === 'create') {
      const sql1 = `CREATE ROLE "${u}" LOGIN PASSWORD '${pw}';\nGRANT ALL PRIVILEGES ON DATABASE "${d}" TO "${u}";`;
      const sql2 = `GRANT ALL ON SCHEMA public TO "${u}";\nGRANT ALL ON ALL TABLES IN SCHEMA public TO "${u}";\nGRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "${u}";`;
      return { ...base, script: head + String.raw`o=$(PG -1 -d postgres -f - <<'SQL'
${sql1}
SQL
) || { echo "ERR=$(echo "$o" | tr '\n' ' ')"; exit 0; }
o=$(PG -d "${d}" -f - <<'SQL'
${sql2}
SQL
) || { PG -d postgres -c 'REVOKE ALL ON DATABASE "${d}" FROM "${u}"' -c 'DROP ROLE "${u}"' >/dev/null; echo "ERR=$(echo "$o" | tr '\n' ' ')"; exit 0; }
echo "OK=${done}"
` };
    }
    return { ...base, script: head + String.raw`[ "$(PG -d postgres -tAc "select 1 from pg_roles where rolname='${u}'")" = 1 ] || { echo "ERR=Cet utilisateur n'existe pas (ou plus)."; exit 0; }
for d in $(PG -d postgres -tAc "select datname from pg_database where datallowconn and datname ~ '^[A-Za-z0-9_-]+$'" </dev/null); do
  PG -v ON_ERROR_STOP=0 -d "$d" -c 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${u}"' -c 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "${u}"' -c 'REVOKE ALL ON SCHEMA public FROM "${u}"' -c "REVOKE ALL ON DATABASE \"$d\" FROM \"${u}\"" </dev/null >/dev/null
done
o=$(PG -d postgres -c 'DROP ROLE "${u}"') && echo "OK=${done}" || echo "ERR=$(echo "$o" | tr '\n' ' ')"
` };
  }
  const head = String.raw`cd /tmp
M=$(command -v mysql || command -v mariadb)
[ -n "$M" ] || { echo "ERR=MySQL / MariaDB n'est pas installé sur ce serveur."; exit 0; }
`;
  if (op === 'create') {
    const dbEsc = d.replace(/_/g, '\\_'); // « _ » est un joker dans les droits MySQL : on l'écrit littéralement
    const sql = `CREATE USER '${u}'@'localhost' IDENTIFIED BY '${pw}';\nGRANT ALL PRIVILEGES ON ${BT}${dbEsc}${BT}.* TO '${u}'@'localhost';\nFLUSH PRIVILEGES;`;
    return { ...base, script: head + String.raw`[ "$("$M" -N -B -e "select count(*) from information_schema.schemata where schema_name='${d}'" 2>/dev/null)" = 1 ] || { echo "ERR=Cette base n'existe pas."; exit 0; }
[ "$("$M" -N -B -e "select count(*) from mysql.user where user='${u}' and host='localhost'" 2>/dev/null)" = 0 ] || { echo "ERR=Cet utilisateur existe déjà."; exit 0; }
o=$("$M" 2>&1 <<'SQL'
${sql}
SQL
) && echo "OK=${done}" || { "$M" -e "DROP USER IF EXISTS '${u}'@'localhost'" >/dev/null 2>&1; echo "ERR=$(echo "$o" | tr '\n' ' ')"; }
` };
  }
  return { ...base, script: head + String.raw`[ "$("$M" -N -B -e "select count(*) from mysql.user where user='${u}' and host='localhost'" 2>/dev/null)" != 0 ] || { echo "ERR=Cet utilisateur n'existe pas (ou plus)."; exit 0; }
o=$("$M" -e "DROP USER '${u}'@'localhost'" 2>&1) && echo "OK=${done}" || echo "ERR=$(echo "$o" | tr '\n' ' ')"
` };
}

function parseDiskUsage(text) {
  return text.split('\n')
    .map((l) => l.trim().split('|'))
    .filter((p) => p.length === 2 && p[0].startsWith('/') && /^\d+$/.test(p[1]))
    .map(([path, bytes]) => ({ path, bytes: Number(bytes) }))
    .sort((a, b) => b.bytes - a.bytes);
}

module.exports = { ACTIONS, fsAction, dbAdmin, backupAction, backupPathOk, dbUserAdmin, parseDbUsers, DB_USER_RE, DB_PASS_RE, DB_PROTECTED, serviceAction, dockerAction, wrap, parseStats, parseServices, parseDiskUsage, parseDbList, DB_NAME_RE, SERVICE_RE };

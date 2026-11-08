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

function parseDiskUsage(text) {
  return text.split('\n')
    .map((l) => l.trim().split('|'))
    .filter((p) => p.length === 2 && p[0].startsWith('/') && /^\d+$/.test(p[1]))
    .map(([path, bytes]) => ({ path, bytes: Number(bytes) }))
    .sort((a, b) => b.bytes - a.bytes);
}

module.exports = { ACTIONS, serviceAction, dockerAction, wrap, parseStats, parseServices, parseDiskUsage, parseDbList, DB_NAME_RE, SERVICE_RE };

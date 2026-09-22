#!/usr/bin/env bash
# =============================================================================
# PEMASANG PERANTARA BINANCE IP-TETAP untuk bot AMONK (mode akun asli).
# Jalankan SEKALI di VPS Ubuntu 22.04 / 24.04 baru, sebagai root:
#   curl -fsSL https://amonkshark.github.io/Amonk/proksi/pasang_proksi.sh | sudo bash
# Yang dikerjakan: Node 20, Caddy (HTTPS otomatis lewat <ip>.sslip.io), layanan systemd amonk-proksi,
# firewall (22/80/443). Kunci Binance diketik DI SINI (tidak tampil di layar), disimpan di
# /etc/amonk-proksi.env (chmod 600). Aman dijalankan ulang (rahasia yang sudah ada dipertahankan).
# =============================================================================
set -euo pipefail
TTY=/dev/tty
say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
[ "$(id -u)" = "0" ] || { echo "Jalankan sebagai root (pakai sudo)."; exit 1; }

say "1/7 Memeriksa IP & jangkauan Binance dari server ini"
IP=$(curl -4 -fsS https://api.ipify.org || true)
[ -n "$IP" ] || { echo "Tidak bisa membaca IP publik server."; exit 1; }
KODE=$(curl -s -o /dev/null -w '%{http_code}' https://api.binance.com/api/v3/ping || true)
echo "IP publik server : $IP"
echo "Binance ping     : HTTP $KODE"
if [ "$KODE" != "200" ]; then
  echo "!! Binance tidak bisa dijangkau dari lokasi server ini (HTTP $KODE; 451 = wilayah diblokir, mis. AS)."
  echo "!! Hapus server ini dan buat ulang di lokasi lain (disarankan: Sydney)."; exit 1
fi
HOST="$(echo "$IP" | tr . -).sslip.io"

say "2/7 Memasang Node.js 20"
if ! node -v 2>/dev/null | grep -qE '^v(2[0-9]|1[89])'; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

say "3/7 Memasang Caddy (HTTPS otomatis)"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

say "4/7 Mengambil kode perantara"
id amonkproksi >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin amonkproksi
mkdir -p /opt/amonk-proksi
curl -fsSL "https://amonkshark.github.io/Amonk/proksi/proksi_binance.js?v=$(date +%s)" -o /opt/amonk-proksi/proksi_binance.js
node --check /opt/amonk-proksi/proksi_binance.js
chmod 644 /opt/amonk-proksi/proksi_binance.js

say "5/7 Kunci Binance ASLI"
ENVF=/etc/amonk-proksi.env
touch "$ENVF"; chmod 600 "$ENVF"
baca_env() { grep -E "^$1=" "$ENVF" 2>/dev/null | head -1 | cut -d= -f2- || true; }
PK=$(baca_env PROKSI_KUNCI); [ -n "$PK" ] || PK=$(openssl rand -hex 32)
BK=$(baca_env BINANCE_KEY); BS=$(baca_env BINANCE_SECRET)
if [ -z "$BK" ] || [ -z "$BS" ]; then
  echo "Buat kunci API di Binance SEKARANG (API Management -> Create API):"
  echo "  - Centang HANYA: Enable Reading  +  Enable Spot & Margin & Stock Trading"
  echo "  - JANGAN centang: Margin Loan, Futures, Universal Transfer, Withdrawals, Alpha, Prediction"
  echo "  - IP access: Restrict access to trusted IPs only  ->  isi:  $IP"
  printf '\nTempel API Key lalu Enter (tidak tampil): ' > $TTY; read -rs BK < $TTY; echo > $TTY
  printf 'Tempel Secret Key lalu Enter (tidak tampil): ' > $TTY; read -rs BS < $TTY; echo > $TTY
  [ -n "$BK" ] && [ -n "$BS" ] || { echo "Kunci kosong — jalankan ulang skrip ini."; exit 1; }
fi
cat > "$ENVF" <<EOF
BINANCE_KEY=$BK
BINANCE_SECRET=$BS
PROKSI_KUNCI=$PK
PORT=8080
HOST=127.0.0.1
EOF
chmod 600 "$ENVF"; chown root:root "$ENVF"

say "6/7 Layanan & HTTPS"
cat > /etc/systemd/system/amonk-proksi.service <<EOF
[Unit]
Description=Perantara Binance IP-tetap untuk bot AMONK
After=network-online.target
[Service]
EnvironmentFile=$ENVF
ExecStart=$(command -v node) /opt/amonk-proksi/proksi_binance.js
User=amonkproksi
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
  reverse_proxy 127.0.0.1:8080
}
EOF
if command -v ufw >/dev/null; then ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null; fi
systemctl daemon-reload
systemctl enable --now amonk-proksi
systemctl restart amonk-proksi caddy

say "7/7 Memeriksa"
sleep 8
CEK=$(curl -fsS "https://$HOST/cek" || true)
echo "Hasil https://$HOST/cek : ${CEK:-(belum menjawab — tunggu 1 menit lalu buka alamat itu di browser)}"

cat > $TTY <<EOF

============================================================================
 SELESAI. Isi di Cloudflare -> amonk-bot -> Settings -> Variables and Secrets:

   PROXY_URL   (Text)   = https://$HOST
   PROXY_KUNCI (Secret) = $PK

 Pastikan kunci Binance dibatasi ke IP: $IP
 JANGAN kirim PROXY_KUNCI atau kunci Binance ke chat mana pun.
 Cek kapan saja:  https://$HOST/cek        Log:  journalctl -u amonk-proksi -f
============================================================================
EOF

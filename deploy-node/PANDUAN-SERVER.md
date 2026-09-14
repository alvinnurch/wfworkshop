# Platform Workshop Terintegrasi — versi server sendiri

Backend satu berkas, **tanpa dependensi** (hanya Node.js bawaan). Tidak ada
`npm install`, tidak ada basis data yang perlu disetel, tidak ada kunci API.
Data tersimpan di `data.json` dengan tulis atomik.

Sandi admin diperiksa **di server**, jadi tidak ada lagi dua tempat yang harus
disamakan — sumber kegagalan yang paling sering pada versi sebelumnya.

---

## Isi folder

```
server.js          ← backend + penyaji halaman (satu berkas)
public/
  index.html       ← aplikasinya
  config.js        ← sudah diisi: WORKSHOP_API = '/api'
  support.js
  assets/          ← logo
data.json          ← dibuat otomatis saat pertama kali menyimpan
```

## Coba dulu di komputer sendiri (2 menit)

Butuh Node.js 18+ ([nodejs.org](https://nodejs.org), pilih LTS).

```bash
cd deploy-node
ADMIN_PASSWORD=workshop2026 node server.js
```

Di Windows (PowerShell):

```powershell
cd deploy-node
$env:ADMIN_PASSWORD="workshop2026"; node server.js
```

Buka `http://localhost:8080`. Masuk sebagai admin dengan sandi tadi, buat sesi,
tekan **Simpan perubahan** — akan muncul `data.json` di folder itu. Tutup server
dengan Ctrl+C, jalankan lagi: data Anda masih ada.

---

## Pasang di AWS Lightsail ($5/bulan, paling murah & stabil)

1. **Buat instance.** [lightsail.aws.amazon.com](https://lightsail.aws.amazon.com)
   → *Create instance* → Region **Singapore** → Platform **Linux** → Blueprint
   **OS Only → Ubuntu 22.04** → paket **$5/bulan** (1 GB RAM, cukup untuk 1000
   peserta) → *Create*.
2. **Buka port.** Instance → tab **Networking** → *Add rule* → **HTTP (80)** dan
   **HTTPS (443)** → Save.
3. **Masuk ke server.** Tombol **Connect using SSH** (terminal langsung di browser).
4. **Pasang Node.js:**

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

5. **Unggah berkas.** Cara termudah — lewat GitHub:

   ```bash
   sudo apt-get install -y git
   git clone https://github.com/<akun>/<repo>.git workshop
   cd workshop/deploy-node
   ```

   (Atau pakai tombol *Upload file* pada jendela SSH Lightsail untuk mengunggah
   zip, lalu `unzip`.)

6. **Jalankan sebagai layanan** supaya tetap hidup setelah SSH ditutup:

   ```bash
   sudo tee /etc/systemd/system/workshop.service > /dev/null <<'EOF'
   [Unit]
   Description=Platform Workshop
   After=network.target

   [Service]
   WorkingDirectory=/home/ubuntu/workshop/deploy-node
   ExecStart=/usr/bin/node server.js
   Environment=PORT=80
   Environment=ADMIN_PASSWORD=SandiPanitiaAnda
   Restart=always
   User=root

   [Install]
   WantedBy=multi-user.target
   EOF

   sudo systemctl enable --now workshop
   sudo systemctl status workshop --no-pager
   ```

7. **Buka alamatnya.** Pakai *Public IPv4 address* dari halaman instance:
   `http://13.212.xxx.xxx`. Sebaiknya klik **Create static IP** dulu (gratis)
   agar alamatnya tidak berubah saat instance di-restart.

### Wajib untuk barcode check in: https

Kamera peramban hanya aktif di `https`. Cara paling cepat (gratis):

1. Punyai nama domain (mis. `workshop.islami.co`), arahkan A-record-nya ke
   static IP tadi.
2. Di server:

   ```bash
   sudo apt-get install -y nginx certbot python3-certbot-nginx
   sudo tee /etc/nginx/sites-available/workshop > /dev/null <<'EOF'
   server {
     listen 80;
     server_name workshop.contoh.id;       # ganti dengan domain Anda
     location / {
       proxy_pass http://127.0.0.1:8080;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection '';
       proxy_buffering off;                # penting untuk realtime
       proxy_read_timeout 1h;
     }
   }
   EOF
   sudo ln -sf /etc/nginx/sites-available/workshop /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo systemctl restart nginx
   sudo certbot --nginx -d workshop.contoh.id
   ```

   Lalu ubah `Environment=PORT=80` pada layanan menjadi `PORT=8080`:
   `sudo systemctl daemon-reload && sudo systemctl restart workshop`.

---

## Alternatif tanpa server sendiri

Kalau tidak ingin mengurus Linux, folder yang sama bisa dipasang di:

- **Railway** — [railway.app](https://railway.app) → *Deploy from GitHub* → pilih
  repo → Variables: `ADMIN_PASSWORD`. Sudah https otomatis. Gratis untuk
  pemakaian ringan. **Catatan**: tambahkan *Volume* pada path `/app/deploy-node`
  agar `data.json` tidak hilang saat deploy ulang.
- **Render** — [render.com](https://render.com) → *New Web Service* → Start
  command `node server.js`, Root directory `deploy-node`, tambahkan *Disk* 1 GB
  pada mount path yang sama.
- **Fly.io** — `fly launch` di dalam folder ini, lalu `fly volumes create data`.

Ketiganya memberi https tanpa konfigurasi — barcode check in langsung jalan.

---

## Operasional

- **Cadangan data**: cukup salin `data.json`. Sebelum acara besar:
  `cp data.json data-$(date +%F).json`.
- **Ganti sandi admin**: ubah `ADMIN_PASSWORD` pada layanan lalu
  `sudo systemctl restart workshop`.
- **Lihat log**: `sudo journalctl -u workshop -f`.
- **Nol-kan jawaban peserta** (susunan sesi tetap): kirim aksi `reset` — atau
  hentikan server, hapus bagian `responses` di `data.json`, jalankan lagi.
- **Pindah dari versi lama**: buka URL Apps Script lama dengan `?action=db`,
  simpan hasilnya sebagai `data.json`… — lebih mudah: buka JSON itu, ambil
  bagian `data`, simpan sebagai `data.json`, letakkan di samping `server.js`,
  lalu jalankan servernya.

## Bila ada masalah

| Gejala | Obatnya |
|---|---|
| `node: command not found` | Node.js belum terpasang (langkah 4) |
| Halaman tidak terbuka dari luar | Port 80/443 belum dibuka di tab Networking |
| "Kata sandi admin salah" | `ADMIN_PASSWORD` pada layanan berbeda dengan yang diketik; cek `sudo systemctl show workshop -p Environment` |
| Data hilang setelah deploy ulang (Railway/Render) | Volume/Disk belum dipasang pada folder kerja |
| Kamera check in tidak jalan | Alamatnya masih `http` — pasang https (bagian di atas) |
| Perubahan admin tidak tersimpan | Lihat log: `sudo journalctl -u workshop -n 50` |

# Platform Workshop Terintegrasi — versi Supabase

Panduan ini menggantikan versi spreadsheet. Backend-nya Postgres sungguhan
dengan realtime, tahan 200–1000 peserta serentak. Tidak ada kode server yang
perlu Anda tulis: Supabase sudah menyediakan API-nya.

Perkiraan waktu: **20–30 menit**, sekali saja.

---

## Isi folder

| Berkas | Gunanya |
|---|---|
| `index.html` | Aplikasinya (sama seperti versi lama, penyimpanannya saja yang berubah) |
| `config.js` | Tempat Anda menempel URL dan kunci Supabase |
| `supabase-store.js` | Penghubung halaman ↔ Postgres, termasuk realtime |
| `support.js` | Pustaka tampilan |
| `schema.sql` | Skema basis data — dijalankan sekali di Supabase |
| `pindahkan-data.html` | Alat sekali pakai: memindahkan data dari spreadsheet lama |
| `assets/` | Logo Islamidotco & Wahid Foundation |

---

## Langkah 1 — Buat proyek Supabase

1. Buka [supabase.com](https://supabase.com) → **Sign in** (bisa dengan akun GitHub) → **New project**.
2. Isi:
   - **Name**: `workshop`
   - **Database Password**: buat sandi kuat, **simpan** (dipakai kalau Anda ingin masuk lewat SQL client).
   - **Region**: pilih **Southeast Asia (Singapore)** — paling dekat, paling cepat.
3. Tunggu ±2 menit sampai proyeknya hijau.

Paket gratisnya cukup: 500 MB basis data, 5 GB lalu lintas, 200 sambungan
realtime bersamaan. Untuk 1000 peserta yang hanya membaca, halaman memakai
satu sambungan realtime per perangkat — bila khawatir, naikkan ke paket Pro
($25/bulan) saat hari-H, lalu turunkan lagi.

## Langkah 2 — Pasang skema basis data

1. Di Supabase, buka **SQL Editor** (ikon `>_` di bilah kiri) → **New query**.
2. Buka `schema.sql` dari folder ini, salin **seluruh** isinya, tempel ke editor.
3. Tekan **Run** (atau Ctrl+Enter). Harus muncul *Success*.
4. Ganti sandi admin — jalankan satu perintah lagi di editor yang sama:

   ```sql
   update admin_secret set password = 'SandiPanitiaAnda' where id = 1;
   ```

   Sandi inilah yang dipakai panitia untuk masuk sebagai admin.

## Langkah 3 — Buat tempat unggahan berkas

1. Buka **Storage** → **New bucket**.
2. Nama: `unggahan`. Nyalakan **Public bucket** (agar gambar formulir dan
   berkas PPT bisa dibuka peserta). → **Create**.
3. Masih di Storage → tab **Policies** → **New policy** → pilih template
   **Allow access to everyone** untuk `INSERT` dan `SELECT` pada bucket itu.

## Langkah 4 — Sambungkan halaman

1. Buka **Project Settings → API**. Anda butuh dua nilai:
   - **Project URL** — mirip `https://abcdefghijkl.supabase.co`
   - **anon public** — kunci panjang. Aman dipasang di halaman; ia hanya bisa
     melakukan apa yang diizinkan RLS pada Langkah 2.
2. Buka `config.js`, isi keduanya:

   ```js
   window.SUPABASE = {
     url: 'https://abcdefghijkl.supabase.co',
     anonKey: 'eyJhbGciOi…',
     bucket: 'unggahan'
   };
   ```

## Langkah 5 — Pindahkan data lama (opsional, sekali saja)

Lewati bila ingin mulai bersih.

1. Pastikan Web app Apps Script yang lama **masih aktif**.
2. Buka `pindahkan-data.html` (bisa langsung dari komputer, klik dua kali).
3. Tempel URL Web app lama + sandi admin (yang baru Anda set di Langkah 2) →
   **Mulai pindahkan**.
4. Tunggu sampai muncul *Selesai*. Sesi, materi, soal kuis, peserta, kehadiran,
   jawaban kuis, kata, umpan balik, dan isian formulir ikut berpindah.

## Langkah 6 — Unggah ke internet

Pilih salah satu; ketiganya gratis dan sudah https (wajib untuk kamera check in).

**GitHub Pages**
1. Buat repositori baru di GitHub (boleh publik — `anonKey` memang aman dibaca).
2. Unggah **isi** folder ini (bukan foldernya) ke cabang `main`.
3. **Settings → Pages → Source: Deploy from a branch → main / root → Save**.
4. Tautannya muncul dalam ±1 menit: `https://<nama-anda>.github.io/<repo>/`.

**Netlify** — buka [app.netlify.com/drop](https://app.netlify.com/drop), tarik
folder ini ke halaman itu. Selesai dalam 10 detik.

**Vercel** — `vercel --prod` dari dalam folder ini, atau impor repo GitHub-nya.

---

## Sesudah pasang

- **Masuk admin**: tombol *Masuk sebagai admin* → sandi dari Langkah 2.
- **Simpan perubahan** tetap manual: penyuntingan ditahan di peramban sampai
  Anda menekannya — tapi kini penyimpanannya tuntas dalam ratusan milidetik.
- **Realtime**: begitu admin membuka materi atau memulai kuis, peserta dan
  proyektor berubah hampir seketika, tanpa menunggu putaran pembacaan.
- **Barcode check in**: butuh https dan halaman dibuka sebagai tab penuh.
- **Rekap**: tombol CSV dan PDF bekerja sama seperti sebelumnya.

## Bila ada masalah

| Gejala | Penyebab & obatnya |
|---|---|
| Halaman berjalan "mode demo" | `config.js` belum diisi, atau salah tempel URL/kunci |
| "Kata sandi admin tidak cocok" | Jalankan ulang `update admin_secret …` di SQL Editor |
| Data tidak muncul sama sekali | `schema.sql` belum dijalankan, atau dijalankan di proyek lain |
| Perubahan admin tidak sampai ke peserta | Buka **Database → Replication**, pastikan publikasi `supabase_realtime` memuat tabel-tabelnya (skema sudah mencoba menambahkannya otomatis) |
| Unggahan gambar gagal | Bucket `unggahan` belum dibuat atau belum publik (Langkah 3) |
| Kamera tidak bisa dipakai | Alamatnya bukan https, atau halaman dibuka di dalam bingkai — buka sebagai tab penuh |

## Cadangan data

Supabase menyimpan cadangan harian otomatis. Untuk salinan manual:
**Database → Backups → Download**, atau ekspor CSV tiap tabel dari
**Table Editor**. Rekap PDF/CSV dari panel admin tetap bisa dipakai kapan saja.

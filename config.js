/* ══════════════════════════════════════════════════════════════
   Platform Workshop Terintegrasi — pengaturan sambungan
   Isi dua nilai di bawah, ambil dari Supabase:
     Project Settings → API → Project URL dan anon public key.
   ══════════════════════════════════════════════════════════════ */
window.SUPABASE = {
  url: '',            // contoh: 'https://vlwuzpfiabmdahcvbqvd.supabase.co'
  anonKey: '',        // kunci "anon public" — aman dipasang di halaman
  bucket: 'unggahan'  // nama bucket penyimpanan untuk unggahan gambar/PPT
};

/* Kata sandi admin TIDAK disimpan di sini — tersimpan di Supabase
   (tabel admin_secret). Panitia memasukkannya saat login admin. */

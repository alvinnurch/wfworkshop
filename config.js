/* ══════════════════════════════════════════════════════════════
   Platform Workshop Terintegrasi — pengaturan sambungan
   Isi dua nilai di bawah, ambil dari Supabase:
     Project Settings → API → Project URL dan anon public key.
   ══════════════════════════════════════════════════════════════ */
window.SUPABASE = {
  url: 'https://vlwuzpfiabmdahcvbqvd.supabase.co',            // contoh: 'https://abcdefghijkl.supabase.co'
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsd3V6cGZpYWJtZGFoY3ZicXZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNzcwNTcsImV4cCI6MjEwNDk1MzA1N30.GG9Df6fLN0L7Iea9h6LjVeNsBwiMfttaAuJlqoRdSxE',        // kunci "anon public" — aman dipasang di halaman
  bucket: 'unggahan'  // nama bucket penyimpanan untuk unggahan gambar/PPT
};

/* Kata sandi admin TIDAK disimpan di sini — tersimpan di Supabase
   (tabel admin_secret). Panitia memasukkannya saat login admin. */

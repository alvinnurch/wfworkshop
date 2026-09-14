/* ══════════════════════════════════════════════════════════════
   Platform Workshop Terintegrasi — pengaturan sambungan
   Ambil dua nilai pertama dari Supabase:
     Project Settings → API → Project URL dan kunci anon / public.
   ══════════════════════════════════════════════════════════════ */
window.SUPABASE = {
  url: 'https://vlwuzpfiabmdahcvbqvd.supabase.co',            // contoh: 'https://abcdefghijkl.supabase.co'
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsd3V6cGZpYWJtZGFoY3ZicXZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNzcwNTcsImV4cCI6MjEwNDk1MzA1N30.GG9Df6fLN0L7Iea9h6LjVeNsBwiMfttaAuJlqoRdSxE',        // kunci 'anon public' — aman dipasang di halaman

  /* Sandi admin. HARUS SAMA dengan yang tersimpan di Supabase:
       update admin_secret set password = 'sayaadminnya' where id = 1;
     Bila berbeda, Anda tetap bisa masuk sebagai admin tetapi
     setiap penyimpanan akan ditolak Supabase. */
  adminPassword: 'sayaadminnya',

  bucket: 'unggahan'  // bucket penyimpanan untuk unggahan gambar/berkas
};

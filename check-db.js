require('dotenv').config();
var u = process.env.DATABASE_URL || '';
if (u.includes('supabase')) {
  console.log('Supabase OK - ' + u.slice(0, 50));
} else {
  console.log('NOT Supabase: ' + u.slice(0, 50));
}

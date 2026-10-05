<p align="center"><img src="assets/logo.png" alt="Le Charcutier" height="80"></p>

# Le Charcutier – In-Store Leasing

Project for leasing space (counters, stands, or sections) inside the Le Charcutier store.

## Goals
- Define available in-store spaces and their specs
- Track prospective tenants and lease terms
- Manage lease agreements, rent, and renewals

## Structure
- `docs/` – planning notes, lease templates, pricing
- `README.md` – project overview

## Next steps
1. List available spaces and dimensions
2. Draft pricing and lease terms
3. Create a tenant inquiry process

## Deploying to Vercel (Supabase backend)
The app is `index.html` (static). `claude-shim.js` replaces the Claude runtime APIs with Supabase.
1. Create a Supabase project, run `supabase/schema.sql` in the SQL editor.
2. Auth → Providers: keep Email on, turn **off** "Allow new users to sign up", then add users under Auth → Users. The first user becomes admin.
3. Put the project URL and anon key in `config.js`.
4. Import this repo in Vercel (framework preset "Other", no build step).

Admin promotion: `update public.profiles set is_admin = true where email = 'someone@example.com';`
Google Drive sync from the original artifact is not available in this version.

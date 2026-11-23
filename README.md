# Wonder Photo Booth

iPad photo booth (PWA) → QR code → guest data capture → share to Instagram/Facebook, with a staff dashboard for branding, frames, booth health and leads.

Live: https://wonder-photobooth.vercel.app · Dashboard: `/admin` · Guest page: `/p/<photo-id>`

## Layout
- `web/index.html`: booth app. Install on the iPad via Safari › Share › Add to Home Screen.
- `web/p.html`: guest page (data capture, share/save).
- `web/admin.html`: staff dashboard (overview, photos, leads, settings).
- `web/frames.js`: frame engine (configurable templates + PNG overlays, logos, tokens).
- `web/sw.js`: offline cache for the booth shell and branding images.
- `web/build.mjs`: Vercel build step. Copies files to `public/`, adds the QR library and generates icons.
- `supabase/functions/booth-api/index.ts`: API (Supabase Edge Function, `verify_jwt = false`, does its own auth).
- `supabase/migrations/`: database schema, storage buckets and the cleanup cron job.

## Deploying
- **Front end (Vercel):** project `wonder-photobooth`, root directory `web`, build `npm run build`, output `public`.
- **API:** `supabase functions deploy booth-api --no-verify-jwt --project-ref nujmjxzcmygseilwplgf`
- **Database:** apply `supabase/migrations` in order, then set the staff passcode hash (see `20261119015236_app_secrets.sql`).
- **Optional email fallback:** set the `RESEND_API_KEY` and `EMAIL_FROM` edge function secrets.

## Access
- **Superadmin passcode:** full dashboard (overview, booth health, photos, leads, all settings, brand profiles, client access, passcodes). It's also the passcode for booth iPads.
- **Client passcode:** set by a superadmin under Settings › Client access. Same `/admin` link, but only the statistics dashboard and the brand kit (event, app brand, frames, booth wording, guest page). No guest data, photos, booth controls or passcodes; the server enforces this, and the passcode can't run a booth.
- **Brand profiles (superadmin):** save the current brand kit as a named profile, then load it later to switch clients.

## Notes
- Photos live in a private `photos` bucket and are only reachable via signed links. Logos and frame overlays live in the public `branding` bucket.
- Photos auto-delete after the retention period set in Settings. Leads are never auto-deleted.

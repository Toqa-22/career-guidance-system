# Certificate System — Edge Functions Setup

Good news: this got a lot simpler. Certificates are downloaded directly by
the participant — there's no email sending at all, so no email provider,
no Gmail OAuth, no domain verification, nothing like that to set up.

## What you're setting up

5 Edge Functions, and nothing else:
- `check-registration` — verifies a staff number is registered for a course (used by the public certificate page)
- `verify-certificate` — checks if a certificate ID is valid (used by `/verify-certificate.html`)
- `generate-certificate` — verifies the registration, builds the certificate PDF right here (using `pdf-lib` — pure JavaScript, no native dependencies), stores it, and returns a download link
- `get-my-data` — returns one participant's own registrations + certificates by staff number (used by `/student-dashboard.html`)
- `list-certificates` — returns minimal issued-certificate info so the admin Student Dashboard can show a "Download Certificate" button per row (issued_certificates is locked down, so the admin table needs this to know which registrations already have one)

---

## 1. Prerequisites

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
```

Your project ref is the subdomain in your Supabase URL:
`https://<project-ref>.supabase.co`.

(If you're deploying through the Supabase Dashboard's "Via Editor" instead
of the CLI — paste the code in, click Deploy — you can skip this step
entirely.)

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already available to
every Edge Function automatically — there are no other secrets to set for
any of this.

## 2. Deploy

Via CLI:
```bash
supabase functions deploy check-registration --no-verify-jwt
supabase functions deploy verify-certificate --no-verify-jwt
supabase functions deploy generate-certificate --no-verify-jwt
supabase functions deploy get-my-data --no-verify-jwt
supabase functions deploy list-certificates --no-verify-jwt
```

Or via the Dashboard: **Edge Functions → Deploy a new function → Via
Editor**, name it exactly as above, paste the matching `index.ts` content
from this folder, and click Deploy — for each of the 5 functions.

`--no-verify-jwt` (or the dashboard equivalent below) is required — none of
this app's participants are logged into Supabase Auth, so without this the
CORS preflight gets rejected before your function code even runs.

This project also includes `supabase/config.toml`, which declares
`verify_jwt = false` for all 5 functions, so this is version-controlled
instead of something to remember as a CLI flag every time.

**Also check the dashboard directly** — for each function, there's a
separate toggle at **Edge Functions → (function name) → Settings →
"Enforce JWT Verification"**. This is what actually gates the request in
some cases (particularly if your project uses the older JWT-style
`anon`/`service_role` keys, which this app does) — if you're still seeing
CORS/401 errors after deploying, turn this off directly in the dashboard
for each function.

## 3. Test the flow

1. Open **Create Certificate**, pick a course, upload a certificate image,
   place a rectangle or two, hit **Save Certificate**.
2. Open the course's public certificate link, enter a registered email, and
   click **Get Certificate** — the PDF should download immediately in your
   browser (or open in a new tab, depending on your browser's PDF
   settings — either way, it's right there to save).

## Troubleshooting

- **"This email is not registered for this course"**: double-check the
  email on the test registration in your `registrations` table matches
  exactly what you're typing on the public certificate page.
- **Nothing downloads / a blank tab opens**: check the browser console for
  the actual error — most commonly this means the certificate image itself
  failed to load (check `preview_image_path` on the certificate row is a
  real, publicly-reachable URL).

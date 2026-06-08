# Security note: Supabase anon key on a public site

The Supabase URL + **anon** key are committed in `index.html` and served from a
public GitHub Pages site. The anon key is *designed* to be public — but only the
**Row-Level Security (RLS)** policies on the table actually control access.

## The constraint

The page writes to Supabase with the anon key and **no user login**. So RLS
cannot distinguish a teammate from a random visitor — both present the same anon
key. Whatever anon is allowed to do, anyone on the internet can do via the public
page.

## Current risk

If RLS is off (or allows anon writes), anyone who finds the site can read,
overwrite, or wipe the shared `categorization_state` row. The data isn't
sensitive (folder groupings of public pages), so the realistic threat is
**vandalism / accidental wipe**, not a data breach.

## Recommended (pick based on how much the data matters)

1. **Minimum (pragmatic):**
   - Enable RLS on `categorization_state`.
   - Scope anon policies to just the single row `id = 1` (SELECT + UPDATE).
   - Turn on **Point-in-Time Recovery** (or rely on the committed
     `backups/*.json`) so any clobber is recoverable.
2. **Better (if vandalism is a concern):**
   - Add Supabase Auth (even a single shared team login / magic link).
   - RLS: anon = read-only; authenticated = write.
3. **Operational hygiene:**
   - Commit a fresh `backups/categorization-backup-*.json` periodically.
   - Remember the anon key can't be "revoked" without rotating it (which also
     means redeploying the page), so don't treat it as a secret — treat RLS as
     the control.

## Verify current state

In the Supabase dashboard → Authentication → Policies → `categorization_state`,
confirm RLS is **enabled** and the policies match the intent above.

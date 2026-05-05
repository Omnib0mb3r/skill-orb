# Bug Log

One file per investigation. Naming: `YYYY-MM-DD-short-slug.md`.

Each bug doc captures:

- **Status:** open / investigating / fixed (pending soak) / closed
- **Symptoms** the user actually saw
- **Root causes** as understood, including the layered ones we missed at first
- **Fixes shipped** with commit shas in the table so a future reader can run `git show <sha>`
- **Verification** notes — what was actually exercised
- **Open items** — soak windows, deeper rewrites that the workaround didn't address, follow-up tickets

Closed bugs stay in this folder; we don't delete history. If the same problem recurs, append a new section to the existing file rather than starting a new one — context compounds.

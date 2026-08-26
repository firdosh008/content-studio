# Content Studio - frontend

Next.js 15 (App Router) product layer over the FastAPI backend. See `FRONTEND_BUILD_PROMPT.md` for the phased build and `PLAN.md` for reference code.

```bash
cp .env.example .env.local   # fill in Supabase values
npm install
npm run dev                  # http://localhost:3000
npm test                     # Vitest (tests/**, excluding tests/e2e)
npm run test:e2e             # Playwright (tests/e2e only; starts the dev server)
```

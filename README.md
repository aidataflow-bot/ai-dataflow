# AI DataFlow

AI DataFlow is the production foundation for an AI data agency operating system: client management, AI-powered process analysis, and recommendation tracking.

## Production Architecture

- **Vercel** hosts the frontend and `/api/...` serverless functions.
- **Supabase** stores users, clients, and recommendation history.
- **OpenAI** generates live AI recommendations through `OPENAI_API_KEY`.
- The frontend never receives Supabase service keys or OpenAI keys.

The older `server.js` remains as a local development fallback, but the recommended production path is Vercel + Supabase.

## Required Accounts

- GitHub repo
- Supabase project
- Vercel project connected to GitHub
- OpenAI API key

## Supabase Setup

1. Create a new Supabase project.
2. Open the Supabase SQL editor.
3. Run:

```text
supabase/schema.sql
```

This creates:

- `app_users`
- `clients`
- `recommendations`

## Vercel Environment Variables

Set these in Vercel Project Settings:

```bash
SESSION_SECRET=use-a-long-random-secret
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

Important: `SUPABASE_SERVICE_ROLE_KEY` must only live in Vercel environment variables. Do not put it in frontend JavaScript.

## Deploy

1. Push this project to GitHub.
2. Import the repo into Vercel.
3. Add the environment variables above.
4. Deploy.

Vercel will serve the HTML/CSS/JS files and run `api/[...path].js` for backend routes.

The Vercel build runs `npm run build`, which copies static assets into `public/`.

## Local Development

Quick local fallback:

```bash
npm start
```

For Vercel-style local API testing, use Vercel CLI:

```bash
vercel dev
```

## Project Structure

```text
ai-dataflow/
├── api/[...path].js           # Vercel serverless API backed by Supabase
├── supabase/schema.sql        # Supabase database schema
├── server.js                  # Local fallback server
├── package.json
├── vercel.json
├── .env.example
├── login.html
├── register.html
├── dashboard.html
├── clients.html
├── client-detail.html
├── recommendations.html
├── history.html
├── css/style.css
├── images/logo.png
└── js/
```

## Production Notes

This is now a real app foundation, not a static demo. Before selling it to many customers, add:

- password reset
- email verification
- custom domain
- database backups
- role-based access if you add team accounts
- file upload storage using Supabase Storage

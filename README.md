# AI DataFlow

AI DataFlow is a production MVP for an AI-powered process optimization and client analysis system.

## What Is Included

- Server-backed registration and login
- PBKDF2 password hashing
- Signed session tokens
- Server-side client records
- Server-side recommendation history
- Client-linked analyses
- Favorite/status tracking
- OpenAI-powered recommendation generation through `OPENAI_API_KEY`
- Static frontend served by the Node app

## Requirements

- Node.js 18+
- An OpenAI API key for live AI recommendations
- A hosting provider that can run a Node server and persist the `data/` directory, or a database upgrade before heavy production use

## Environment

Copy `.env.example` to `.env` locally or set the same values in your hosting dashboard:

```bash
PORT=4173
SESSION_SECRET=change-this-to-a-long-random-value
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini
```

`OPENAI_API_KEY` is required for live recommendations. If it is missing, the app shows a configuration error instead of generating fake recommendations.

## Run Locally

```bash
npm start
```

Open:

```text
http://localhost:4173
```

## Deploy

Use a Node-capable host such as Render, Railway, Fly.io, DigitalOcean App Platform, or a VPS.

Recommended settings:

- Build command: none
- Start command: `npm start`
- Node version: 18 or newer
- Environment variables: `SESSION_SECRET`, `OPENAI_API_KEY`, `OPENAI_MODEL`
- Persistent disk: mount or preserve the `data/` directory

## Important Production Notes

This MVP now uses real server-side auth and storage, but for larger production use you should upgrade the JSON file store to PostgreSQL or another managed database, add password reset/email verification, and configure automated backups.

## Project Structure

```text
ai-dataflow/
├── server.js                  # Node API and static file server
├── package.json               # Start scripts
├── .env.example               # Required environment variables
├── index.html                 # Redirects to login
├── login.html                 # Login page
├── register.html              # Registration page
├── dashboard.html             # Main dashboard
├── clients.html               # Client directory
├── client-detail.html         # Client profile and linked analyses
├── recommendations.html       # AI analysis interface
├── history.html               # Recommendation history
├── css/style.css              # Styles
├── images/logo.png            # Logo
└── js/                        # Frontend page logic
```

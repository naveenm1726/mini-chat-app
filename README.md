# Chat App

![Deploy to Render](https://github.com/naveenm1726/mini-chat-app/actions/workflows/deploy-render.yml/badge.svg)

Real-time private messaging app inspired by WhatsApp, Instagram, and Telegram.

## Implemented Features

- Email/username authentication
- Real-time 1:1 messaging (Socket.io)
- Online/offline presence indicators
- Typing indicators
- Unread badges and conversation list
- Read receipts (`Sent` / `Read`)
- Profile bio update
- Emoji picker
- Message search inside active chat
- Edit your own message
- Delete your own message
- User search and start new conversations
- Dark mode toggle

## Feature Coverage (WhatsApp / Instagram / Telegram)

### Already in this app
- Core private chat UX
- Presence + typing
- Read states and unread counts
- Basic profile controls

### Not yet implemented (next phases)
- Group chats and admin roles
- Message reactions
- Voice notes and media/file upload
- Stories/status channels
- Voice/video calls
- Pinned chats and archived chats
- Message reply/forward
- End-to-end encryption and key verification UX
- Multi-device session management

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Auto Deploy to Render (Live Updates)

This repo now includes:

- GitHub Actions workflow: `.github/workflows/deploy-render.yml`
- Render blueprint config: `render.yaml`
- Health check endpoint: `/api/health`

### Option A (recommended): Render native auto-deploy

1. In Render dashboard, open your web service.
2. Set **Auto-Deploy** to `On` for your production branch (`main` or `master`).
3. Every `git push` to that branch will update your live site.

### Option B: Deploy Hook via GitHub Actions

1. In Render service settings, create a **Deploy Hook** and copy the URL.
2. In GitHub repo settings, add secret:
	- `RENDER_DEPLOY_HOOK_URL` = your Render deploy hook URL
3. Push to `main`/`master`.
4. GitHub Action triggers Render deploy automatically.

### Required environment variables on Render

- `JWT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_KEY`

If these are missing, deploy will succeed but the app won’t work correctly.


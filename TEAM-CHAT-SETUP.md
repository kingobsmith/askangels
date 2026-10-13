# AskAngels Team Chat — Setup

Team Chat is a private, members-only chat at `/team` where King, executives, employees and interns talk in rooms alongside **Claude** and **Angel**. Every message shows who said it, their title and the time. Type `@Claude` or `@Angel` in a message to bring them into the conversation.

## What's in this change

| File | What it does |
|---|---|
| `team.html`, `css/team.css`, `js/team.js` | The chat page: sign in, rooms, named messages, approvals |
| `api/ai.js` | Server function that gets Claude's or Angel's reply and posts it under their name |
| `api/config.js` | Gives the page the public database settings |
| `supabase/schema.sql` | Database tables and security rules |

Nothing on the existing site was changed. The page is not linked from the public navigation.

## One-time setup (about 20 minutes)

### 1. Create the database
1. Go to supabase.com and create a free project (or use an existing one).
2. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and press **Run**.
3. In **Authentication → URL Configuration**, set the Site URL to your site address (for example `https://askangels.co`) and add `https://askangels.co/team` as a redirect URL.
4. From **Project Settings → API**, copy the **Project URL**, the **anon public** key and the **service_role** key.

### 2. Get the AI keys
- **Claude:** create an API key at console.anthropic.com.
- **Angel:** create an API key at perplexity.ai (Settings → API).

### 3. Add the settings in Vercel
In Vercel, open the AskAngels project → **Settings → Environment Variables**, and add:

| Name | Value |
|---|---|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_ANON_KEY` | Supabase anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key (keep secret) |
| `ANTHROPIC_API_KEY` | Claude API key |
| `PERPLEXITY_API_KEY` | Perplexity API key |
| `ANGEL_SYSTEM_PROMPT` *(optional)* | Angel's own instructions, so she sounds exactly like Angel |
| `CLAUDE_MODEL` *(optional)* | defaults to `claude-sonnet-5-5` |
| `ANGEL_MODEL` *(optional)* | defaults to `sonar-pro` |

Never paste these keys into a chat, an email or the code.

### 4. Try it on the preview link first
This work is on the `team-chat` branch. Vercel builds a separate **preview** link for it, so the live askangels.co is untouched. Open `<preview link>/team`, create your account with **kingobsmith@gmail.com** (approved automatically as owner), and test. When it works, merge the branch to publish it at `askangels.co/team`.

## Bringing people in
1. Send them `askangels.co/team`.
2. They choose **Create account**.
3. They appear under **Waiting for approval** in your sidebar. Press **Approve**.
4. Ask them to press ✎ and add their title, which shows on every message.

To make someone an admin who can also approve people, open Supabase **Table Editor → profiles** and change their `role` to `admin`.

## Cost
Accounts are free: this is your own platform, with no per-seat fee. You pay only for usage:
- **Supabase** and **Vercel** free tiers comfortably cover a small internal team.
- **Claude and Angel** are billed per message to your Anthropic and Perplexity accounts. Each reply sends up to the last 30 messages of the room as context.

## Good to know
- **Angel here is Angel's voice through Perplexity's API,** not the askangel.pplx.app instance itself, so she doesn't share that app's memory. Paste Angel's instructions into `ANGEL_SYSTEM_PROMPT` to match her voice.
- **Claude here is Claude through the Anthropic API.** It reads the room's recent history, not your personal claude.ai conversations.
- **Security:** people can only post under their own name; the database enforces it. Only approved members can read anything.

## Next steps (from Angel's requirements)
- More assistants: `@Perplexity` and `@ChatGPT`, routed the same way.
- Company and department rooms with role-based visibility for interns.
- Shared documents (handbooks, hiring files) the assistants can read.
- An approval log and audit trail for handbook edits, hiring decisions and code changes.

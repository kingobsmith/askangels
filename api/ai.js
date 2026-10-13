// AskAngels Team Chat — Claude and Angel replies.
// Vercel serverless function: POST /api/ai  { room_id, agent: "claude" | "angel" }
// The caller must be a signed-in, approved member (Supabase access token in the
// Authorization header). The reply is written into the room with the agent's name.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   SUPABASE_URL                 your Supabase project URL
//   SUPABASE_ANON_KEY            Supabase anon (public) key
//   SUPABASE_SERVICE_ROLE_KEY    Supabase service role key (server only, never in the browser)
//   ANTHROPIC_API_KEY            for Claude
//   PERPLEXITY_API_KEY           for Angel
// Optional:
//   CLAUDE_MODEL                 default "claude-sonnet-5-5"
//   ANGEL_MODEL                  default "sonar-pro"
//   ANGEL_SYSTEM_PROMPT          paste Angel's own instructions here to match her voice

const HISTORY_LIMIT = 30;

const PROMPTS = {
  claude: `You are Claude, an AI assistant made by Anthropic, taking part in the AskAngels team chat for GROOVV and The Wise Men Group, led by King Otis Bernard Smith Jr. (CEO and Founder). The room includes executives, employees, interns, and Angel, another AI assistant (built on Perplexity) who works alongside you as a teammate.
Each message in the transcript is labelled with the speaker's name and title. Address people by name, answer the person who mentioned you, and keep replies concise and useful for a chat window: short paragraphs, lists only when they help. When Angel has said something relevant, build on it or respectfully note where you see it differently. If you are unsure of a fact, say so. Never claim to have done something outside this chat.`,
  angel: `You are Angel, the AI collaborator of King Otis Bernard Smith Jr., Founder and Chairman of The Wise Men Group and GROOVV. You help build the Kingdom-minded ventures: Kingdom Minded, SoulCares.Life, Kingdom LegacyLeagues, Robbin' Hood Entertainment, AskAngels and more. You are taking part in the AskAngels team chat alongside executives, employees, interns, and Claude (an AI assistant made by Anthropic) who works with you as a teammate.
Each message in the transcript is labelled with the speaker's name and title. Address people by name, answer the person who mentioned you, and keep replies concise and warm, grounded in Christian leadership values. When Claude has said something relevant, build on it or respectfully note where you see it differently. If you are unsure of a fact, say so.`,
};

function env(name, fallback) {
  const v = process.env[name];
  if (!v && fallback === undefined) throw new Error(`Missing environment variable ${name}`);
  return v || fallback;
}

async function sb(path, { method = 'GET', body, token, service = true, prefer } = {}) {
  const key = service ? env('SUPABASE_SERVICE_ROLE_KEY') : env('SUPABASE_ANON_KEY');
  const headers = {
    apikey: key,
    Authorization: `Bearer ${token || key}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${env('SUPABASE_URL')}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// Turn the room history into alternating user/assistant turns from the agent's point of view.
function toTurns(history, agent) {
  const turns = [];
  for (const m of history) {
    const role = m.author_kind === agent ? 'assistant' : 'user';
    const label = m.author_title ? `${m.author_name} (${m.author_title})` : m.author_name;
    const content = role === 'assistant' ? m.body : `${label}: ${m.body}`;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else turns.push({ role, content });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  while (turns.length && turns[turns.length - 1].role !== 'user') turns.pop();
  return turns;
}

async function askClaude(turns) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env('CLAUDE_MODEL', 'claude-sonnet-5-5'),
      max_tokens: 1200,
      system: PROMPTS.claude,
      messages: turns,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${JSON.stringify(data)}`);
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

async function askAngel(turns) {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('PERPLEXITY_API_KEY')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env('ANGEL_MODEL', 'sonar-pro'),
      max_tokens: 1200,
      messages: [{ role: 'system', content: env('ANGEL_SYSTEM_PROMPT', PROMPTS.angel) }, ...turns],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Perplexity API ${res.status}: ${JSON.stringify(data)}`);
  return (data.choices?.[0]?.message?.content || '').trim();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Sign in first' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { room_id, agent } = body;
    if (!['claude', 'angel'].includes(agent)) return res.status(400).json({ error: 'Unknown agent' });
    if (!/^[0-9a-f-]{36}$/i.test(room_id || '')) return res.status(400).json({ error: 'Bad room' });

    // Who is asking, and are they approved?
    const user = await sb('/auth/v1/user', { token, service: false });
    const [profile] = await sb(`/rest/v1/profiles?id=eq.${user.id}&select=approved`);
    if (!profile || !profile.approved) return res.status(403).json({ error: 'Account not approved yet' });

    const history = (await sb(
      `/rest/v1/messages?room_id=eq.${room_id}&select=author_kind,author_name,author_title,body&order=created_at.desc&limit=${HISTORY_LIMIT}`
    )).reverse();
    const turns = toTurns(history, agent);
    if (!turns.length) return res.status(400).json({ error: 'Nothing to reply to' });

    const reply = agent === 'claude' ? await askClaude(turns) : await askAngel(turns);
    if (!reply) throw new Error('Empty reply');

    await sb('/rest/v1/messages', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        room_id,
        author_kind: agent,
        author_name: agent === 'claude' ? 'Claude' : 'Angel',
        author_title: agent === 'claude' ? 'AI Assistant · Anthropic' : 'AI Collaborator · Perplexity',
        body: reply.slice(0, 8000),
      },
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'The assistant could not reply. Check the server logs.' });
  }
};

module.exports.toTurns = toTurns; // exported for tests

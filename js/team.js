// AskAngels Team Chat — browser side.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var views = ['auth-view', 'pending-view', 'setup-view', 'app-view'];
  function show(view) { views.forEach(function (v) { $(v).hidden = v !== view; }); }

  var sb = null;          // Supabase client
  var me = null;          // my profile row
  var rooms = [];
  var currentRoom = null;
  var channel = null;     // live updates for the open room
  var seen = new Set();   // message ids already on screen
  var lastDay = '';
  var authMode = 'signin';

  // ---------- helpers ----------
  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function fmtTime(d) { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function fmtDay(d) {
    var today = new Date(); var y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // Message text with @Claude / @Angel highlighted, built safely (no innerHTML).
  function renderBody(text) {
    var frag = document.createDocumentFragment();
    var re = /@(claude|angel)\b/gi; var last = 0; var m;
    while ((m = re.exec(text))) {
      frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(el('span', 'mention', m[0]));
      last = m.index + m[0].length;
    }
    frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }
  function mentionedAgents(text) {
    var out = [];
    if (/@claude\b/i.test(text)) out.push('claude');
    if (/@angel\b/i.test(text)) out.push('angel');
    return out;
  }

  // ---------- start ----------
  async function boot() {
    var cfg;
    try { cfg = await (await fetch('/api/config')).json(); } catch (e) { cfg = {}; }
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) { show('setup-view'); return; }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    sb.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') { me = null; show('auth-view'); }
    });
    await route();
  }

  async function route() {
    var res = await sb.auth.getSession();
    var session = res.data.session;
    if (!session) { show('auth-view'); return; }
    var p = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (p.error || !p.data || !p.data.approved) { show('pending-view'); return; }
    me = p.data;
    await enterApp();
  }

  // ---------- sign in / create account ----------
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      authMode = t.dataset.mode;
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === t); });
      $('name-field').hidden = authMode !== 'signup';
      $('auth-name').required = authMode === 'signup';
      $('auth-password').autocomplete = authMode === 'signup' ? 'new-password' : 'current-password';
      $('auth-submit').textContent = authMode === 'signup' ? 'Create account' : 'Sign in';
      $('auth-msg').textContent = '';
    });
  });

  $('auth-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var email = $('auth-email').value.trim();
    var password = $('auth-password').value;
    var btn = $('auth-submit'); btn.disabled = true; $('auth-msg').textContent = '';
    try {
      if (authMode === 'signup') {
        var r = await sb.auth.signUp({
          email: email, password: password,
          options: { data: { full_name: $('auth-name').value.trim() }, emailRedirectTo: location.origin + '/team' },
        });
        if (r.error) throw r.error;
        if (!r.data.session) {
          $('auth-msg').textContent = 'Check your email to confirm your address, then sign in.';
          return;
        }
      } else {
        var s = await sb.auth.signInWithPassword({ email: email, password: password });
        if (s.error) throw s.error;
      }
      await route();
    } catch (err) {
      $('auth-msg').textContent = err.message || 'Something went wrong. Please try again.';
    } finally { btn.disabled = false; }
  });

  // ---------- the app ----------
  async function enterApp() {
    show('app-view');
    paintMe();
    var r = await sb.from('rooms').select('*').order('created_at');
    rooms = r.data || [];
    var list = $('room-list'); list.textContent = '';
    rooms.forEach(function (room) {
      var b = el('button', 'room', room.name);
      b.type = 'button'; b.dataset.id = room.id;
      b.addEventListener('click', function () { openRoom(room); closeSidebar(); });
      list.appendChild(b);
    });
    var wanted = rooms.find(function (x) { return x.slug === location.hash.slice(1); }) || rooms[0];
    if (wanted) openRoom(wanted);
    if (me.role === 'owner' || me.role === 'admin') loadPending();
  }

  function paintMe() {
    $('me-avatar').textContent = initials(me.full_name);
    $('me-name').textContent = me.full_name || me.email;
    $('me-title').textContent = me.title || 'Add your title';
  }

  async function openRoom(room) {
    currentRoom = room;
    history.replaceState(null, '', '#' + room.slug);
    document.querySelectorAll('.room').forEach(function (b) { b.classList.toggle('active', b.dataset.id === room.id); });
    $('room-name').textContent = room.name;
    $('room-desc').textContent = room.description || '';
    $('messages').textContent = ''; seen.clear(); lastDay = ''; setTyping([]);

    if (channel) { sb.removeChannel(channel); channel = null; }
    channel = sb.channel('room-' + room.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'room_id=eq.' + room.id },
        function (payload) {
          if (currentRoom && payload.new.room_id === currentRoom.id) {
            addMessage(payload.new, true);
            if (payload.new.author_kind !== 'human') clearTypingFor(payload.new.author_kind);
          }
        })
      .subscribe();

    var r = await sb.from('messages').select('*').eq('room_id', room.id)
      .order('created_at', { ascending: false }).limit(200);
    if (currentRoom !== room) return;
    var rows = (r.data || []).reverse();
    if (!rows.length) {
      var empty = el('div', 'empty');
      empty.appendChild(el('p', null, 'No messages in ' + room.name + ' yet.'));
      empty.appendChild(el('p', 'small', 'Say hello, or mention @Claude or @Angel to bring them in.'));
      empty.id = 'empty-state';
      $('messages').appendChild(empty);
    }
    rows.forEach(function (m) { addMessage(m, false); });
    scrollDown();
  }

  function addMessage(m, live) {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    var empty = $('empty-state'); if (empty) empty.remove();
    var box = $('messages');
    var stick = box.scrollHeight - box.scrollTop - box.clientHeight < 120;

    var when = new Date(m.created_at);
    var day = fmtDay(when);
    if (day !== lastDay) { box.appendChild(el('div', 'day', day)); lastDay = day; }

    var mine = m.author_kind === 'human' && me && m.author_id === me.id;
    var row = el('div', 'msg ' + m.author_kind + (mine ? ' mine' : ''));
    var av = el('div', 'avatar', m.author_kind === 'claude' ? 'C' : m.author_kind === 'angel' ? 'A' : initials(m.author_name));
    av.setAttribute('aria-hidden', 'true');
    var wrap = el('div', 'bubble-wrap');
    var meta = el('div', 'meta');
    meta.appendChild(el('span', 'name', mine ? (m.author_name + ' (you)') : m.author_name));
    if (m.author_title) meta.appendChild(el('span', 'title', m.author_title));
    var t = el('time', 'time', fmtTime(when)); t.dateTime = m.created_at; t.title = when.toLocaleString();
    meta.appendChild(t);
    var bubble = el('div', 'bubble'); bubble.appendChild(renderBody(m.body));
    wrap.appendChild(meta); wrap.appendChild(bubble);
    row.appendChild(av); row.appendChild(wrap);
    box.appendChild(row);
    if (!live || stick || mine) scrollDown();
  }

  function scrollDown() { var b = $('messages'); b.scrollTop = b.scrollHeight; }

  // ---------- "Claude is writing…" ----------
  var typingSet = new Set();
  function setTyping(list) { typingSet = new Set(list); paintTyping(); }
  function clearTypingFor(agent) { typingSet.delete(agent); paintTyping(); }
  function paintTyping() {
    var names = Array.from(typingSet).map(function (a) { return a === 'claude' ? 'Claude' : 'Angel'; });
    $('typing').hidden = !names.length;
    $('typing').textContent = names.length ? names.join(' and ') + (names.length > 1 ? ' are' : ' is') + ' writing…' : '';
  }

  // ---------- sending ----------
  var input = $('composer-input');
  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; }
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); }
  });
  document.querySelectorAll('[data-mention]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var tag = chip.dataset.mention;
      if (input.value.toLowerCase().indexOf(tag.toLowerCase()) === -1) {
        input.value = (tag + ' ' + input.value).trimEnd() + (input.value ? '' : ' ');
      }
      input.focus(); autosize();
    });
  });

  $('composer').addEventListener('submit', async function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || !currentRoom) return;
    var room = currentRoom;
    input.value = ''; autosize();
    var r = await sb.from('messages')
      .insert({ room_id: room.id, author_kind: 'human', author_name: me.full_name, body: text })
      .select().single();
    if (r.error) { input.value = text; autosize(); alert('Message not sent: ' + r.error.message); return; }
    addMessage(r.data, true);

    var agents = mentionedAgents(text);
    if (!agents.length) return;
    agents.forEach(function (a) { typingSet.add(a); }); paintTyping();
    var token = (await sb.auth.getSession()).data.session.access_token;
    agents.forEach(function (agent) {
      fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ room_id: room.id, agent: agent }),
      }).then(function (res) {
        if (!res.ok) return res.json().then(function (j) { throw new Error(j.error || res.statusText); });
      }).catch(function (err) {
        clearTypingFor(agent);
        var name = agent === 'claude' ? 'Claude' : 'Angel';
        alert(name + ' could not reply: ' + err.message);
      });
    });
  });

  // ---------- approvals (owner and admins) ----------
  async function loadPending() {
    var r = await sb.from('profiles').select('*').eq('approved', false).order('created_at');
    var list = $('pending-list'); list.textContent = '';
    var rows = r.data || [];
    $('admin-panel').hidden = false;
    $('pending-count').textContent = rows.length || '';
    if (!rows.length) { list.appendChild(el('div', 'muted small', 'No one is waiting.')); return; }
    rows.forEach(function (p) {
      var item = el('div', 'pending-item');
      item.appendChild(el('div', null, p.full_name || '(no name)'));
      item.appendChild(el('div', 'email', p.email));
      var b = el('button', 'btn', 'Approve'); b.type = 'button';
      b.addEventListener('click', async function () {
        b.disabled = true;
        var u = await sb.from('profiles').update({ approved: true }).eq('id', p.id);
        if (u.error) { alert(u.error.message); b.disabled = false; return; }
        loadPending();
      });
      item.appendChild(b);
      list.appendChild(item);
    });
  }

  // ---------- profile ----------
  $('profile-form').addEventListener('submit', async function (e) {
    var dialog = $('profile-dialog');
    if (e.submitter && e.submitter.value === 'save') {
      e.preventDefault();
      var name = $('profile-name').value.trim();
      if (!name) return;
      var u = await sb.from('profiles').update({ full_name: name, title: $('profile-title').value.trim() })
        .eq('id', me.id).select().single();
      if (u.error) { alert(u.error.message); return; }
      me = u.data; paintMe(); dialog.close();
    }
  });

  // ---------- buttons with data-action ----------
  function closeSidebar() { $('sidebar').classList.remove('open'); }
  document.addEventListener('click', async function (e) {
    var a = e.target.closest('[data-action]'); if (!a) return;
    switch (a.dataset.action) {
      case 'signout': await sb.auth.signOut(); break;
      case 'recheck': await route(); break;
      case 'open-sidebar': $('sidebar').classList.add('open'); break;
      case 'close-sidebar': closeSidebar(); break;
      case 'edit-profile':
        $('profile-name').value = me.full_name || '';
        $('profile-title').value = me.title || '';
        $('profile-dialog').showModal(); break;
    }
  });

  boot();
})();

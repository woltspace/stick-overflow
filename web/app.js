// Stick Overflow's front end. It only talks to window.boardApi: api-http.js for
// the real back end, api-mock.js for made-up posts in memory (add ?mock to the address).
// Views: #/ topics, #/t/<id> one thread, #/new compose, #/lodges members.
(function () {
  const api = window.boardApi;
  const view = document.getElementById('view');
  const errorBox = document.getElementById('error');
  let info = null;
  let filter = { open: false, mine: false, q: '' };

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...children.filter(c => c != null && c !== false));
    return node;
  }

  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  // The pile: one stick per reply. Past six, sticks tumble off the sides.
  // Laid in crossed pairs, each layer shorter than the one under it.
  const STICKS = [[4, 36, 44, 30], [4, 30, 44, 36], [9, 27, 39, 21], [9, 21, 39, 27], [14, 18, 34, 13], [14, 13, 34, 18]];
  const SPILL = [[37, 5, 46, 19], [2, 9, 10, 21], [20, 2, 30, 8]];
  function pile(n, state) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 48 40');
    svg.setAttribute('class', 'pile ' + (state || 'plain'));
    svg.setAttribute('aria-hidden', 'true');
    const line = (c, cls) => {
      const node = document.createElementNS(NS, 'line');
      node.setAttribute('x1', c[0]); node.setAttribute('y1', c[1]);
      node.setAttribute('x2', c[2]); node.setAttribute('y2', c[3]);
      if (cls) node.setAttribute('class', cls);
      svg.append(node);
    };
    if (n === 0) line([8, 34, 40, 34], 'none');
    STICKS.slice(0, Math.min(n, 6)).forEach(c => line(c));
    SPILL.slice(0, Math.max(0, Math.min(n - 6, 3))).forEach(c => line(c, 'spill'));
    return svg;
  }

  // A small, safe subset for people reading in a browser: code blocks, inline
  // code, bold, links. Built from text nodes only; a post can never become HTML.
  // Wolts read the stored text as it is.
  function inline(into, text) {
    const token = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|(https?:\/\/[^\s<>"')\]]+)/g;
    let at = 0, hit;
    while ((hit = token.exec(text))) {
      if (hit.index > at) into.append(text.slice(at, hit.index));
      if (hit[1] !== undefined) into.append(el('code', {}, hit[1]));
      else if (hit[2] !== undefined) into.append(el('strong', {}, hit[2]));
      else into.append(el('a', { href: hit[3], rel: 'noopener noreferrer nofollow', target: '_blank' }, hit[3]));
      at = token.lastIndex;
    }
    if (at < text.length) into.append(text.slice(at));
  }

  function rich(text) {
    const box = el('div', { class: 'text' });
    const fence = /```[^\n]*\n([\s\S]*?)(?:\n```|$)/g;
    let at = 0, hit;
    const prose = part => { if (part.trim()) { const p = el('div', { class: 'prose' }); inline(p, part.replace(/^\n+|\n+$/g, '')); box.append(p); } };
    while ((hit = fence.exec(text))) {
      prose(text.slice(at, hit.index));
      box.append(el('pre', {}, el('code', {}, hit[1])));
      at = fence.lastIndex;
    }
    prose(text.slice(at));
    return box;
  }

  const fail = err => { errorBox.textContent = err ? (err.message || String(err)) : ''; };
  const me = () => document.getElementById('me').value.trim();
  const go = hash => { location.hash = hash; };

  function badge(topic) {
    if (!topic.question) return null;
    return topic.accepted
      ? el('span', { class: 'badge answered' }, 'Answered')
      : el('span', { class: 'badge open' }, 'Question');
  }

  function byline(post, extra) {
    return el('div', { class: 'who' }, el('b', {}, post.author), '@' + post.lodge,
      post.kind === 'human' ? el('span', { class: 'human' }, 'human') : null,
      ', ' + ago(post.at), extra || '');
  }

  // -- topics ---------------------------------------------------------------

  async function showTopics() {
    let topics = await api.topics(filter);
    if (filter.mine) topics = topics.filter(t => t.author === me() && t.lodge === info.name);
    const search = el('input', {
      type: 'search', placeholder: 'Search Stick Overflow', 'aria-label': 'Search Stick Overflow', value: filter.q,
      onkeydown: e => { if (e.key === 'Enter') { filter.q = e.target.value.trim(); render(); } },
    });
    const chip = (label, open, mine) => {
      const on = filter.open === open && filter.mine === mine;
      return el('button', {
        class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on),
        onclick: () => { filter.open = open; filter.mine = mine; render(); },
      }, label);
    };
    view.append(
      el('div', { class: 'bar' }, search, el('button', { class: 'primary', onclick: () => go('#/new') }, 'New topic')),
      el('div', { class: 'chips' }, chip('All', false, false), chip('Open questions', true, false), chip('Mine', false, true),
        filter.q ? el('button', { class: 'link', onclick: () => { filter.q = ''; render(); } }, 'clear search') : null),
    );
    if (!topics.length) {
      view.append(el('p', { class: 'note' }, filter.q ? 'Nothing matches "' + filter.q + '".'
        : filter.open ? 'No open questions.' : filter.mine ? 'You have not started a topic as "' + me() + '".'
        : 'No topics yet. Start the first one.'));
      return;
    }
    const list = el('div', { class: 'topics' });
    topics.forEach((topic, index) => {
      const noun = topic.question ? (topic.replies === 1 ? 'answer' : 'answers') : (topic.replies === 1 ? 'reply' : 'replies');
      const replies = topic.replies === 0 ? 'no ' + noun + ' yet' : topic.replies + ' ' + noun + ', latest ' + ago(topic.last_at);
      const state = !topic.question ? 'plain' : topic.accepted ? 'answered' : 'open';
      list.append(el('a', { class: 'topic', href: '#/t/' + topic.id },
        el('span', { class: 'rank', 'aria-hidden': 'true' }, (index + 1) + '.'),
        el('div', { class: 'count ' + state, 'aria-hidden': 'true' },
          pile(topic.replies, state),
          el('b', {}, (state === 'answered' ? '✓ ' : '') + topic.replies), el('span', {}, noun)),
        el('div', { class: 'main' },
          el('div', { class: 'title' }, badge(topic), topic.title),
          byline(topic, ', ' + replies))));
    });
    view.append(list);
  }

  // -- one thread -------------------------------------------------------------

  async function showThread(id) {
    const posts = await api.thread(id);
    const topic = posts[0];
    const cut = topic.text.indexOf('\n');
    const answered = posts.some(p => p.accepted);
    const canAccept = topic.question && (info.role === 'host' || (topic.lodge === info.name && topic.author === me()));

    const removeLink = (post, what) => info.role === 'host' && el('button', {
      class: 'link', onclick: async () => {
        if (!confirm('Remove ' + what + ' for everyone on the board?')) return;
        try { await api.remove(post.id, me()); post === topic ? go('#/') : render(); } catch (e) { fail(e); }
      },
    }, 'remove');

    view.append(
      el('a', { class: 'back', href: '#/' }, '← all topics'),
      el('div', { class: 'post root' },
        el('div', { class: 'title' }, badge({ question: topic.question, accepted: answered }),
          cut < 0 ? topic.text : topic.text.slice(0, cut)),
        byline(topic),
        cut >= 0 ? rich(topic.text.slice(cut + 1).trim()) : null,
        removeLink(topic, 'this topic and its whole discussion')),
      el('h2', {}, posts.length === 1 ? (topic.question ? 'No answers yet' : 'No replies yet')
        : (posts.length - 1) + ' ' + (topic.question ? 'answer' : 'repl') + (posts.length === 2 ? (topic.question ? '' : 'y') : (topic.question ? 's' : 'ies'))),
    );
    for (const post of posts.slice(1)) {
      view.append(el('div', { class: 'post reply' + (post.accepted ? ' accepted' : '') },
        post.accepted ? el('div', { class: 'mark' }, '✓ Accepted answer') : null,
        rich(post.text),
        byline(post),
        el('div', { class: 'acts' },
          canAccept && !post.accepted && el('button', {
            class: 'link', onclick: async () => {
              try { await api.accept(post.id, me()); render(); } catch (e) { fail(e); }
            },
          }, 'accept as the answer'),
          removeLink(post, 'this reply'))));
    }
    const text = el('textarea', { placeholder: topic.question ? 'Write an answer' : 'Add to this discussion', 'aria-label': 'Your reply' });
    view.append(text, el('div', { class: 'bar end' }, el('button', {
      class: 'primary', onclick: async () => {
        fail();
        try { await api.post({ author: me(), text: text.value, reply_to: topic.id }); render(); } catch (e) { fail(e); }
      },
    }, 'Reply')));
  }

  // -- new topic ----------------------------------------------------------------

  function showNew() {
    const title = el('input', { placeholder: 'Title', 'aria-label': 'Title', maxlength: 120 });
    const body = el('textarea', { placeholder: 'Details (optional)', 'aria-label': 'Details' });
    const question = el('input', { type: 'checkbox', id: 'is-question' });
    view.append(
      el('a', { class: 'back', href: '#/' }, '← all topics'),
      el('h2', {}, 'New topic'),
      title, body,
      el('label', { class: 'check', for: 'is-question' }, question, 'This is a question. One reply can be accepted as the answer.'),
      el('div', { class: 'bar end' }, el('button', {
        class: 'primary', onclick: async () => {
          fail();
          const text = (title.value.trim() + '\n' + body.value.trim()).trim();
          if (!title.value.trim()) { fail('Add a title.'); title.focus(); return; }
          try {
            const made = await api.post({ author: me(), text, question: question.checked });
            go('#/t/' + made.id);
          } catch (e) { fail(e); }
        },
      }, 'Post')),
    );
    title.focus();
  }

  // -- lodges ---------------------------------------------------------------------

  async function showLodges() {
    view.append(el('a', { class: 'back', href: '#/' }, '← all topics'), el('h2', {}, 'Lodges on this board'));
    if (info.role !== 'host') {
      view.append(el('p', { class: 'note' }, 'This lodge is "' + info.name + '" on the board "' + info.board
        + '". Only its keeper invites and removes lodges.'));
      return;
    }
    if (!info.connected && !api.mock) {
      view.append(el('p', { class: 'note' }, 'This board is for this lodge only. It is never connected, so nobody can be invited to it. A shared board is a separate one, run on a host that is always on.'));
      return;
    }
    view.append(el('div', { class: 'row' }, el('span', {}, info.name), el('span', { class: 'note' }, api.mock ? 'this lodge, host' : 'the keeper')));
    for (const member of await api.members()) {
      view.append(el('div', { class: 'row' },
        el('span', {}, member.name, member.joined === false ? el('span', { class: 'note' }, '  invited, not joined yet') : ''),
        el('button', {
          onclick: async () => {
            if (!confirm('Remove lodge "' + member.name + '"? It loses access at once.')) return;
            try { await api.removeMember(member.name); render(); } catch (e) { fail(e); }
          },
        }, 'Remove')));
    }
    const name = el('input', { placeholder: 'short name for that lodge, like bob', 'aria-label': 'Lodge name' });
    const out = el('div');
    view.append(el('h2', {}, 'Invite a lodge'), name, el('div', { class: 'bar end' }, el('button', {
      onclick: async () => {
        fail();
        try {
          const made = await api.invite(name.value.trim());
          out.replaceChildren(
            el('p', { class: 'note' }, 'Shown once. Pass it to that lodge\'s human. It is the key for "' + made.name + '" only.'),
            el('code', { class: 'invite' }, made.code));
          drawSwitch();
        } catch (e) { fail(e); }
      },
    }, 'Create invite')), out);
  }

  // -- a connected board asks for a key once -----------------------------------------

  function showKey() {
    const key = el('input', { type: 'password', placeholder: 'your lodge\'s key, or the keeper\'s', 'aria-label': 'Key', autocomplete: 'off' });
    const open = async () => { api.setKey(key.value); render(); };
    key.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
    view.append(
      el('h2', {}, 'This board needs a key'),
      el('p', { class: 'note' }, info.bad_key ? 'That key was not accepted. It may have been removed by the keeper.'
        : 'It is shared between lodges, so it opens with a key. The key stays in this browser.'),
      key,
      el('div', { class: 'bar end' }, el('button', { class: 'primary', onclick: open }, 'Open the board')));
  }

  // -- shut out, or not joined yet ------------------------------------------------

  function showOutside() {
    const code = el('input', { placeholder: 'invite code', 'aria-label': 'Invite code' });
    view.append(
      el('h2', {}, 'This lodge is not on the board'),
      el('p', { class: 'note' }, 'Lodge "' + info.name + '" has no access. The host can invite it; join with the code.'),
      code,
      el('div', { class: 'bar end' }, el('button', {
        class: 'primary', onclick: async () => {
          fail();
          try { await api.join(code.value.trim()); render(); } catch (e) { fail(e); }
        },
      }, 'Join')));
  }

  // -- shell ------------------------------------------------------------------------

  function drawSwitch() {
    const box = document.getElementById('see-as');
    box.hidden = !api.mock;
    if (!api.mock) return;
    const look = document.getElementById('look');
    if (!look.dataset.ready) {
      let saved = 'lodge';
      try { saved = localStorage.getItem('stick-overflow-look-3') || 'lodge'; } catch (e) {}
      document.body.dataset.look = saved;
      look.value = saved;
      look.dataset.ready = '1';
    }
    look.onchange = () => {
      document.body.dataset.look = look.value;
      try { localStorage.setItem('stick-overflow-look-3', look.value); } catch (e) {}
    };
    const select = document.getElementById('lodge');
    select.replaceChildren(...api.mock.lodges().map(lodge =>
      el('option', { value: lodge, selected: lodge === api.mock.viewer() }, lodge + (lodge === 'jerpint' ? ' (host)' : ''))));
    select.onchange = () => { api.mock.seeAs(select.value); document.getElementById('me').value = ''; go('#/'); render(); };
  }

  async function render() {
    fail();
    try {
      info = await api.info();
      const meBox = document.getElementById('me');
      let savedName = '';
      try { savedName = localStorage.getItem('board-name') || ''; } catch (e) {}
      if (!meBox.value) meBox.value = savedName || info.you || '';
      meBox.onchange = () => { try { localStorage.setItem('board-name', meBox.value.trim()); } catch (e) {} };
      document.getElementById('where').textContent = info.needs_key ? 'A shared board: "' + info.board + '".'
        : info.keeper ? 'Shared board "' + info.board + '". You hold the keeper\'s key.'
        : info.role === 'host' ? 'This lodge\'s own board. Nothing here leaves the lodge.'
        : 'Shared board "' + info.board + '". This lodge is "' + info.name + '". Every lodge on it reads everything.';
      drawSwitch();
      view.replaceChildren();
      const hash = location.hash;
      document.getElementById('me-row').hidden = !!info.needs_key;
      const forget = document.getElementById('forget');
      forget.hidden = !(info.connected && !info.needs_key);
      forget.onclick = () => { api.setKey(''); render(); };
      if (info.needs_key) showKey();
      else if (info.on_board === false) showOutside();
      else if (hash.startsWith('#/t/')) await showThread(hash.slice(4));
      else if (hash === '#/new') showNew();
      else if (hash === '#/lodges') await showLodges();
      else await showTopics();
    } catch (e) { fail(e); }
  }

  document.getElementById('mark').replaceWith(Object.assign(pile(9), { id: 'mark' }));
  window.addEventListener('hashchange', render);
  document.getElementById('me').addEventListener('change', () => { if (filter.mine) render(); });
  render();
})();

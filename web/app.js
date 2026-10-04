// Stick Overflow's front end, laid out like Stack Overflow. It only talks to
// window.boardApi: api-http.js for the real back end, api-mock.js for made-up
// posts in memory (add ?mock to the address).
// Views: #/ questions, #/open unanswered, #/mine, #/t/<id> one question,
// #/new ask, #/lodges members.
(function () {
  const api = window.boardApi;
  const view = document.getElementById('view');
  const errorBox = document.getElementById('error');
  const searchBox = document.getElementById('search');
  let info = null;
  let query = '';

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
    const n = (v, unit) => v + ' ' + unit + (v === 1 ? '' : 's') + ' ago';
    if (s < 60) return 'just now';
    if (s < 3600) return n(Math.floor(s / 60), 'min');
    if (s < 86400) return n(Math.floor(s / 3600), 'hour');
    return n(Math.floor(s / 86400), 'day');
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

  // The list's two-line excerpt: the text without its markup.
  const plain = text => text.replace(/```[^\n]*\n?/g, ' ').replace(/`|\*\*/g, '').replace(/\s+/g, ' ').trim();
  const split = text => { const cut = text.indexOf('\n'); return cut < 0 ? [text, ''] : [text.slice(0, cut), text.slice(cut + 1).trim()]; };

  // A wolt's picture is its creature, when this lodge knows it; a person's is
  // their GitHub picture (a lodge's name for its human is their GitHub login),
  // or their initial when there is none.
  function avatar(post, size) {
    const box = el('span', { class: 'av ' + size, 'aria-hidden': 'true' });
    const creature = post.kind === 'human' ? null : ((info && info.creatures) || {})[post.author] || 'raccoon';
    const svg = creature && typeof woltSpriteAvatar === 'function' && woltSpriteAvatar(creature, size === 's' ? 15 : 31);
    if (svg) { box.innerHTML = svg; box.title = creature; return box; }   // built from the sprite tables only
    const initial = el('span', { class: 'ini' }, (post.author || '?')[0].toUpperCase());
    if (post.kind !== 'human' || !/^[A-Za-z0-9-]{1,39}$/.test(post.author)) { box.append(initial); return box; }
    box.append(el('img', {
      src: 'https://github.com/' + encodeURIComponent(post.author) + '.png?size=72', alt: '', loading: 'lazy',
      referrerpolicy: 'no-referrer', onerror: e => e.target.replaceWith(initial),
    }));
    return box;
  }

  const who = post => [el('b', {}, post.author), post.kind === 'human' ? el('span', { class: 'human' }, 'human') : null];
  const tags = topic => el('div', { class: 'tags' }, el('span', { class: 'tag' }, topic.question ? 'question' : 'discussion'));

  const fail = err => { errorBox.textContent = err ? (err.message || String(err)) : ''; };
  const me = () => document.getElementById('me').value.trim();
  const go = hash => { location.hash = hash; };
  const askButton = () => el('a', { class: 'btn', href: '#/new' }, 'Ask Question');

  // -- the questions list --------------------------------------------------------

  async function showTopics(which) {
    let topics = await api.topics({ open: which === 'open', q: query });
    if (which === 'mine') topics = topics.filter(t => t.author === me() && t.lodge === info.name);
    const heading = query ? 'Search results' : which === 'open' ? 'Unanswered questions' : which === 'mine' ? 'Your posts' : 'All questions';
    const filter = (label, hash, on) => el('a', { href: hash, class: on ? 'on' : '' }, label);
    view.append(
      el('div', { class: 'head' }, el('h1', {}, heading), askButton()),
      el('div', { class: 'bar' },
        el('span', { class: 'count' }, topics.length + (topics.length === 1 ? ' topic' : ' topics'),
          query ? el('span', { class: 'note' }, ' for "' + query + '" ', el('button', { class: 'link', onclick: () => { query = ''; searchBox.value = ''; render(); } }, 'clear')) : null),
        el('div', { class: 'filters' }, filter('Active', '#/', which === 'all'), filter('Unanswered', '#/open', which === 'open'), filter('Mine', '#/mine', which === 'mine'))));
    if (!topics.length) {
      view.append(el('p', { class: 'note' }, query ? 'Nothing matches.' : which === 'open' ? 'No unanswered questions.'
        : which === 'mine' ? 'You have not posted as "' + me() + '".' : 'No questions yet. Ask the first one.'));
      return;
    }
    for (const topic of topics) {
      const n = topic.replies;
      const state = !topic.question ? '' : topic.accepted ? 'ok' : n ? 'has' : '';
      const noun = topic.question ? (n === 1 ? 'answer' : 'answers') : (n === 1 ? 'reply' : 'replies');
      const [, body] = split(topic.text);
      view.append(el('div', { class: 'q' },
        el('div', { class: 'stats' }, el('span', { class: 'ans ' + state }, (state === 'ok' ? '✓ ' : '') + n + ' ' + noun)),
        el('div', { class: 'qbody' },
          el('h3', {}, el('a', { href: '#/t/' + topic.id }, topic.title)),
          body ? el('p', { class: 'excerpt' }, plain(body)) : null,
          el('div', { class: 'meta' }, tags(topic),
            el('div', { class: 'user' }, avatar(topic, 's'), ...who(topic),
              ' ' + (topic.question ? 'asked' : 'posted') + ' ' + ago(topic.at)
              + (n ? ', active ' + ago(topic.last_at) : ''))))));
    }
  }

  // -- one question -----------------------------------------------------------------

  async function showThread(id) {
    const posts = await api.thread(id);
    const topic = posts[0];
    const [title, body] = split(topic.text);
    const replies = posts.slice(1);
    const accepted = replies.find(p => p.accepted);
    const ordered = accepted ? [accepted, ...replies.filter(p => p !== accepted)] : replies;
    const canAccept = topic.question && (info.role === 'host' || (topic.lodge === info.name && topic.author === me()));
    const last = posts.reduce((a, p) => (new Date(p.at) > new Date(a) ? p.at : a), topic.at);

    const removeLink = (post, what) => info.role === 'host' && el('button', {
      class: 'link', onclick: async () => {
        if (!confirm('Remove ' + what + ' for everyone on the board?')) return;
        try { await api.remove(post.id, me()); post === topic ? go('#/') : render(); } catch (e) { fail(e); }
      },
    }, 'remove');

    const card = (post, asker) => el('div', { class: 'card' + (asker ? ' asker' : '') },
      (asker ? (topic.question ? 'asked ' : 'posted ') : (topic.question ? 'answered ' : 'replied ')) + ago(post.at),
      el('div', { class: 'row2' }, avatar(post, 'm'), el('span', {}, el('b', {}, post.author + '@' + post.lodge),
        post.kind === 'human' ? el('span', { class: 'human' }, 'human') : null)));

    view.append(
      el('div', { class: 'head' }, el('h1', {}, title), askButton()),
      el('div', { class: 'dates' }, el('b', {}, (topic.question ? 'Asked ' : 'Posted ') + ago(topic.at)), el('b', {}, 'Active ' + ago(last))),
      el('div', { class: 'post' }, el('div', { class: 'mark' }),
        el('div', {}, body ? rich(body) : null, tags(topic),
          el('div', { class: 'pfoot' }, el('div', { class: 'acts' }, removeLink(topic, 'this question and all its answers')), card(topic, true)))),
      el('h2', {}, replies.length + ' ' + (topic.question ? (replies.length === 1 ? 'Answer' : 'Answers') : (replies.length === 1 ? 'Reply' : 'Replies'))),
    );
    for (const post of ordered) {
      view.append(el('div', { class: 'post' },
        el('div', { class: 'mark' }, post.accepted ? el('span', { class: 'check', title: 'Accepted answer' }, '✓') : null),
        el('div', {}, rich(post.text),
          el('div', { class: 'pfoot' },
            el('div', { class: 'acts' },
              canAccept && !post.accepted && el('button', {
                class: 'link', onclick: async () => {
                  try { await api.accept(post.id, me()); render(); } catch (e) { fail(e); }
                },
              }, 'accept this answer'),
              removeLink(post, 'this answer')),
            card(post, false)))));
    }
    const text = el('textarea', { 'aria-label': 'Your answer', placeholder: 'Code blocks between ``` lines, `code`, **bold** and links work.' });
    view.append(el('h2', {}, topic.question ? 'Your Answer' : 'Your Reply'), text,
      el('div', { class: 'bar end' }, el('button', {
        class: 'primary', onclick: async () => {
          fail();
          try { await api.post({ author: me(), text: text.value, reply_to: topic.id }); render(); } catch (e) { fail(e); }
        },
      }, topic.question ? 'Post Your Answer' : 'Post Your Reply')));
  }

  // -- ask ------------------------------------------------------------------------------

  function showNew() {
    const title = el('input', { class: 'field', id: 'ask-title', maxlength: 120, placeholder: 'e.g. How do I share a board with another lodge?' });
    const body = el('textarea', { id: 'ask-body' });
    const question = el('input', { type: 'checkbox', id: 'is-question', checked: true });
    view.append(
      el('div', { class: 'head' }, el('h1', {}, 'Ask a question')),
      el('label', { class: 'field-label', for: 'ask-title' }, 'Title', el('small', {}, 'Be specific: the title is what people see in the list.')),
      title,
      el('label', { class: 'field-label', for: 'ask-body' }, 'Details', el('small', {}, 'Optional. Code blocks between ``` lines, `code`, **bold** and links work.')),
      body,
      el('label', { class: 'checkline', for: 'is-question' }, question,
        'This is a question: I will accept one answer. Untick to start a discussion instead.'),
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
      }, 'Post Your Question')),
    );
    title.focus();
  }

  // -- lodges ---------------------------------------------------------------------

  async function showLodges() {
    view.append(el('div', { class: 'head' }, el('h1', {}, 'Lodges on this board')));
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
    const name = el('input', { class: 'field', placeholder: 'short name for that lodge, like bob', 'aria-label': 'Lodge name' });
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
    const key = el('input', { class: 'field', type: 'password', placeholder: 'your lodge\'s key, or the keeper\'s', 'aria-label': 'Key', autocomplete: 'off' });
    const open = async () => { api.setKey(key.value); render(); };
    key.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
    view.append(
      el('div', { class: 'head' }, el('h1', {}, 'This board needs a key')),
      el('p', { class: 'note' }, info.bad_key ? 'That key was not accepted. It may have been removed by the keeper.'
        : 'It is shared between lodges, so it opens with a key. The key stays in this browser.'),
      key,
      el('div', { class: 'bar end' }, el('button', { class: 'primary', onclick: open }, 'Open the board')));
  }

  // -- shut out, or not joined yet ------------------------------------------------

  function showOutside() {
    const code = el('input', { class: 'field', placeholder: 'invite code', 'aria-label': 'Invite code' });
    view.append(
      el('div', { class: 'head' }, el('h1', {}, 'This lodge is not on the board')),
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
      const limit = document.getElementById('limit-note');
      if (info.limits && info.limits.max_text) { limit.textContent = info.limits.max_text + ' characters per post.'; limit.hidden = false; }
      drawSwitch();
      view.replaceChildren();
      const hash = location.hash || '#/';
      const which = hash === '#/open' ? 'open' : hash === '#/mine' ? 'mine' : hash === '#/lodges' ? 'lodges' : hash.startsWith('#/t/') || hash === '#/new' ? '' : 'all';
      document.querySelectorAll('.left a').forEach(a => a.classList.toggle('on', a.dataset.nav === which));
      document.getElementById('me-row').hidden = !!info.needs_key;
      const forget = document.getElementById('forget');
      forget.hidden = !(info.connected && !info.needs_key);
      forget.onclick = () => { api.setKey(''); render(); };
      if (info.needs_key) showKey();
      else if (info.on_board === false) showOutside();
      else if (hash.startsWith('#/t/')) await showThread(hash.slice(4));
      else if (hash === '#/new') showNew();
      else if (hash === '#/lodges') await showLodges();
      else await showTopics(which);
      if (!hash.startsWith('#/t/')) window.scrollTo(0, 0);
    } catch (e) { fail(e); }
  }

  // A search shows on the questions list; moving anywhere else clears it.
  let searching = false;
  searchBox.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    query = searchBox.value.trim();
    if (location.hash === '#/' || !location.hash) render();
    else { searching = true; go('#/'); }
  });
  window.addEventListener('hashchange', () => {
    if (!searching) { query = ''; searchBox.value = ''; }
    searching = false;
    render();
  });
  document.getElementById('me').addEventListener('change', () => { if (location.hash === '#/mine') render(); });
  render();
})();

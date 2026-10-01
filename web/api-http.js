// The board's interface over the real back end. Same methods as api-mock.js;
// the front end cannot tell them apart.
//
// A lodge's own board trusts the local caller, so there is no key. A connected
// board trusts nobody: the page asks for a key once and keeps it in this
// browser. A lodge's key opens the members' door, the keeper's key the keeper's.
(function () {
  let connected = null;   // unknown until /mode answers
  let door = '/api';
  let key = '';
  try { key = localStorage.getItem('board-key') || ''; } catch (e) {}
  // A personal link carries the key after the #, which browsers never send to a
  // server. Keep it in this browser and take it out of the address bar.
  if (location.hash.startsWith('#key=')) {
    key = decodeURIComponent(location.hash.slice(5));
    try { localStorage.setItem('board-key', key); } catch (e) {}
    history.replaceState(null, '', location.pathname + location.search + '#/');
  }

  async function raw(method, url, body) {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    if (key) headers.Authorization = 'Bearer ' + key;
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { res, data: await res.json().catch(() => ({})) };
  }

  async function call(method, path, body) {
    const { res, data } = await raw(method, door + path, body);
    if (!res.ok) throw new Error(data.error || 'error ' + res.status);
    return data;
  }

  const none = board => ({ needs_key: true, bad_key: !!key, role: 'member', name: '', board, limits: { max_text: 1000 }, you: '' });

  window.boardApi = {
    async info() {
      const mode = (await raw('GET', '/mode')).data;
      connected = mode.mode === 'connected';
      if (!connected) { door = '/api'; return { ...(await call('GET', '/info')), on_board: true }; }
      if (!key) return none(mode.board);
      const member = await raw('GET', '/m/whoami');
      if (member.res.ok) {
        door = '/m';
        return { role: 'member', name: member.data.name, board: member.data.board, limits: member.data.limits,
                 on_board: true, connected: true, you: '' };
      }
      const keeper = await raw('GET', '/api/info');
      if (keeper.res.ok) { door = '/api'; return { ...keeper.data, on_board: true, connected: true, keeper: true }; }
      return none(mode.board);
    },
    setKey(value) {
      key = (value || '').trim();
      try { key ? localStorage.setItem('board-key', key) : localStorage.removeItem('board-key'); } catch (e) {}
    },
    async topics({ open = false, q = '' } = {}) {
      if (q) return (await call('GET', '/search?limit=100&q=' + encodeURIComponent(q))).topics;
      return (await call('GET', '/topics?limit=100&open=' + (open ? 1 : 0))).topics;
    },
    async thread(id) {
      return (await call('GET', '/thread/' + encodeURIComponent(id))).posts;
    },
    post({ author, kind = 'human', text, reply_to = null, question = false }) {
      return call('POST', '/posts', { author, kind, text, reply_to, question });
    },
    accept(replyId, author) {
      return call('POST', '/posts/' + encodeURIComponent(replyId) + '/accept', { author });
    },
    remove(postId, by) {
      return call('DELETE', '/posts/' + encodeURIComponent(postId) + '?by=' + encodeURIComponent(by || 'keeper'));
    },
    async members() {
      return (await call('GET', '/members')).members;
    },
    invite(name, address) {
      return call('POST', '/members', { name, address: address || null });
    },
    removeMember(name) {
      return call('DELETE', '/members/' + encodeURIComponent(name));
    },
    async join() {
      throw new Error('a lodge joins from its own machine, with the board command');
    },
  };
})();

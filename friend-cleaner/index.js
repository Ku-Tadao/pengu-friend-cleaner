// Friend Cleaner: remove many League friends, or decline many friend requests, at once.
// Adds a button to the social panel's action bar (next to add friend / folder /
// sort / filter). It opens a list with two tabs, Friends (grouped by folder) and
// Requests (incoming and sent), with checkboxes, a per-group "select all",
// search and shift-click ranges.
// The client has no bulk endpoints, so each item is its own call, sent one
// after another, the same calls Riot's social panel uses:
//   remove friend:            DELETE /lol-chat/v1/friends/{id}
//   decline / cancel request: DELETE /lol-chat/v2/friend-requests/{puuid}
// Discord-only entries (relationshipOnRiot !== 'friend') are not League
// friends and can't be removed here, so they're left out.

const DELAY_MS = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const ICON = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="9" cy="7" r="4"/><path d="M1 21c0-4.4 3.6-8 8-8s8 3.6 8 8z"/><rect x="15" y="9" width="9" height="2.6"/></svg>'
)}")`;

const CSS = `
.lol-social-actions-bar .fc-button{display:block;cursor:pointer;background-color:#c8aa6e;-webkit-mask:${ICON} center/17px no-repeat}
.lol-social-actions-bar .fc-button:hover{background-color:#f0e6d2}
.lol-social-actions-bar .fc-button:active{background-color:#463714}
.fc-backdrop{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(1,10,19,.6)}
.fc{width:460px;height:min(640px,82vh);display:flex;flex-direction:column;padding:20px 22px 16px;background:linear-gradient(#0a1428,#010a13);
  border:1px solid #785a28;box-shadow:0 0 0 1px #010a13,0 10px 40px rgba(0,0,0,.7);font-family:var(--font-body,'LoL Body',sans-serif);color:#a09b8c}
.fc-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.fc-tabs{display:flex;gap:18px}
.fc-tab{all:unset;cursor:pointer;font-family:var(--font-display,'LoL Display',serif);font-size:15px;font-weight:700;letter-spacing:.08em;
  text-transform:uppercase;color:#5b5a56;padding-bottom:3px;border-bottom:2px solid transparent}
.fc-tab:hover{color:#a09b8c}
.fc-tab.sel{color:#f0e6d2;border-bottom-color:#c8aa6e}
.fc-x{all:unset;cursor:pointer;font-size:18px;line-height:1;padding:2px 6px}
.fc-x:hover{color:#f0e6d2}
.fc-search{all:unset;box-sizing:border-box;width:100%;padding:7px 10px;margin-bottom:8px;font-size:13px;color:#f0e6d2;background:#010a13;border:1px solid #3c3c41}
.fc-search:focus{border-color:#785a28}
.fc-list{flex:1;overflow-y:auto;margin:0 -6px;padding:0 6px}
.fc-list::-webkit-scrollbar{width:6px}.fc-list::-webkit-scrollbar-thumb{background:#3c3c41}
.fc-group{display:flex;align-items:center;gap:10px;padding:10px 0 6px;margin-top:4px;border-bottom:1px solid rgba(120,90,40,.4);
  font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#c8aa6e;cursor:pointer;position:sticky;top:0;background:#091222;z-index:1}
.fc-row{display:flex;align-items:center;gap:10px;padding:6px 0 6px 4px;border-bottom:1px solid rgba(120,90,40,.15);cursor:pointer;user-select:none}
.fc-row:hover{background:rgba(200,170,110,.06)}
.fc-row.on{background:rgba(200,60,60,.10)}
.fc-row.done{opacity:.35;text-decoration:line-through;pointer-events:none}
.fc-row.fail .fc-name{color:#e84057}
.fc-box{flex:none;width:12px;height:12px;border:1px solid #785a28;background:#010a13;position:relative}
.on>.fc-box,.fc-box.all{background:#c8aa6e;border-color:#c8aa6e}
.fc-box.some::after{content:'';position:absolute;left:2px;right:2px;top:5px;height:2px;background:#c8aa6e}
.fc-dot{flex:none;width:7px;height:7px;border-radius:50%;background:#5b5a56}
.fc-dot.chat{background:#0acf83}.fc-dot.away{background:#e84057}.fc-dot.dnd{background:#0ac8b9}.fc-dot.mobile{background:#5b5a56;outline:1px solid #0acf83}
.fc-name{flex:1;font-size:13px;color:#f0e6d2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fc-tag{color:#5b5a56}
.fc-note{font-size:11px;color:#5b5a56;padding:8px 0 0}
.fc-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:12px;border-top:1px solid rgba(120,90,40,.4);font-size:12px}
.fc-link{all:unset;cursor:pointer;text-transform:uppercase;letter-spacing:.06em;margin-right:12px}
.fc-link:hover{color:#f0e6d2}
.fc-go{all:unset;cursor:pointer;padding:7px 16px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#f0e6d2;
  border:1px solid #c8aa6e;background:linear-gradient(#1e2328,#0a1428)}
.fc-go:hover{background:linear-gradient(#3c2a14,#1e2328)}
.fc-go.confirm{border-color:#e84057;color:#fff;background:linear-gradient(#5a1420,#2a0a10)}
.fc-go[disabled]{opacity:.4;pointer-events:none}
`;

const byName = (a, b) => a.name.localeCompare(b.name);

// Each tab loads { groups: [{ name, items }], note, verb }.
// An item is { key, name, tag, dot, url } where url is what DELETE goes to.
const TABS = {
  friends: {
    label: 'Friends',
    verb: 'Remove',
    async load() {
      const [friends, groups] = await Promise.all([
        fetch('/lol-chat/v1/friends').then((r) => r.json()),
        fetch('/lol-chat/v1/friend-groups').then((r) => r.json()),
      ]);
      const removable = friends.filter((f) => f.relationshipOnRiot === 'friend');
      const skipped = friends.length - removable.length;
      const item = (f) => ({
        key: f.id,
        name: f.gameName || f.name || '?',
        tag: f.gameTag,
        note: f.note,
        dot: f.availability || '',
        url: `/lol-chat/v1/friends/${encodeURIComponent(f.id)}`,
      });
      return {
        groups: groups
          .filter((g) => !g.isMetaGroup)
          .sort((a, b) => b.priority - a.priority)
          .map((g) => ({
            name: g.id === 0 || String(g.name).startsWith('**') ? 'General' : g.name,
            items: removable.filter((f) => f.groupId === g.id).map(item).sort(byName),
          })),
        note: skipped ? `${skipped} Discord-only contacts are not League friends and are not listed.` : '',
      };
    },
  },
  requests: {
    label: 'Requests',
    verb: 'Decline',
    async load() {
      const reqs = await fetch('/lol-chat/v2/friend-requests').then((r) => r.json());
      const item = (q) => ({
        key: q.puuid,
        name: q.gameName || q.name || '?',
        tag: q.tagLine,
        note: q.note,
        dot: 'none',
        url: `/lol-chat/v2/friend-requests/${encodeURIComponent(q.puuid)}`,
      });
      const dir = (d) => reqs.filter((q) => q.direction === d).map(item).sort(byName);
      return {
        groups: [
          { name: 'Incoming', items: dir('in') },
          { name: 'Sent', items: dir('out') },
        ],
        note: 'Selected sent requests are cancelled.',
      };
    },
  },
};

function open(tab = 'friends') {
  if (document.querySelector('.fc-backdrop')) return;
  const back = el('div', 'fc-backdrop');
  const box = el('div', 'fc');
  back.append(box);

  const head = el('div', 'fc-head');
  const tabs = el('div', 'fc-tabs');
  const tabBtns = Object.entries(TABS).map(([k, t]) => {
    const b = el('button', 'fc-tab', t.label);
    b.onclick = () => !busy && render(k);
    tabs.append(b);
    return [k, b];
  });
  const x = el('button', 'fc-x', '✕');
  head.append(tabs, x);
  const search = el('input', 'fc-search');
  search.placeholder = 'Search';
  const list = el('div', 'fc-list');
  const foot = el('div', 'fc-foot');
  const left = el('div');
  const clear = el('button', 'fc-link', 'Clear');
  const count = el('span');
  left.append(clear, count);
  const go = el('button', 'fc-go');
  foot.append(left, go);
  box.append(head, search, list, foot);
  document.body.append(back);

  let busy = false;
  const close = () => !busy && back.remove();
  x.onclick = close;
  back.onmousedown = (e) => e.target === back && close();
  back.onkeydown = (e) => e.key === 'Escape' && close();
  setTimeout(() => search.focus());

  let verb, selected, rows, groupHeads, lastIdx;
  const visible = (r) => r.row.style.display !== 'none' && !r.row.classList.contains('done');

  function set(r, on) {
    if (r.row.classList.contains('done')) return;
    on ? selected.add(r.it.key) : selected.delete(r.it.key);
    r.row.classList.toggle('on', on);
  }
  function refresh() {
    for (const g of groupHeads) {
      const n = g.rows.filter((r) => selected.has(r.it.key)).length;
      const live = g.rows.filter((r) => !r.row.classList.contains('done')).length;
      g.box.className = 'fc-box' + (n && n === live ? ' all' : n ? ' some' : '');
    }
    count.textContent = `${selected.size} selected`;
    go.disabled = !selected.size;
    go.classList.remove('confirm');
    go.textContent = selected.size ? `${verb} ${selected.size}` : verb;
  }

  async function render(k) {
    tabBtns.forEach(([key, b]) => b.classList.toggle('sel', key === k));
    verb = TABS[k].verb;
    selected = new Set();
    rows = [];
    groupHeads = [];
    lastIdx = -1;
    search.value = '';
    list.replaceChildren();
    refresh();

    const { groups, note } = await TABS[k].load();
    for (const g of groups.filter((g) => g.items.length)) {
      const gh = el('div', 'fc-group');
      const gbox = el('div', 'fc-box');
      gh.append(gbox, el('span', null, `${g.name} (${g.items.length})`));
      list.append(gh);
      const gref = { box: gbox, head: gh, rows: [] };
      groupHeads.push(gref);
      gh.onclick = () => {
        const vis = gref.rows.filter(visible);
        const allOn = vis.every((r) => selected.has(r.it.key));
        vis.forEach((r) => set(r, !allOn));
        refresh();
      };
      for (const it of g.items) {
        const row = el('div', 'fc-row');
        const name = el('span', 'fc-name', it.name);
        if (it.tag) name.append(el('span', 'fc-tag', ` #${it.tag}`));
        row.append(el('div', 'fc-box'));
        if (it.dot !== 'none') row.append(el('div', `fc-dot ${it.dot}`));
        row.append(name);
        const r = { it, row };
        r.idx = rows.push(r) - 1;
        gref.rows.push(r);
        list.append(row);
        row.onclick = (e) => {
          const on = !selected.has(it.key);
          if (e.shiftKey && lastIdx >= 0) {
            const [a, b] = [Math.min(lastIdx, r.idx), Math.max(lastIdx, r.idx)];
            rows.slice(a, b + 1).filter(visible).forEach((q) => set(q, on));
          } else set(r, on);
          lastIdx = r.idx;
          refresh();
        };
      }
    }
    if (!rows.length) list.append(el('div', 'fc-note', 'Nothing here.'));
    if (note) list.append(el('div', 'fc-note', note));
  }

  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    for (const r of rows) {
      const hay = `${r.it.name}#${r.it.tag || ''} ${r.it.note || ''}`.toLowerCase();
      r.row.style.display = !q || hay.includes(q) ? '' : 'none';
    }
    for (const g of groupHeads) g.head.style.display = g.rows.some((r) => r.row.style.display !== 'none') ? '' : 'none';
  };
  clear.onclick = () => (rows.forEach((r) => set(r, false)), refresh());

  go.onclick = async () => {
    if (!go.classList.contains('confirm')) {
      go.classList.add('confirm');
      go.textContent = `Confirm: ${verb.toLowerCase()} ${selected.size}`;
      return;
    }
    busy = true;
    go.disabled = true;
    const todo = rows.filter((r) => selected.has(r.it.key));
    let ok = 0, fail = 0;
    for (const [i, r] of todo.entries()) {
      go.textContent = `${verb.replace(/e$/, '')}ing ${i + 1}/${todo.length}`;
      const res = await fetch(r.it.url, { method: 'DELETE' }).catch(() => null);
      selected.delete(r.it.key);
      r.row.classList.remove('on');
      if (res?.ok) ok++, r.row.classList.add('done');
      else fail++, r.row.classList.add('fail');
      await sleep(DELAY_MS);
    }
    busy = false;
    refresh();
    count.textContent = `${verb === 'Remove' ? 'Removed' : 'Declined'} ${ok}` + (fail ? `, ${fail} failed` : '');
  };

  render(tab);
}

function addButton() {
  const bar = document.querySelector('.lol-social-actions-bar .buttons');
  if (!bar || bar.querySelector('.fc-button')) return;
  const btn = el('span', 'action-bar-button fc-button');
  btn.title = 'Remove friends or decline requests';
  btn.onclick = () => open();
  const anchor = bar.querySelector('.options-button');
  anchor ? anchor.before(btn) : bar.append(btn);
}

export function load() {
  document.head.append(Object.assign(el('style'), { textContent: CSS }));
  new MutationObserver(addButton).observe(document.body, { childList: true, subtree: true });
  addButton();
  CommandBar?.addAction?.({ name: 'Remove friends', legend: 'Friend Cleaner', tags: ['friends', 'unfriend', 'remove'], perform: () => open('friends') });
  CommandBar?.addAction?.({ name: 'Decline friend requests', legend: 'Friend Cleaner', tags: ['friends', 'requests', 'decline'], perform: () => open('requests') });
}

// Token Radar — the dashboard.
//
// Renders the board from window.RADAR: a sortable pre-token table with
// Growth and Age columns, a Live token view, a top-five spotlight, and a
// detail dialog per protocol with its multipliers, its twelve nearest live
// comps, its bootstrap rank range and its farm plan. State lives in the
// URL hash so a link opens the same view: #p=<slug>, #watchlist=1, #q=,
// #category=, #chain=, #tab=live.

const DATA = window.RADAR;

const $ = (id) => document.getElementById(id);

const tbody = document.querySelector('table.board tbody');
const countEl = $('count');
const emptyEl = $('empty');
const dialog = $('detail');
const detailBody = $('detail-body');

const state = {
  tab: 'pretoken',
  q: '',
  category: '',
  chain: '',
  watchlistOnly: false,
  sortKey: 'rank',
  sortDir: 1,
  selected: null,
};

function compactMoney(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

function fullMoney(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function growthText(g) {
  if (g === null || g === undefined) return '—';
  const sign = g > 0 ? '+' : g < 0 ? '−' : '';
  return `${sign}${Math.abs(g).toFixed(1)}%`;
}

function ageText(days) {
  if (days === null || days === undefined) return '—';
  return `${days} days`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function uniqueSorted(values) {
  return [...new Set(values)].filter((v) => v !== null && v !== undefined && v !== '').sort();
}

function fillSelect(select, values, label) {
  select.innerHTML = `<option value="">${label}</option>` + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

function visibleRows() {
  const rows = state.tab === 'live' ? liveRows() : DATA.rows;
  return rows.filter((row) => {
    if (state.watchlistOnly && !row.watchlist) return false;
    if (state.category && row.category !== state.category) return false;
    if (state.chain && !(row.chains || []).includes(state.chain)) return false;
    if (state.q) {
      const q = state.q.toLowerCase();
      if (!row.name.toLowerCase().includes(q) && !row.slug.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function liveRows() {
  return DATA.live.map((row, i) => ({
    rank: i + 1,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: null,
    implied_value_usd: row.mcap_usd,
    mcap_usd: row.mcap_usd,
    rank_lo: null,
    rank_hi: null,
    watchlist: false,
  }));
}

function sortValue(row, key) {
  switch (key) {
    case 'rank': return row.rank;
    case 'name': return row.name.toLowerCase();
    case 'category': return (row.category || '').toLowerCase();
    case 'tvl': return row.tvl_usd;
    case 'growth': return row.change_7d === null ? -Infinity : row.change_7d;
    case 'age': return row.age_days === null ? -1 : row.age_days;
    case 'implied': return row.implied_value_usd;
    default: return row.rank;
  }
}

function renderBoard() {
  const rows = visibleRows().slice();
  const dir = state.sortDir;
  rows.sort((a, b) => {
    const av = sortValue(a, state.sortKey);
    const bv = sortValue(b, state.sortKey);
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
  const isLive = state.tab === 'live';
  tbody.innerHTML = rows.map((row) => {
    const range = row.rank_lo === null ? '—' : `${row.rank_lo}–${row.rank_hi}`;
    const star = row.watchlist ? '<span class="star">★</span>' : '';
    return `<tr data-slug="${esc(row.slug)}">
      <td class="num">${row.rank}</td>
      <td><div class="name">${esc(row.name)}</div><div class="slug">${esc(row.slug)}</div></td>
      <td>${esc(row.category || '—')}</td>
      <td class="num">${compactMoney(row.tvl_usd)}</td>
      <td class="num">${growthText(row.change_7d)}</td>
      <td class="num">${ageText(row.age_days)}</td>
      <td class="num">${fullMoney(row.implied_value_usd)}</td>
      <td class="num">${range}</td>
      <td>${star}</td>
    </tr>`;
  }).join('');
  const total = isLive ? DATA.live.length : DATA.rows.length;
  countEl.textContent = isLive
    ? `${rows.length} of ${total} live tokens shown.`
    : `${rows.length} of ${total} board rows shown.`;
  emptyEl.hidden = rows.length > 0;
  document.querySelectorAll('table.board thead th[data-sort]').forEach((th) => {
    const key = th.getAttribute('data-sort');
    th.textContent = th.textContent.replace(/ [▲▼]$/, '');
    if (key === state.sortKey) th.textContent += state.sortDir === 1 ? ' ▲' : ' ▼';
    if (isLive && key === 'implied') th.textContent = th.textContent.replace('Implied value', 'Market cap');
  });
  const impliedTh = document.querySelector('table.board thead th[data-sort="implied"]');
  if (impliedTh) impliedTh.textContent = (isLive ? 'Market cap' : 'Implied value') + (state.sortKey === 'implied' ? (state.sortDir === 1 ? ' ▲' : ' ▼') : '');
  const rangeTh = document.querySelectorAll('table.board thead th')[7];
  if (rangeTh) rangeTh.textContent = isLive ? 'mcap / TVL' : 'Rank range (P10–P90)';
  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', () => openDetail(tr.getAttribute('data-slug')));
  });
  if (isLive) {
    tbody.querySelectorAll('tr').forEach((tr, i) => {
      const row = rows[i];
      const ratio = row && row.mcap_usd ? (row.mcap_usd / row.tvl_usd).toFixed(3) : '—';
      const cell = tr.children[7];
      if (cell) cell.textContent = ratio;
    });
  }
}

function renderSpotlight() {
  const top = DATA.rows.slice(0, 5);
  $('spotlight').innerHTML = top.map((row) => `<div class="spot">
    <div class="spot-rank">#${row.rank} · ${esc(row.category || '')}</div>
    <div class="spot-name">${esc(row.name)}</div>
    <div class="spot-value">${fullMoney(row.implied_value_usd)}</div>
    <div class="spot-meta">TVL ${compactMoney(row.tvl_usd)} · ${growthText(row.change_7d)} 7d · ${ageText(row.age_days)}</div>
  </div>`).join('');
}

function renderLiveTable() {
  $('live-table').innerHTML = `<table>
    <thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>mcap / TVL</th></tr></thead>
    <tbody>${DATA.live.map((row) => `<tr>
      <td>${esc(row.name)} <span class="slug">${esc(row.slug)}</span></td>
      <td>${compactMoney(row.tvl_usd)}</td>
      <td>${fullMoney(row.mcap_usd)}</td>
      <td>${(row.mcap_usd / row.tvl_usd).toFixed(3)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function stat(label, value) {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function openDetail(slug) {
  const row = DATA.rows.find((r) => r.slug === slug);
  if (!row) return;
  state.selected = slug;
  const chains = (row.chains || []).join(', ');
  const sub = `${esc(row.slug)} · ${esc(row.category || '—')} · ${esc(chains)} · TVL ${compactMoney(row.tvl_usd)} · ${ageText(row.age_days)} listed${row.watchlist ? ' · ★ watchlist' : ''}`;
  const compsRows = row.comps.map((c) => `<tr>
    <td><b>${esc(c.slug)}</b></td>
    <td>${esc(c.category || '—')}</td>
    <td>${compactMoney(c.tvl_usd)}</td>
    <td>${c.log_ratio.toFixed(4)}</td>
  </tr>`).join('');
  detailBody.innerHTML = `
    <h2>#${row.rank} ${esc(row.name)}</h2>
    <p class="sub">${sub}</p>
    <div class="statgrid">
      ${stat('Implied value', fullMoney(row.implied_value_usd))}
      ${stat('TVL', compactMoney(row.tvl_usd))}
      ${stat('Growth 7d', growthText(row.change_7d))}
      ${stat('Age', ageText(row.age_days))}
      ${stat('Growth multiplier', `×${row.growth_multiplier.toFixed(3)}`)}
      ${stat('Maturity multiplier', `×${row.maturity_multiplier.toFixed(3)}`)}
      ${stat('Chain multiplier', `×${row.chain_multiplier.toFixed(3)}`)}
      ${stat('Median comp ratio', `10^${row.median_comp_ratio.toFixed(4)}`)}
      ${stat('Rank range (P10–P90)', `${row.rank_lo} – ${row.rank_hi}`)}
    </div>
    <h3>Twelve nearest live comps</h3>
    <p class="comps-note">${esc(row.comps_label)}</p>
    <table>
      <thead><tr><th>Comp</th><th>Category</th><th>TVL</th><th>Log ratio</th></tr></thead>
      <tbody>${compsRows}</tbody>
    </table>
    <h3>Farm plan</h3>
    <ol>${row.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  if (!dialog.open) dialog.showModal();
  syncHash();
}

function closeDetail() {
  if (dialog.open) dialog.close();
  state.selected = null;
  syncHash();
}

function setTab(tab) {
  state.tab = tab;
  $('tab-pretoken').setAttribute('aria-selected', String(tab === 'pretoken'));
  $('tab-live').setAttribute('aria-selected', String(tab === 'live'));
  renderBoard();
  syncHash();
}

function syncHash() {
  const params = new URLSearchParams();
  if (state.tab === 'live') params.set('tab', 'live');
  if (state.q) params.set('q', state.q);
  if (state.category) params.set('category', state.category);
  if (state.chain) params.set('chain', state.chain);
  if (state.watchlistOnly) params.set('watchlist', '1');
  if (state.selected) params.set('p', state.selected);
  const hash = params.toString();
  history.replaceState(null, '', hash ? `#${hash}` : '#');
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('tab') === 'live') state.tab = 'live';
  if (params.get('q')) state.q = params.get('q');
  if (params.get('category')) state.category = params.get('category');
  if (params.get('chain')) state.chain = params.get('chain');
  if (params.get('watchlist') === '1') state.watchlistOnly = true;
  if (params.get('p')) state.selected = params.get('p');
}

function init() {
  fillSelect($('category'), uniqueSorted(DATA.rows.map((r) => r.category)), 'All categories');
  fillSelect($('chain'), uniqueSorted(DATA.rows.flatMap((r) => r.chains || [])), 'All chains');
  readHash();
  $('q').value = state.q;
  $('category').value = state.category;
  $('chain').value = state.chain;
  $('watchlist-only').checked = state.watchlistOnly;
  $('tab-pretoken').setAttribute('aria-selected', String(state.tab === 'pretoken'));
  $('tab-live').setAttribute('aria-selected', String(state.tab === 'live'));
  $('tab-pretoken').addEventListener('click', () => setTab('pretoken'));
  $('tab-live').addEventListener('click', () => setTab('live'));
  $('q').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); syncHash(); });
  $('category').addEventListener('change', (e) => { state.category = e.target.value; renderBoard(); syncHash(); });
  $('chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); syncHash(); });
  $('watchlist-only').addEventListener('change', (e) => { state.watchlistOnly = e.target.checked; renderBoard(); syncHash(); });
  document.querySelectorAll('table.board thead th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (state.sortKey === key) state.sortDir = -state.sortDir;
      else { state.sortKey = key; state.sortDir = key === 'name' || key === 'category' ? 1 : -1; }
      renderBoard();
    });
  });
  dialog.addEventListener('close', () => { state.selected = null; syncHash(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeDetail(); });
  renderSpotlight();
  renderLiveTable();
  renderBoard();
  if (state.selected) openDetail(state.selected);
}

init();

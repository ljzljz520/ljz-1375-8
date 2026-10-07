import { L } from '/i18n.js';

const I18N = {
  title: { zh: '沧澜湾湿地鸟类民俗节', en: 'Canglan Bay Wetland Bird Folklore Festival' },
  subtitle: { zh: '鸟类 · 民俗仪式 · 亲子活动', en: 'Birds · Rituals · Family Activities' },
  tabBirds: { zh: '鸟类', en: 'Birds' },
  tabRituals: { zh: '民俗仪式', en: 'Rituals' },
  tabFamily: { zh: '亲子活动', en: 'Family Activities' },
  bulletins: { zh: '公告', en: 'Bulletins' },
  tides: { zh: '潮汐参考', en: 'Tide Reference' },
  birdnews: { zh: '鸟讯（来源材料）', en: 'Bird News (source material)' },
  printCard: { zh: '打印选中点卡片', en: 'Print selected-point card' },
  listBirds: { zh: '鸟类名录', en: 'Bird List' },
  listRituals: { zh: '民俗仪式安排', en: 'Ritual Schedule' },
  listFamily: { zh: '亲子活动', en: 'Family Activities' },
  offlineWarn: {
    zh: '离线：以下为旧计划，限制区可能已调整，点位或已禁止进入；联网前请勿据此前往。',
    en: 'Offline: this is an old plan. Restriction zones may have changed and sites may be closed. Do not travel on this until online.',
  },
  staleWarn: {
    zh: '内容版本已更新（限制区边界或内容变更），正在刷新地图、文本与打印卡…',
    en: 'Version updated (zone boundaries or content changed). Refreshing map, text and print cards…',
  },
  mapOnline: { zh: '仅显示当前可公开展示的观测点；几何上落入生效限制区的点位不出现。',
    en: 'Only currently publishable observation points are shown; points geometrically inside active restriction zones never appear.' },
  mapOffline: { zh: '离线模式不渲染点位，避免依据失效坐标前往。', en: 'Offline: no markers rendered, to avoid travel on stale coordinates.' },
  rescheduled: { zh: '已改期（以新日期为准）', en: 'Rescheduled (new date applies)' },
  crossDay: { zh: '跨日潮汐', en: 'Cross-day tide' },
  sensitive: { zh: '敏感点位·仅网格位置', en: 'Sensitive · grid position only' },
  noPoint: { zh: '具体位置不公开', en: 'Exact location not public' },
  active: { zh: '生效中', en: 'Active' },
  printPrompt: { zh: '请先在地图或列表中选择一个公开观测点。', en: 'Select a public observation point first.' },
};

let lang = localStorage.getItem('festival-lang') || 'zh';
let pack = null;
let currentTab = 'birds';
let selectedSite = null;
let map = null;
let markers = {};
let online = navigator.onLine;

function t(key) { return L(I18N[key], lang).text; }
function el(id) { return document.getElementById(id); }
function pending(value) {
  const r = L(value, lang);
  return r.missing && !r.empty
    ? `${r.text} <span class="pending">${lang === 'en' ? '〔Translation pending〕' : '〔待补翻译〕'}</span>`
    : r.missing
      ? `<span class="pending">${r.text}</span>`
      : r.text;
}

async function loadPack() {
  const res = await fetch(`/api/pack?lang=${lang}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('pack fetch failed');
  return res.json();
}

function setBanner() {
  el('offline-banner').classList.toggle('hidden', online);
  el('stale-banner').classList.add('hidden');
}

function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((n) => {
    const k = n.dataset.i18n;
    if (I18N[k]) n.textContent = t(k);
  });
  el('lang-toggle').textContent = lang === 'zh' ? 'EN' : '中';
}

function renderAll() {
  if (!pack) return;
  applyLang();
  el('version-badge').textContent = `v${pack.version}`;
  el('tide-disc').textContent = pack.disclaimers.tides[lang];
  el('news-disc').textContent = pack.disclaimers.birdnews[lang];
  el('footer-disc').textContent = `${pack.disclaimers.access[lang]} · v${pack.version} @ ${pack.generated_at}`;
  renderTabs();
  renderBulletins();
  renderTides();
  renderNews();
  renderMap();
}

function renderTabs() {
  const titles = { birds: 'listBirds', rituals: 'listRituals', family: 'listFamily' };
  el('list-title').textContent = t(titles[currentTab]);
  const box = el('content-list');
  box.innerHTML = '';

  if (currentTab === 'birds') {
    for (const sp of pack.species) {
      const recent = pack.records.filter((r) => r.species_id === sp.id);
      const siteNames = recent
        .map((r) => pack.sites.find((s) => s.id === r.site_id)?.name)
        .filter(Boolean)
        .map((n) => L(n, lang).text);
      box.insertAdjacentHTML('beforeend', `
        <div class="card" data-species="${sp.id}">
          <h4>${pending({ zh: sp.zh, en: sp.en })}
            ${sp.disambiguated ? `<span class="tag" title="${lang === 'en' ? 'Same folk name, distinct species' : '同名不同种，已区分'}">${L({zh:'同名已区分',en:'name disambiguated'},lang).text}</span>` : ''}
          </h4>
          <div class="sci">${sp.scientific || '—'}</div>
          <div class="meta">${pending(sp.desc)}</div>
          <div class="meta">${L(sp.folk_name, lang).text} · ${recent.length ? recent.reduce((a, r) => a + r.count, 0) : 0} ${L({zh:'只（近期记录）',en:'birds (recent)'},lang).text}
            ${siteNames.length ? '· ' + [...new Set(siteNames)].join('、') : ''}
          </div>
        </div>`);
    }
  } else {
    const code = currentTab === 'rituals' ? 'cat_ritual' : 'cat_family';
    const events = pack.events.filter((e) => e.category_id === code);
    for (const ev of events) {
      const site = pack.sites.find((s) => s.id === ev.site_id);
      box.insertAdjacentHTML('beforeend', `
        <div class="card" data-site="${ev.site_id || ''}">
          <h4>${pending(ev.title)}
            ${ev.rescheduled ? `<span class="tag resched">${t('rescheduled')}</span>` : ''}
          </h4>
          <div class="meta">${ev.date} ${ev.time || ''} · ${site ? L(site.name, lang).text : t('noPoint')}</div>
          <div class="meta">${pending(ev.desc)}</div>
        </div>`);
    }
  }

  box.querySelectorAll('.card').forEach((c) => {
    c.addEventListener('click', () => {
      const sid = c.dataset.site;
      if (sid) selectSite(sid);
    });
  });
}

function renderBulletins() {
  const box = el('bulletins');
  box.innerHTML = pack.bulletins.map((b) => `
    <div class="bulletin">
      ${b.level === 'warning' ? '<span class="tag warning">!</span>' : ''}
      <strong>${pending(b.title)}</strong>：${pending(b.body)}
      <span class="meta">[${(b.valid_from || '').slice(0, 10)} → ${(b.valid_to || '').slice(0, 10)}]</span>
    </div>`).join('');
}

function renderTides() {
  el('tides').innerHTML = pack.tides.map((td) => {
    const rows = td.entries.map((e) => `${e.time} ${L({ zh: e.type === 'high' ? '高' : '低', en: e.type }, lang).text}${e.height}m`).join(' / ');
    return `<div class="tide-row">${td.date}：${rows}
      <span class="meta">（${td.window_start.date} ${td.window_start.time}–${td.window_end.date} ${td.window_end.time}）</span>
      ${td.cross_day ? `<span class="tag cross">${t('crossDay')}</span>` : ''}
    </div>`;
  }).join('');
}

function renderNews() {
  el('birdnews').innerHTML = pack.birdnews.map((n) => `
    <div class="news-item">${n.date} · <strong>${pending(n.summary)}</strong>
      <span class="meta">[${pending(n.source)}]</span></div>`).join('');
}

function selectSite(sid) {
  const site = pack.sites.find((s) => s.id === sid);
  if (!site) return;
  selectedSite = sid;
  document.querySelectorAll('.card').forEach((c) =>
    c.classList.toggle('selected', c.dataset.site === sid));
  if (online && map && markers[sid]) {
    map.setView([site.lat, site.lng], 13);
    markers[sid].openPopup();
  }
}

function renderMap() {
  if (!online) {
    el('map').classList.add('hidden');
    const fb = el('map-fallback');
    fb.classList.remove('hidden');
    // 离线：文本也不附带坐标，只列名称并提示失效风险
    fb.innerHTML = `<p><strong>${t('mapOffline')}</strong></p>` +
      pack.sites.map((s) => `<div>${L(s.name, lang).text}</div>`).join('');
    el('map-status').textContent = t('offlineWarn');
    return;
  }
  el('map-fallback').classList.add('hidden');
  el('map').classList.remove('hidden');
  el('map-status').textContent = t('mapOnline');

  if (!map) {
    map = L.map('map').setView([30.0, 121.01], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 18,
    }).addTo(map);
  }
  Object.values(markers).forEach((m) => m.remove());
  markers = {};
  for (const s of pack.sites) {
    const m = L.marker([s.lat, s.lng]).addTo(map);
    m.bindPopup(`<b>${L(s.name, lang).text}</b><br>${pending(s.guidance)}
      ${s.sensitive ? `<br><span class="tag sensitive">${t('sensitive')}</span>` : ''}
      <br><a href="/print.html?id=${s.id}&v=${pack.version}" target="_blank">${t('printCard')}</a>`);
    markers[s.id] = m;
    m.on('click', () => selectSite(s.id));
  }
  if (pack.sites.length) {
    const group = L.featureGroup(Object.values(markers));
    if (Object.keys(markers).length > 0) map.fitBounds(group.getBounds().padEnd(0.2));
  }
}

async function boot() {
  applyLang();
  setBanner();
  try {
    pack = await loadPack();
    localStorage.setItem('festival-version', pack.version);
    renderAll();
  } catch (e) {
    online = false;
    setBanner();
    el('map-status').textContent = t('offlineWarn');
    el('content-list').innerHTML = `<div class="disc">${t('offlineWarn')}</div>`;
  }

  window.addEventListener('online', () => location.reload());
  window.addEventListener('offline', () => { online = false; setBanner(); renderMap(); });

  el('lang-toggle').addEventListener('click', () => {
    lang = lang === 'zh' ? 'en' : 'zh';
    localStorage.setItem('festival-lang', lang);
    // 切语言绝不改变点位集合：仅重新取同一版本包
    loadPack().then((p) => { pack = p; renderAll(); });
  });

  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    currentTab = b.dataset.tab;
    renderTabs();
  }));

  el('print-selected').addEventListener('click', () => {
    if (!selectedSite) return alert(t('printPrompt'));
    window.open(`/print.html?id=${selectedSite}&v=${pack?.version || ''}`, '_blank');
  });
}

// 版本轮询：边界/内容一变，全渠道立即刷新（地图、文本、打印卡同版）
setInterval(async () => {
  if (!navigator.onLine) return;
  try {
    const v = await (await fetch('/api/version', { cache: 'no-store' })).json();
    const known = pack?.version;
    if (known && v.version !== known) {
      el('stale-banner').classList.remove('hidden');
      setTimeout(() => location.reload(), 600);
    }
  } catch { /* 离线忽略 */ }
}, 15000);

boot();

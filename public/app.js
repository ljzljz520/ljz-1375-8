const I18N = {
  zh: {
    title: '湿地鸟类民俗节', mapTitle: '同期发布地图', mapNote: '只绘制已通过限制区实时几何过滤的公开点位；不绘制限制区边界。',
    notices: '公告与有效区间', sources: '鸟讯与潮汐', print: '打印卡', export: 'CSV 导出',
    birds: '鸟类', rituals: '仪式', family: '亲子活动',
    visiblePoints: '可展示观测点', species: '物种', reports: '鸟讯（来源材料，不保证见鸟）', images: '图片（定位元数据已剥离）',
    noItems: '暂无当前可公开内容。', events: '活动安排', tides: '潮汐（来源材料，不保证可进入）',
    offline: '当前离线：不会复用旧点位、旧活动或旧限制计划。恢复网络后必须获取新版本。',
    stale: '边界或活动信息刚更新，页面已切换为新版本；旧打印卡和离线计划作废。',
    pending: '待补信息', rescheduled: '已改期', crossesMidnight: '跨日', withheld: '精确点位隐藏',
    exportPoints: '公开点位 CSV', exportReports: '安全鸟讯 CSV', exportImages: '安全图片元数据 CSV'
  },
  en: {
    title: 'Wetland Bird Folklore Festival', mapTitle: 'Same-release map', mapNote: 'Only public points that pass live geometric restriction filtering are drawn; restriction polygons are not shown.',
    notices: 'Notices and validity windows', sources: 'Bird reports and tides', print: 'Print card', export: 'CSV export',
    birds: 'Birds', rituals: 'Rituals', family: 'Family',
    visiblePoints: 'Visible observation points', species: 'Species', reports: 'Bird reports (source material; sighting not guaranteed)', images: 'Images (location metadata removed)',
    noItems: 'No public content is currently available.', events: 'Schedule', tides: 'Tides (source material; access not guaranteed)',
    offline: 'Offline: old points, schedules and restriction plans will not be reused. A new version is required when connectivity returns.',
    stale: 'Boundary or event information changed. The page has switched to the new version; old print cards and offline plans are obsolete.',
    pending: 'Pending translation', rescheduled: 'Rescheduled', crossesMidnight: 'Crosses midnight', withheld: 'Exact location withheld',
    exportPoints: 'Public points CSV', exportReports: 'Safe bird report CSV', exportImages: 'Safe image metadata CSV'
  }
};
let lang = localStorage.getItem('festivalLang') || 'zh';
let tab = localStorage.getItem('festivalTab') || 'bird';
let release = null;
let releaseId = null;

function t(key) { return I18N[lang][key] || key; }
function el(tag, className, html) { const node = document.createElement(tag); if (className) node.className = className; if (html !== undefined) node.innerHTML = html; return node; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDate(value) { return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en', { dateStyle:'medium', timeStyle:'short' }).format(new Date(value)); }

async function load() {
  document.documentElement.lang = lang === 'zh' ? 'zh' : 'en';
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  try {
    const response = await fetch(`/api/release?lang=${encodeURIComponent(lang)}&at=${encodeURIComponent(new Date().toISOString())}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`release ${response.status}`);
    release = await response.json();
    document.getElementById('offlineWarning').hidden = true;
    render();
    const oldId = localStorage.getItem('festivalReleaseId');
    releaseId = release.release.id;
    const staleBar = document.getElementById('staleBar');
    if (oldId && oldId !== releaseId) staleBar.textContent = t('stale'), staleBar.style.display = 'block';
    else staleBar.style.display = 'none';
    localStorage.setItem('festivalReleaseId', releaseId);
  } catch (error) {
    showOffline();
  }
}

function showOffline() {
  release = null;
  releaseId = null;
  const warn = document.getElementById('offlineWarning');
  warn.hidden = false;
  warn.textContent = t('offline');
  document.getElementById('releaseMeta').textContent = t('offline');
  document.getElementById('contentPanel').innerHTML = `<p>${esc(t('offline'))}</p>`;
  document.getElementById('map').innerHTML = '';
  document.getElementById('notices').innerHTML = `<p>${esc(t('offline'))}</p>`;
  document.getElementById('sources').innerHTML = `<p>${esc(t('offline'))}</p>`;
}

function render() {
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
  document.getElementById('releaseMeta').textContent = `${release.release.id} · ${release.release.changedAt || ''} · ${release.release.channel}`;
  document.getElementById('printLink').href = `/print?lang=${lang}`;
  document.getElementById('exportBtn').textContent = t('export');
  renderMap();
  renderNotices();
  renderSources();
  const panel = document.getElementById('contentPanel');
  panel.innerHTML = '';
  if (tab === 'bird') panel.append(renderBirds());
  if (tab === 'ritual') panel.append(renderEvents('ritual'));
  if (tab === 'family') panel.append(renderEvents('family'));
}

function renderMap() {
  const svg = document.getElementById('map');
  svg.innerHTML = `<title>${esc(t('mapTitle'))}</title>
    <path d="M120.05,32.22 C120.10,32.12 120.20,32.08 120.37,32.10 C120.34,32.18 120.25,32.25 120.05,32.22Z" fill="#b7dcc7" opacity=".45"/>`;
  release.points.forEach(p => {
    const [x, y] = p.geometry.coordinates;
    const c = el('circle', 'dot');
    c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', .008); c.setAttribute('tabindex', 0);
    c.innerHTML = `<title>${esc(p.name)}</title>`;
    c.addEventListener('click', () => alert(`${p.name}\n${p.accessNote}`));
    svg.appendChild(c);
  });
  if (!release.points.length) svg.appendChild(el('text', '', '')).setAttribute('x', 120.08);
}

function card(title, body, badges = []) {
  const article = el('article', 'card');
  article.innerHTML = `<h3>${esc(title)} ${badges.map(b => `<span class="pill">${esc(b)}</span>`).join('')}</h3>${body}`;
  return article;
}
function renderBirds() {
  const frag = document.createDocumentFragment();
  frag.appendChild(el('h2', null, esc(t('species'))));
  release.species.forEach(s => frag.appendChild(card(`${s.commonName} / ${s.scientificName}`, `<p>${esc(s.description)}</p>`)));
  frag.appendChild(el('h2', null, esc(t('reports'))));
  release.birdReports.forEach(r => {
    const loc = r.location.type === 'withheld'
      ? `${t('withheld')}${r.location.broadArea ? ' · ' + esc(r.location.broadArea) : ''}`
      : esc(r.location.pointSlug);
    frag.appendChild(card(r.species ? `${r.species.commonName} / ${r.species.scientificName}` : '#'+r.id,
      `<p>${esc(r.summary)}</p><p class="muted">${fmtDate(r.observedAt)} · ${loc}</p>`,
      r.correction ? [r.correction.oldLabel] : []));
  });
  frag.appendChild(el('h2', null, esc(t('images'))));
  release.images.forEach(image => {
    frag.appendChild(card(image.altText, `<img class="photo" src="${esc(image.url)}" alt="${esc(image.altText)}"><p>${esc(image.caption)}</p><p class="muted">${image.species.map(s=>esc(s.commonName)).join(' · ')}</p><p class="muted">GPS: removed; ${esc(Object.entries(image.metadata).filter(([k])=>k!=='locationStatus').map(([k,v])=>`${k}=${v}`).join('; '))}</p>`));
  });
  return frag;
}
function renderEvents(categoryKey) {
  const frag = document.createDocumentFragment();
  frag.appendChild(el('h2', null, esc(t('events'))));
  release.events.filter(e => e.categoryKey === categoryKey).forEach(e => {
    const badges = [];
    if (e.rescheduled) badges.push(t('rescheduled'));
    const prev = e.previousSchedule ? `<p class="muted">${fmtDate(e.previousSchedule.startAt)} → ${fmtDate(e.startAt)}</p>` : '';
    frag.appendChild(card(e.title, `<time>${fmtDate(e.startAt)} – ${fmtDate(e.endAt)}</time><p>${esc(e.description)}</p>${prev}`, badges));
  });
  if (!release.events.some(e => e.categoryKey === categoryKey)) frag.appendChild(el('p', null, esc(t('noItems'))));
  return frag;
}
function renderNotices() {
  const box = document.getElementById('notices');
  box.innerHTML = '';
  [...release.announcements.map(a => ({ title:a.title, body:`${a.body}<br><span class="muted">${fmtDate(a.validStart)} – ${fmtDate(a.validEnd)}</span>` })),
   ...release.activeRestrictionNotices.map(z => ({ title:z.name, body:`${esc(z.reason)}<br><span class="muted">${z.broadArea ? esc(z.broadArea)+' · ' : ''}${fmtDate(z.effectiveStart)} – ${fmtDate(z.effectiveEnd)}</span>` }))]
    .forEach(n => box.appendChild(card(n.title, `<p>${n.body}</p>`)));
}
function renderSources() {
  const box = document.getElementById('sources');
  box.innerHTML = `<p class="notice">${esc(release.disclaimers.birds)}</p><p class="notice">${esc(release.disclaimers.tides)}</p>`;
  release.tides.forEach(tide => box.appendChild(card(`${tide.locationSlug} · ${tide.tideType}`,
    `<p>${fmtDate(tide.startAt)} – ${fmtDate(tide.endAt)}</p><p class="muted">${esc(tide.source.title)}</p>`,
    tide.crossesLocalMidnight ? [t('crossesMidnight')] : [])));
}

document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { tab = button.dataset.tab; localStorage.setItem('festivalTab', tab); load(); }));
document.getElementById('langZh').addEventListener('click', () => { lang='zh'; localStorage.setItem('festivalLang', lang); load(); });
document.getElementById('langEn').addEventListener('click', () => { lang='en'; localStorage.setItem('festivalLang', lang); load(); });
document.getElementById('exportBtn').addEventListener('click', () => {
  const list = [
    ['/api/export/points.csv?lang='+lang, t('exportPoints')],
    ['/api/export/bird-reports.csv?lang='+lang, t('exportReports')],
    ['/api/export/images.csv?lang='+lang, t('exportImages')]
  ];
  const choice = prompt(`${list.map((x,i)=>`${i+1}. ${x[1]}`).join('\n')}`, '1');
  const item = list[Number(choice)-1]; if (item) window.location = item[0];
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
setInterval(async () => {
  try { const v = await (await fetch('/api/release/version', { cache:'no-store' })).json();
    if (releaseId && v.id !== releaseId) load();
  } catch {}
}, 10000);
window.addEventListener('offline', showOffline);
window.addEventListener('online', load);
load();

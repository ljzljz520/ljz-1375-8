import { L } from '/i18n.js';

const params = new URLSearchParams(location.search);
const id = params.get('id');
const wantedVersion = params.get('v');
const lang = localStorage.getItem('festival-lang') || 'zh';
const root = document.getElementById('root');

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function main() {
  if (!id) {
    root.innerHTML = `<div class="gone">缺少点位参数</div>`;
    return;
  }
  let data;
  try {
    const res = await fetch(`/api/print/${id}?lang=${lang}`, { cache: 'no-store' });
    data = await res.json();
    if (res.status === 410 || !res.ok) {
      root.innerHTML = `<div class="gone">
        <h1>⛔ ${lang === 'en' ? 'Print card not publishable' : '打印卡不可发布'}</h1>
        <p>${esc(data.message || '')}</p>
        <p>${lang === 'en' ? 'The point is currently hidden by an active restriction zone (geometry-based). No map, text or print version may show it.' : '该点位已被生效限制区按几何关系隐藏。地图、文本与打印卡均不得展示。'}</p>
        <p class="disc">${lang === 'en' ? 'Current content version' : '当前内容版本'}：${esc(data.version || '?')}</p>
      </div>`;
      return;
    }
  } catch {
    root.innerHTML = `<div class="gone">
      <h1>${lang === 'en' ? 'Offline: stale plan' : '离线：旧计划不可信'}</h1>
      <p>${lang === 'en' ? 'The current version cannot be verified offline. Restriction boundaries may have changed; this card must not be printed or used for access.' : '离线无法校验当前版本，限制区边界可能已变化，本卡不得打印或作为进入依据。'}</p>
    </div>`;
    return;
  }

  // 同版发布：卡片必须带版本；若从旧入口带来的版本号不一致则整卡作废重出
  const mismatch = wantedVersion && wantedVersion !== data.version;
  const s = data.site;
  root.innerHTML = `
    <div class="print-card">
      ${mismatch ? `<div class="banner warn">${lang === 'en' ? 'Version mismatch: this card has been superseded. Reprint with the current version.' : '版本不一致：本卡已被新版替代，请以新版本重新打印。'}</div>` : ''}
      <h1>${esc(L(s.name, lang).text)}</h1>
      <p class="meta">${esc(L(s.region, lang).text)}${s.sensitive ? ' · ' + (lang === 'en' ? 'sensitive (grid position only)' : '敏感点位（仅网格位置）') : ''}</p>
      <p>${esc(L(s.guidance, lang).text)}</p>
      <p class="meta">${lang === 'en' ? 'Facilities' : '设施'}：${esc(L(s.facilities, lang).text)}</p>
      <h3>${lang === 'en' ? 'Programs at this point' : '本点活动'}</h3>
      ${(data.related_events || []).map((e) => `<div>${e.date} ${e.time} ${esc(L(e.title, lang).text)}</div>`).join('') || `<div class="meta">${lang === 'en' ? 'None' : '暂无'}</div>`}
      <hr>
      <p class="disc">${esc(data.disclaimers.access[lang])}</p>
      <p class="meta">${lang === 'en' ? 'Version' : '版本'}：<b>v${data.version}</b> · ${data.generated_at}</p>
      <button class="btn" onclick="window.print()">${lang === 'en' ? 'Print' : '打印'}</button>
    </div>`;
  document.title = `${L(s.name, lang).text} · v${data.version}`;
}
main();

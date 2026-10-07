// 共享的多语言工具：服务端与浏览器同源使用，保证“缺翻译显示待补信息”规则一致。
// 任何条目都以 { zh, en } 形式存储；缺译文时回退中文并标记 missing，
// 由 UI 展示“待补翻译”，而不是静默切到另一语言页面（点位隐藏只由服务端几何判定）。

export const LANGS = ['zh', 'en'];
export const PENDING = { zh: '〔待补信息〕', en: '〔Translation pending〕' };

export function L(value, lang = 'zh') {
  if (value == null || (typeof value !== 'object')) {
    return { text: PENDING[lang] ?? PENDING.zh, missing: true, empty: true };
  }
  if (typeof value[lang] === 'string' && value[lang].trim() !== '') {
    return { text: value[lang], missing: false, empty: false };
  }
  // 回退链：目标语言 -> 中文 -> 任意可用语言 -> 待补
  const fallback =
    (typeof value.zh === 'string' && value.zh.trim() && value.zh) ||
    LANGS.map((l) => value[l]).find((t) => typeof t === 'string' && t.trim());
  if (fallback) {
    return { text: fallback, missing: true, empty: false };
  }
  return { text: PENDING[lang] ?? PENDING.zh, missing: true, empty: true };
}

// 供调试/测试：一条目在某语言下是否缺失
export function isMissing(value, lang) {
  return L(value, lang).missing;
}

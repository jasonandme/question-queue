((root) => {
  const SITE_RULES = [
    { host: "chatgpt.com", name: "ChatGPT", type: "chat" },
    { host: "chat.openai.com", name: "ChatGPT", type: "chat" },
    { host: "claude.ai", name: "Claude", type: "chat" },
    { host: "gemini.google.com", name: "Gemini", type: "chat" },
    { host: "chat.deepseek.com", name: "DeepSeek", type: "chat" },
    { host: "grok.com", name: "Grok", type: "chat" },
    { host: "poe.com", name: "Poe", type: "chat" },
    { host: "copilot.microsoft.com", name: "Copilot", type: "chat" },
    { host: "www.doubao.com", name: "豆包", type: "chat" },
    { host: "yuanbao.tencent.com", name: "腾讯元宝", type: "chat" },
    {
      host: "csdn.net", name: "CSDN", type: "article", subdomains: true,
      titleSelectors: ["h1.title-article", "h1#articleContentId", ".article-title-box h1", "h1"]
    },
    {
      host: "zhihu.com", name: "知乎", type: "article", subdomains: true,
      titleSelectors: ["h1.Post-Title", "h1.QuestionHeader-title", ".Post-Title", ".QuestionHeader-title", "h1"]
    }
  ];

  const TRACKING_PARAMS = new Set([
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "spm", "from", "source", "share_token", "utm_id"
  ]);

  function hostname(value) {
    try { return new URL(value).hostname.toLocaleLowerCase(); } catch { return ""; }
  }

  function findRule(value) {
    const host = String(value || "").toLocaleLowerCase();
    return SITE_RULES.find((rule) => host === rule.host || (rule.subdomains && host.endsWith(`.${rule.host}`))) || null;
  }

  function getSiteName(value) {
    const host = value && !String(value).includes("://") ? String(value) : hostname(value);
    return findRule(host)?.name || host || "其他网页";
  }

  function getSiteType(value) {
    const host = value && !String(value).includes("://") ? String(value) : hostname(value);
    return findRule(host)?.type || "page";
  }

  function isChatSite(value) {
    return getSiteType(value) === "chat";
  }

  function isLearningSite(value) {
    return getSiteType(value) === "article";
  }

  function selectorValue(documentRef, selector) {
    const element = documentRef?.querySelector?.(selector);
    if (!element) return "";
    return String(element.content || element.textContent || "").replace(/\s+/g, " ").trim();
  }

  function articleTitle(documentRef, rule, fallback) {
    const selectors = [
      ...(rule?.titleSelectors || []),
      "meta[property='og:title']",
      "meta[name='twitter:title']"
    ];
    for (const selector of selectors) {
      const value = selectorValue(documentRef, selector);
      if (value) return value;
    }
    return String(fallback || "").trim();
  }

  function canonicalUrl(documentRef, fallback) {
    const declared = documentRef?.querySelector?.("link[rel='canonical']")?.href
      || selectorValue(documentRef, "meta[property='og:url']")
      || fallback;
    try {
      const url = new URL(declared, fallback);
      url.hash = "";
      Array.from(url.searchParams.keys()).forEach((key) => {
        if (TRACKING_PARAMS.has(key.toLocaleLowerCase())) url.searchParams.delete(key);
      });
      return url.href;
    } catch {
      return String(fallback || "");
    }
  }

  function cleanTitle(title, site) {
    let value = String(title || "").replace(/\s+/g, " ").trim();
    const suffixes = [
      site, "CSDN博客", "CSDN", "知乎", "ChatGPT", "Claude", "Gemini", "DeepSeek",
      "Grok", "Poe", "Microsoft Copilot", "豆包", "腾讯元宝"
    ];
    suffixes.filter(Boolean).forEach((suffix) => {
      const escaped = String(suffix).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      value = value.replace(new RegExp(`\\s*[-|·—–_]+\\s*${escaped}\\s*$`, "i"), "").trim();
    });
    return value;
  }

  function sourceKey(url, title, site) {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/\/+$/, "") || "/";
      if (path !== "/") return `${parsed.origin}${path}`;
    } catch {
      // A title key keeps legacy and restricted pages groupable.
    }
    return `title:${site || "other"}:${title || "untitled"}`;
  }

  function deriveSourceMeta({ url = "", title = "", document: documentRef } = {}) {
    const host = hostname(url);
    const rule = findRule(host);
    const site = rule?.name || host || "其他网页";
    const sourceType = rule?.type || "page";
    const sourceUrl = canonicalUrl(documentRef, url);
    const rawTitle = sourceType === "article" ? articleTitle(documentRef, rule, title) : title;
    const fallbackTitle = sourceType === "article" ? "未命名文章" : (sourceType === "chat" ? "未命名对话" : "未命名页面");
    const sourceTitle = cleanTitle(rawTitle, site) || `${site} ${fallbackTitle}`;
    return {
      site,
      sourceType,
      sourceTitle,
      sourceUrl,
      sourceId: sourceKey(sourceUrl, sourceTitle, site)
    };
  }

  root.QuestionQueueSites = Object.freeze({
    SITE_RULES,
    hostname,
    findRule,
    getSiteName,
    getSiteType,
    isChatSite,
    isLearningSite,
    cleanTitle,
    sourceKey,
    deriveSourceMeta
  });
})(globalThis);

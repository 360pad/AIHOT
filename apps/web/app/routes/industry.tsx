import { useMemo, useState } from "react";
import { INDUSTRY_ARTICLES, filterIndustryArticles, type IndustryArticle, type ViewKey } from "../lib/industry-data";
import {
  IconBookmark,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconDoc,
  IconExternal,
  IconFlame,
  IconGrid,
  IconList,
  IconMenu,
  IconSearch,
  IconBolt,
} from "../components/icons";

const CATEGORY_NAV = [
  { key: "all", label: "全部行业", icon: IconGrid },
  { key: "geology", label: "地质与矿业", icon: IconFlame },
  { key: "water", label: "水利水务", icon: IconBolt },
  { key: "government", label: "数字政府与城市治理", icon: IconGrid },
  { key: "gis", label: "GIS 与测绘地理信息", icon: IconList },
  { key: "construction", label: "数字建筑与智慧工地", icon: IconGrid },
] as const;

export const meta = () => [{ title: "行业动态 · Tender Radar" }, { name: "description", content: "行业动态、技术研究与同行资料的站内阅读工作区" }];

export default function IndustryPage() {
  const [category, setCategory] = useState("geology");
  const [view, setView] = useState<ViewKey>("today");
  const [query, setQuery] = useState("");
  const [contentKind, setContentKind] = useState<"all" | IndustryArticle["kind"]>("all");
  const [collectionWindow, setCollectionWindow] = useState<"all" | "today" | "history">("all");
  const [openFilter, setOpenFilter] = useState<"kind" | "time" | null>(null);
  const [secondaryCollapsed, setSecondaryCollapsed] = useState(false);
  const [readerExpanded, setReaderExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState(INDUSTRY_ARTICLES[0]!.id);
  const [followedSources, setFollowedSources] = useState(() => new Set(["地质", "超图软件", "水利研究", "龙软科技"]));
  const [favorites, setFavorites] = useState(() => new Set<string>());
  const [confirmUnfollow, setConfirmUnfollow] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const visible = useMemo(() => {
    return filterIndustryArticles(INDUSTRY_ARTICLES, view, category, query).filter((article) => {
      if (contentKind !== "all" && article.kind !== contentKind) return false;
      if (collectionWindow === "today" && !article.discoveredAt.startsWith("2026-10-13")) return false;
      if (collectionWindow === "history" && Number(article.publishedAt.slice(0, 4)) >= 2026) return false;
      return true;
    });
  }, [view, category, query, contentKind, collectionWindow]);
  const selected = INDUSTRY_ARTICLES.find((article) => article.id === selectedId && visible.some((item) => item.id === article.id)) ?? visible[0];
  const readerArticle = selected ?? INDUSTRY_ARTICLES[0]!;
  const followed = followedSources.has(readerArticle.source);
  const todayCount = filterIndustryArticles(INDUSTRY_ARTICLES, "today", category, query).filter((article) => contentKind === "all" || article.kind === contentKind).length;

  const toggleFavorite = () => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(readerArticle.id)) next.delete(readerArticle.id);
      else next.add(readerArticle.id);
      return next;
    });
  };

  const confirmSourceUnfollow = () => {
    if (!confirmUnfollow) return;
    setFollowedSources((current) => {
      const next = new Set(current);
      next.delete(confirmUnfollow);
      return next;
    });
    setNotice(`已取消关注「${confirmUnfollow}」，历史文章仍保留`);
    setConfirmUnfollow(null);
  };

  return (
    <div className={`industry-page ${readerExpanded ? "is-reader-expanded" : ""}`}>
      <div className="industry-layout">
        <aside className="industry-secondary-nav" aria-label="行业动态分类">
          <div className="industry-secondary-heading">
            <span className={secondaryCollapsed ? "sr-only" : undefined}>行业分类</span>
            <button type="button" className="industry-secondary-collapse" aria-label={secondaryCollapsed ? "展开行业分类" : "收起行业分类"} onClick={() => setSecondaryCollapsed((collapsed) => !collapsed)}><IconMenu size={17} /></button>
          </div>
          <nav className={`industry-secondary-list ${secondaryCollapsed ? "is-collapsed" : ""}`}>
            {CATEGORY_NAV.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" onClick={() => setCategory(key)} className={`industry-secondary-item ${category === key ? "is-active" : ""}`} aria-pressed={category === key}>
                <Icon size={19} />
                <span>{label}</span>
                <span className="industry-count">{filterIndustryArticles(INDUSTRY_ARTICLES, "today", key, "").length}</span>
              </button>
            ))}
          </nav>
          <div className={`industry-secondary-note ${secondaryCollapsed ? "is-collapsed" : ""}`}>
            <span className="industry-note-dot" />
            <span>二级菜单数字表示今天实际新增文档</span>
          </div>
        </aside>

        <main className="industry-main">
          <header className="industry-heading">
            <div>
              <h1>行业动态 · {CATEGORY_NAV.find((item) => item.key === category)?.label ?? "全部行业"}</h1>
              <p>技术研究、产品变化与同行资料的低频增量阅读</p>
            </div>
            <div className="industry-refresh-copy">
              <span>每日 08:00、17:00 更新</span>
              <span>最近更新：10月13日 17:00</span>
            </div>
          </header>

          <div className="industry-toolbar">
            <label className="industry-search">
              <span className="sr-only">搜索文章、企业、产品或技术主题</span>
              <IconSearch size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文章、企业、产品或技术主题" />
              {query && <button type="button" aria-label="清空搜索" onClick={() => setQuery("")}><IconClose size={15} /></button>}
            </label>
            <div className="industry-filter-wrap">
              <button type="button" className="industry-filter-button" aria-expanded={openFilter === "kind"} onClick={() => setOpenFilter((current) => current === "kind" ? null : "kind")}>{contentKind === "all" ? "内容类型" : contentKind} <IconChevronDown size={15} /></button>
              {openFilter === "kind" && <div className="industry-filter-menu" role="menu">
                {(["all", "学术论文", "企业动向", "技术研究", "产品与软件"] as const).map((kind) => <button key={kind} type="button" role="menuitem" onClick={() => { setContentKind(kind); setOpenFilter(null); }}>{kind === "all" ? "全部类型" : kind}</button>)}
              </div>}
            </div>
            <div className="industry-filter-wrap">
              <button type="button" className="industry-filter-button" aria-expanded={openFilter === "time"} onClick={() => setOpenFilter((current) => current === "time" ? null : "time")}>{collectionWindow === "all" ? "收录时间" : collectionWindow === "today" ? "今日收录" : "历史原文"} <IconChevronDown size={15} /></button>
              {openFilter === "time" && <div className="industry-filter-menu" role="menu">
                {(["all", "today", "history"] as const).map((window) => <button key={window} type="button" role="menuitem" onClick={() => { setCollectionWindow(window); setOpenFilter(null); }}>{window === "all" ? "全部时间" : window === "today" ? "今日收录" : "历史原文"}</button>)}
              </div>}
            </div>
          </div>

          <div className="industry-content-grid">
            <section className="industry-list" aria-label="行业动态列表">
              <div className="industry-view-tabs" role="tablist" aria-label="资料时间范围">
                {([
                  ["today", "今日获取"],
                  ["recent", "最近 7 日"],
                  ["history", "历史资料"],
                  ["all", "全部"],
                ] as Array<[ViewKey, string]>).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)} className={`industry-view-tab ${view === key ? "is-active" : ""} ${key === "history" ? "is-history" : ""}`}>
                    {label}{key === "today" && <span className="industry-tab-count">{todayCount}</span>}
                  </button>
                ))}
              </div>

              <div className="industry-summary-row">
                <span><strong>今日获取</strong> {todayCount} 篇</span>
                <span>·</span>
                <span>历史资料 2,481 篇</span>
              </div>

              <div className="industry-day-heading">
                <strong>10月13日</strong>
                <IconChevronDown size={15} />
                <span>今天共 {visible.length} 篇</span>
              </div>
              {visible.length === 0 ? (
                <div className="industry-empty">没有符合当前筛选的资料，请调整关键词或时间范围。</div>
              ) : (
                visible.map((article) => {
                    const isSelected = article.id === selected?.id;
                  const isHistory = Number(article.publishedAt.slice(0, 4)) < 2026;
                  return (
                    <button key={article.id} type="button" onClick={() => setSelectedId(article.id)} className={`industry-article-row ${isSelected ? "is-selected" : ""}`} aria-pressed={isSelected}>
                      <time>{article.discoveredAt.slice(11, 16)}</time>
                      <span className="industry-article-rail"><span /></span>
                      <span className="industry-article-body">
                        <span className="industry-article-title-row">
                          <span className="industry-article-title">{article.title}</span>
                          {article.score !== null && <span className="industry-score">AI 参考价值 {article.score}</span>}
                        </span>
                        <span className="industry-article-tags">
                          <span className={article.kind === "学术论文" || article.kind === "技术研究" ? "tag-research" : "tag-business"}>{article.kind}</span>
                          <span className={isHistory ? "tag-history" : "tag-today"}>{isHistory ? "历史资料" : "今日获取"}</span>
                          {article.topics.slice(0, 2).map((topic) => <span key={topic}>{topic}</span>)}
                        </span>
                        <span className="industry-article-summary">{article.summary}</span>
                        <span className="industry-article-dates">原文发布 {article.publishedAt} <i /> 系统收录 {article.discoveredAt}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </section>

            {selected && <article className={`industry-reader ${readerExpanded ? "is-expanded" : ""}`} aria-label="站内 Markdown 阅读器">
              <header className="industry-reader-header">
                <div className="industry-reader-title"><IconDoc size={20} /><strong>站内阅读 · 已保存 Markdown</strong><span className="industry-saved-badge"><IconCheck size={13} /> 正文完整</span></div>
                <button type="button" className="industry-reader-expand" aria-label={readerExpanded ? "收起阅读器" : "展开阅读器"} aria-expanded={readerExpanded} onClick={() => setReaderExpanded((expanded) => !expanded)}><IconChevronRight size={17} /></button>
              </header>
              <div className="industry-reader-layout">
                <aside className="industry-outline" aria-label="本文目录">
                  {readerArticle.sections.filter((section) => section.heading).map((section) => <a key={section.heading} href={`#${readerArticle.id}-${section.heading}`}>{section.heading}</a>)}
                  <a href="#industry-data">数据输入</a>
                  <a href="#industry-limits">模型限制</a>
                </aside>
                <div className="industry-reader-content">
                  <div className="industry-reader-kicker">{readerArticle.kind} · {readerArticle.category}</div>
                  <h2>{readerArticle.title}</h2>
                  <div className="industry-source-row">
                    <span>来源：{readerArticle.source}</span>
                    <span className={`industry-follow-status ${followed ? "is-followed" : "is-unfollowed"}`}><IconCheck size={13} /> {followed ? "已关注" : "已取消关注"}</span>
                    <button type="button" className="industry-unfollow-button" onClick={() => followed ? setConfirmUnfollow(readerArticle.source) : setFollowedSources((current) => new Set(current).add(readerArticle.source))}>{followed ? "取消关注" : "重新关注"}</button>
                  </div>
                  <div className="industry-reader-dates">原文发布 {readerArticle.publishedAt} <i /> 系统收录 {readerArticle.discoveredAt}</div>
                  <div className="industry-prose">
                    <p>{readerArticle.summary}</p>
                    {readerArticle.sections.map((section, index) => section.heading ? (
                      <section key={`${readerArticle.id}-${section.heading}`}>
                        <h3 id={`${selected.id}-${section.heading}`}>{section.heading}</h3>
                        <p>{section.text}</p>
                        {index === 0 && <img src="/assets/industry-geology-model.png" alt="三维地质模型示意图" />}
                      </section>
                    ) : (
                      <blockquote key={`${readerArticle.id}-quote`}>{section.quote}</blockquote>
                    ))}
                    <h3 id="industry-data">数据输入</h3>
                    <p>钻孔、剖面、测点或监测数据通过本地 Markdown 资料快照保留，原文链接只用于来源核验。</p>
                    <h3 id="industry-limits">模型限制</h3>
                    <p>厂商披露、个人研究和正式论文会分别标注；缺失的正文或互动组件不会被系统伪造成完整内容。</p>
                  </div>
                  <footer className="industry-reader-footer">
                    <button type="button" className={`industry-footer-button ${favorites.has(readerArticle.id) ? "is-active" : ""}`} onClick={toggleFavorite}><IconBookmark size={16} /> {favorites.has(readerArticle.id) ? "已收藏" : "收藏"}</button>
                    <div className="industry-more-wrap">
                      <button type="button" className="industry-footer-button" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><IconMenu size={16} /> 更多</button>
                      {moreOpen && (
                        <div className="industry-more-menu" role="menu">
                          <a href={readerArticle.url} target="_blank" rel="noreferrer" role="menuitem" onClick={() => setMoreOpen(false)}><IconExternal size={15} /> 打开原文</a>
                        </div>
                      )}
                    </div>
                  </footer>
                </div>
              </div>
            </article>}
          </div>
        </main>
      </div>

      {confirmUnfollow && (
        <div className="industry-dialog-backdrop" role="presentation">
          <div className="industry-dialog" role="dialog" aria-modal="true" aria-labelledby="industry-dialog-title">
            <h2 id="industry-dialog-title">取消关注「{confirmUnfollow}」？</h2>
            <p>确认后将停止该信源的后续采集，已经保存的文章、收藏和历史记录仍会保留。</p>
            <div className="industry-dialog-actions">
              <button type="button" className="industry-dialog-secondary" onClick={() => setConfirmUnfollow(null)}>暂不取消</button>
              <button type="button" className="industry-dialog-primary" onClick={confirmSourceUnfollow}>确认取消关注</button>
            </div>
          </div>
        </div>
      )}
      {notice && <button type="button" className="industry-notice" onClick={() => setNotice(null)}>{notice}</button>}
    </div>
  );
}

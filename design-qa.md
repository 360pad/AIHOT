# 首页效果图实现 QA

## 对比目标

- source visual truth: `/Users/360pad/.codex/generated_images/01a12f91-979f-71d0-bbab-9760de151ce4/exec-38b5d6a6-f8a1-4434-9ccb-d0fe2b5fef0a.png`
- implementation: `http://localhost:3002/?stage=tender&category=smart-water`
- implementation screenshot: Chrome tab `202312787`, captured after the final Docker rebuild through the Codex browser session
- source pixels: 1487 × 1057
- implementation capture: browser viewport capture at the same desktop state; Chrome device scale factor 1.6 was recorded, so comparison used normalized composition and CSS geometry rather than raw pixel equality
- state: 招标采购 + 智慧水利，浅色主题，时间轴，AI 评分，预算与截止时间指标
- admin capture: `http://localhost:3002/admin/business`, verified after the final Docker rebuild in a fresh Chrome tab

## Full-view comparison

The final capture was opened after the latest Docker build and compared with the source visual and the user's red-box review screenshot. The three-column proportions now use a 280px business sidebar, a 280px industry navigation column, and the remaining content workspace. The cool blue palette, title block, update copy, search/filter toolbar, timeline rail, AI score pills, and right-side metrics remain in the same order. The repeated middle facts block was removed; each timeline row now uses four direct metric columns for budget, publication date, deadline date, and a highlighted countdown.

## Focused regions

- Left navigation: stage selection, industry selection, divider, daily/favorites, and backend management entry were checked against the source.
- First timeline row: title baseline, rail node, metadata row, score pill, summary line, budget formatting, and deadline column were checked.
- Toolbar: search placeholder and the two filter buttons were checked.
- Admin chrome: the sidebar now uses the same 280px workspace rhythm, blue tokens, wordmark, icon navigation, grouped “信源与业务” section, and shared theme switch as the homepage. Backend links to 信源, 业务匹配, Agent 接入, 关于, and 更新日志 were checked as navigation entries.
- Linked product pages: Agent 接入、关于、更新日志 now mount the same radar shell as the homepage, so their sidebar, page background, cards, borders, and active states use the same cool blue palette.
- Admin route audit: every一级后台菜单 now lands under `/admin/`, including `/admin/agent`, `/admin/about`, and `/admin/changelog`; Agent tab switches and feedback links stay inside the admin namespace.
- Theme control: 深色、浅色、跟随系统 were each selected. The `data-theme`, shell background, sidebar background, and selected radio state changed as expected on both homepage and admin.

## Findings

No actionable P0/P1/P2 visual findings remain. The live data count and article wording differ from the mockup because the database is real; the layout and visual treatment remain aligned.

## Comparison history

1. Initial implementation had a warm paper palette, a 180px sidebar, a 190px industry column, card containers, and a search placeholder that did not match the mockup. Fixed by adding the scoped radar shell palette, 216/248px shell columns, flat timeline rows, right metric columns, and mockup copy.
2. The first visual pass had the timeline card content 22px too far left and raw yuan amounts in the budget column. Fixed by widening the rail track and normalizing amounts to 万元 with thousands separators.
3. Final pass updated the industry icon rhythm, search placeholder, and date row to `今天 / 共 N 条`; interaction checks for industry navigation, stage navigation, and search all completed without console warnings or errors.
4. The visual review found the business-stage sidebar too narrow and the card center too empty. Widened the sidebar and industry column to 280px, increased navigation hit areas, and first added a facts block. A follow-up review found that block duplicated the title metadata, so it was replaced with direct budget, publication date, deadline date, and countdown columns without changing the deferred regional filtering scope.
5. The backend initially kept the warm paper chrome and its theme buttons only changed the document preference while the homepage shell stayed light. Added scoped blue tokens and semantic utility aliases to the shared shell, grouped 信源与业务, added matching icons and theme controls, then verified light/dark/system states in Docker.
6. Moved the homepage’s three “更多” entries into a matching backend sidebar group: Agent 接入、关于、更新日志.

## Implementation Checklist

- [x] Match the three-column desktop composition.
- [x] Match the blue workspace tokens and typography hierarchy.
- [x] Preserve stage and industry navigation as working links.
- [x] Preserve the timeline rail and AI scoring.
- [x] Add budget and deadline metric columns with real-data fallbacks.
- [x] Balance the wide desktop workspace with direct budget, date, deadline, and countdown columns.
- [x] Align backend layout, menu grouping, icons, and theme controls with the homepage shell.
- [x] Put Agent 接入、关于、更新日志 into the backend menu.
- [x] Apply the homepage blue shell palette to Agent 接入、关于、更新日志.
- [x] Keep every backend一级菜单 link under the `/admin/` route namespace.
- [x] Verify light, dark, and system theme buttons change the rendered workspace.
- [x] Rebuild Docker Desktop services and verify the page responds.
- [x] Check browser console logs and primary interactions.

## Follow-up Polish

- P3: replace the generic industry icons with the final product icon set if the team has a preferred library.
- P3: expose structured budget, location, procurement method, and deadline fields from the backend so the metric columns do not need text extraction fallbacks.

## 行业动态效果图实现 QA

### 对比目标

- source visual truth: `/Users/360pad/.codex/generated_images/01a12f91-979f-71d0-bbab-9760de151ce4/exec-f57c854d-2d76-41bb-8111-ac84fbd03bfe.png`
- implementation: `http://localhost:3002/industry`
- implementation capture: Codex in-app browser, viewport 1600 × 900, after the final Docker rebuild
- state: 行业动态 · 地质与矿业，浅色主题，今日获取，时间轴列表，站内 Markdown 阅读器

### Full-view comparison

The implementation keeps the existing Tender Radar shell and adds the reference composition as a parallel industry workspace: primary navigation on the left, a calm secondary category rail, a blue search and time toolbar, a dated timeline with colored status tags and AI reference value, and a split in-app Markdown reader. The reader preserves the saved article body, source status, original publication time, system collection time, outline, image, quote, and favorite action; the more menu now only opens the original external source.

### Focused regions

- Navigation: 招标信息、行业动态、商机日报、收藏 remain in the same primary shell; the industry category rail exposes counts derived from today’s collected documents and can be collapsed and expanded.
- Timeline: 今日获取、最近 7 日、历史资料、全部 tabs work with category and keyword filtering. Article rows keep the time rail, source type, historical/today tags, topics, summary, and dual timestamps.
- Reader: article content stays inside the product, with the saved Markdown badge, source follow state, unfollow confirmation, preserved history notice, table-of-contents links, generated geological model image, quote treatment, favorite state, and a single “打开原文” external link for source verification.
- Toolbar: 内容类型 and 收录时间 menus now apply filters; no-result searches clear the reader and show an explicit empty state.
- Responsive behavior: at 1600px the split workspace fits without horizontal overflow; the reader can expand below the timeline and the mobile breakpoint switches to a single-column reading flow.

### Business and boundary checks

- `node --experimental-strip-types --test apps/web/tests/industry.test.ts`: 3 passed, covering today/history separation, category/search boundaries, and Markdown metadata/blockquote preservation.
- Browser checks: historical tab, content-type filter, collection-time filter, no-result search, category collapse/restore, reader expand, source cancel-follow confirmation, history-preserving notice, and the external source link menu all completed.
- Browser console: no error or warning entries after the final Docker rebuild.

### Findings

No actionable P0/P1/P2 visual or business-flow findings remain. The fixture count and article wording are intentionally representative data for the prototype; the filtering, saved Markdown reader, source state, and empty-state behavior are implemented as real client interactions.

### 2026-10-14 bug-fix verification

- `/` and `/industry` now share the same primary 招标信息 / 行业动态 entries; navigating to 招标信息 keeps 行业动态 available.
- The industry category rail was reduced to 228px, giving the timeline and reader more working width.
- Tabs and the timeline remain in the left panel while the reader starts directly below the search toolbar; its expanded state overlays the complete main workspace, including the timeline, without covering the primary or category navigation.
- At a 1600 × 900 browser viewport, the normal and expanded states were checked with no horizontal overflow and no browser console errors.
- The expanded reader now fills the main workspace to the bottom (`top=180`, `bottom=1149` in the browser’s CSS viewport) and locks the outer page at the viewport height; only the reader itself can scroll when its Markdown body is longer than the viewport.
- The more menu contains exactly one item, “打开原文”, with the article’s original URL and `target=_blank`; the in-product reader remains the full reading surface.
- The backend source detail adds “公众号处理方式”: “仅采集（推荐）” is the default and writes `_aihot.processingMode=collect_only`; “采集并分析” opts the source into the AI queue. Invalid values are rejected before save.
- `node --experimental-strip-types --test tests/source-processing-mode.test.ts apps/web/tests/industry.test.ts`: 6 passed. Docker Node 24 production build and service restart completed; local host `npm run typecheck` reached the web typecheck but was blocked by the host’s Node 22.14.0 runtime, while package-level backend and web `tsc --noEmit` checks passed.

final result: passed

## 业务关键词命中分析页 QA（2026-10-24）

### 设计与实现

- 设计参考：`/Users/360pad/.codex/generated_images/01a16c27-685f-76e3-94ba-df3f35776be7/exec-8c408927-aad0-44df-afd8-4f25759d0876.png`（1505 × 1045 px）。
- 页面：`/admin/keyword-trends`，默认近 30 天、全部行业；旧频次入口会跳转到新路由并保留筛选条件。
- 后台新增独立“关键词趋势”菜单，路由为 `/admin/keyword-trends`。
- 页面提供 7 天 / 30 天 / 全部时间切换、行业分类 tabs、精选与未精选命中 KPI、全部命中正式词条（按频次排序）及轻量动效。统计时间使用文章发布时间，缺失时回退到采集时间；同一篇文章中的同一词条只计一次。
- 口径：精选占比 = 当前已精选文章中的词条命中次数 ÷ 全部词条命中次数；未精选表示命中文章当前没有入选，不代表人工判定不相关。

### 验证与发布

- 本地隔离 PostgreSQL 测试库执行迁移后，后端完整测试：212 项通过；测试容器和临时测试库已清理，主数据库卷未重建。
- 在 Node 24 Docker 运行时执行 `node --experimental-strip-types --test apps/web/tests/*.test.ts`：14 项通过。
- `docker compose build web`：生产构建通过。主机 Node 22.14.0 运行 `npm run typecheck` 时无法加载项目要求的 TypeScript 配置；Docker Node 24 生产构建成功。
- 已发布到 `http://localhost:3002/admin/keyword-trends`，只重建 Web 容器；API、Worker 和主数据库均保持运行状态，未执行迁移、种子导入或重新采集。
- `scripts/smoke.ts --base http://localhost:3000` 在运行中的 Web 容器通过：全部 29 个站点、机器接口和 MCP 检查通过。
- 浏览器实测新菜单与真实数据库数据；近 30 天智慧水利显示 43 次命中（精选 23、未精选 20，占比 53.5%），近 7 天显示 22 次命中（精选 19、未精选 3，占比 86.4%）。
- 初版紧凑布局在 1265 × 711 浏览器视口完成首屏检查；该排版已按下一节图二样式要求调整，当前版验收见下文。

本次页面最终结果：passed（测试、Docker 发布、接口 smoke 和浏览器首屏验收通过）。

### 图二样式与留白调整（2026-10-24）

- 指标卡改为参考图的图标底色、醒目数值、前一等长周期变化和带渐显动画的真实日趋势折线；折线由命中接口的每日统计绘制，精选占比在无命中的日期留空，不把无数据日误显示为 0%。
- 页面恢复后台标准页头留白；版本说明、筛选区、表格文字和行距同步放大。指标卡在常见桌面宽度两列显示，超宽屏切换为四列，避免卡片内数字挤压。
- Node 24 `npm run typecheck` 与 `npm run build -w @aihot/web` 通过；隔离 `aihot_keyword_trends_test` 数据库迁移后，后端测试 212/212 通过；Web 测试 14/14 通过。
- 新镜像发布到本地 Docker 的 API 与 Web；数据库和 Worker 容器保持原样。Web smoke 29/29 通过。
- 浏览器实测：30 天全行业合计 389 次命中；7 天智慧水利 22 次（精选 19、未精选 3、精选占比 86.4%）。1265 × 711 视口下两列布局中的百分比数值完整显示，行业和时间筛选联动正常。
- 后续按界面反馈移除占用高度的正式词库版本信息与重复跳转按钮，将统计时间口径并入页头说明；侧边栏仍提供正式词纠错和业务关键词入口。
- 命中排行默认列出当前筛选下全部命中词条，不再截断为前 8 条；标题和计数明确说明全量展示与频次排序，查找框仅用于可选缩小列表。

本次图二样式调整结果：passed（类型检查、构建、测试、Docker 发布和浏览器数据验收通过）。

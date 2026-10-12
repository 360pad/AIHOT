# 首页效果图实现 QA

## 对比目标

- source visual truth: `/Users/360pad/.codex/generated_images/01a12f91-979f-71d0-bbab-9760de151ce4/exec-38b5d6a6-f8a1-4434-9ccb-d0fe2b5fef0a.png`
- implementation: `http://localhost:3002/?stage=tender&category=smart-water`
- implementation screenshot: Chrome tab `202312787`, captured after the final Docker rebuild through the Codex browser session
- source pixels: 1487 × 1057
- implementation capture: browser viewport capture at the same desktop state; Chrome device scale factor 1.6 was recorded, so comparison used normalized composition and CSS geometry rather than raw pixel equality
- state: 招标采购 + 智慧水利，浅色主题，时间轴，AI 评分，预算与截止时间指标

## Full-view comparison

The final capture was opened after the latest Docker build and compared with the source visual and the user's red-box review screenshot. The three-column proportions now use a 280px business sidebar, a 280px industry navigation column, and the remaining content workspace. The cool blue palette, title block, update copy, search/filter toolbar, timeline rail, AI score pills, and right-side budget/deadline columns remain in the same order. Each timeline row now uses a compact four-cell facts block for source, procurement method, industry, and publication date, so the middle workspace is intentional rather than empty.

## Focused regions

- Left navigation: stage selection, industry selection, divider, daily/favorites, and backend management entry were checked against the source.
- First timeline row: title baseline, rail node, metadata row, score pill, summary line, budget formatting, and deadline column were checked.
- Toolbar: search placeholder and the two filter buttons were checked.

## Findings

No actionable P0/P1/P2 visual findings remain. The live data count and article wording differ from the mockup because the database is real; the layout and visual treatment remain aligned.

## Comparison history

1. Initial implementation had a warm paper palette, a 180px sidebar, a 190px industry column, card containers, and a search placeholder that did not match the mockup. Fixed by adding the scoped radar shell palette, 216/248px shell columns, flat timeline rows, right metric columns, and mockup copy.
2. The first visual pass had the timeline card content 22px too far left and raw yuan amounts in the budget column. Fixed by widening the rail track and normalizing amounts to 万元 with thousands separators.
3. Final pass updated the industry icon rhythm, search placeholder, and date row to `今天 / 共 N 条`; interaction checks for industry navigation, stage navigation, and search all completed without console warnings or errors.
4. The visual review found the business-stage sidebar too narrow and the card center too empty. Widened the sidebar and industry column to 280px, increased navigation hit areas, and added the facts block between the project summary and budget/deadline metrics without changing the deferred regional filtering scope. Rebuilt Docker and rechecked the all-industry and smart-water homepage states.

## Implementation Checklist

- [x] Match the three-column desktop composition.
- [x] Match the blue workspace tokens and typography hierarchy.
- [x] Preserve stage and industry navigation as working links.
- [x] Preserve the timeline rail and AI scoring.
- [x] Add budget and deadline metric columns with real-data fallbacks.
- [x] Balance the wide desktop workspace with a project facts block between summary and metrics.
- [x] Rebuild Docker Desktop services and verify the page responds.
- [x] Check browser console logs and primary interactions.

## Follow-up Polish

- P3: replace the generic industry icons with the final product icon set if the team has a preferred library.
- P3: expose structured budget, location, procurement method, and deadline fields from the backend so the metric columns do not need text extraction fallbacks.

final result: passed

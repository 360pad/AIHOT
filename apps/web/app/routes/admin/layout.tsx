import { FEATURES } from "@aihot/industry/features";
import { SITE } from "@aihot/industry/site";
import { motion } from "motion/react";
import { NavLink, Outlet, useLocation, useNavigation, type ShouldRevalidateFunction } from "react-router";
import type { ReactNode } from "react";
import type { Route } from "./+types/layout";
import { Wordmark } from "../../components/Logo";
import {
  IconApps,
  IconChart,
  IconClock,
  IconDoc,
  IconGrid,
  IconHeart,
  IconHistory,
  IconInfo,
  IconMessage,
  IconPlug,
  type P,
} from "../../components/icons";
import { ThemeSwitch } from "../../components/shell/ThemeSwitch";
import { NavigationProgress } from "../../components/shell/Chrome";
import type { AdminMe } from "../../features/admin/action";
import { Toaster } from "../../features/admin/toast";
import { adminGet } from "../../lib/admin.server";

type Counts = Partial<Record<"feedback" | "sources" | "runs" | "monitor", number>>;

export async function loader({ request }: Route.LoaderArgs) {
  const [me, counts] = await Promise.all([adminGet<AdminMe>(request, "/api/admin/me"), adminGet<Counts>(request, "/api/admin/nav-counts").catch(() => ({}) as Counts)]);
  return { me, counts };
}

// Counts follow every navigation and command; the identity does not change.
export const shouldRevalidate: ShouldRevalidateFunction = () => true;

export const meta: Route.MetaFunction = () => [{ title: `${SITE.name} 后台` }, { name: "robots", content: "noindex, nofollow" }];

export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });

type AdminIcon = (props: Pick<P, "size">) => ReactNode;

const NAV: Array<{ group: string; items: Array<{ to: string; label: string; count?: keyof Counts; tone?: "bad" | "accent"; icon: AdminIcon }> }> = [
  {
    group: "内容",
    items: [
      { to: "/admin/content", label: "内容诊断", icon: IconDoc },
      { to: "/admin/feedback", label: "反馈", count: "feedback", tone: "accent", icon: IconMessage },
      ...(FEATURES.codexResetMonitor ? [{ to: "/admin/monitor", label: "Codex 重置", count: "monitor" as const, tone: "accent" as const, icon: IconClock }] : []),
    ],
  },
  {
    group: "信源与业务",
    items: [
      { to: "/admin/sources", label: "信源", count: "sources", tone: "bad", icon: IconPlug },
      { to: "/admin/business", label: "业务匹配", icon: IconGrid },
    ],
  },
  {
    group: "系统",
    items: [
      { to: "/admin/runs", label: "运行", count: "runs", tone: "bad", icon: IconHistory },
      { to: "/admin/models", label: "模型与评测", icon: IconChart },
      { to: "/admin/selectbench", label: "SelectBench", icon: IconApps },
      { to: "/admin/settings", label: "设置", icon: IconInfo },
      { to: "/admin/audit", label: "审计记录", icon: IconHistory },
    ],
  },
  {
    group: "更多",
    items: [
      { to: "/admin/agent", label: "Agent 接入", icon: IconPlug },
      { to: "/admin/about", label: "关于", icon: IconHeart },
      { to: "/admin/changelog", label: "更新日志", icon: IconHistory },
    ],
  },
];

function NavItem({ to, label, count, tone, icon: Icon }: { to: string; label: string; count?: number; tone?: "bad" | "accent"; icon: AdminIcon }) {
  return (
    <NavLink to={to} prefetch="intent" className="group relative block">
      {({ isActive }) => (
        <span className={`radar-admin-nav-item ${isActive ? "is-active" : ""}`}>
          {isActive && <motion.span layoutId="admin-nav" className="absolute inset-0 rounded-control bg-accent-soft" transition={{ type: "spring", stiffness: 520, damping: 38 }} />}
          <span className="radar-admin-nav-icon relative"><Icon size={18} /></span>
          <span className="relative min-w-0 flex-1 truncate">{label}</span>
          {!!count && (
            <span className={`num relative min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 ${tone === "bad" ? "bg-hot text-white" : "bg-accent-soft text-accent"}`}>{count}</span>
          )}
        </span>
      )}
    </NavLink>
  );
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { me, counts } = loaderData;
  const navigation = useNavigation();
  const location = useLocation();
  const flat = NAV.flatMap((g) => g.items);
  return (
    <div className="radar-shell radar-admin-shell flex min-h-dvh">
      <NavigationProgress active={navigation.state === "loading"} />
      <aside className="radar-admin-sidebar sticky top-0 hidden h-dvh w-[280px] shrink-0 flex-col border-r px-4 py-5 lg:flex">
        <a href="/" className="radar-admin-brand mb-8 flex items-center gap-3 px-3">
          <Wordmark size={23} />
          <span className="radar-admin-brand-subtitle">后台管理</span>
        </a>
        <nav className="radar-admin-nav flex-1 space-y-6 overflow-y-auto">
          {NAV.map((g) => (
            <div key={g.group} className="radar-admin-nav-group">
              <div className="radar-admin-nav-label">{g.group}</div>
              <div className="space-y-1">
                {g.items.map((i) => (
                  <NavItem key={i.to} to={i.to} label={i.label} count={i.count ? counts[i.count] : undefined} tone={i.tone} icon={i.icon} />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="radar-admin-footer mt-4 border-t px-2 pt-4 text-[12.5px]">
          <ThemeSwitch className="w-full" />
          <div className="mt-4 flex items-center justify-between gap-2 text-ink-3">
            <span className="truncate">{me.name}</span>
            {me.dev && <span className="rounded bg-amber/15 px-1.5 text-[11px] font-medium text-amber">开发</span>}
          </div>
          <form method="post" action="/api/auth/logout" className="mt-1.5">
            <button type="submit" className="text-ink-4 hover:text-ink-2">退出登录</button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="radar-admin-mobile-bar sticky top-0 z-40 border-b backdrop-blur lg:hidden">
          <div className="flex items-center gap-2 px-4 pt-3">
            <Wordmark size={18} />
            <span className="radar-admin-brand-subtitle">后台管理</span>
            {me.dev && <span className="rounded bg-amber/15 px-1.5 text-[11px] font-medium text-amber">开发</span>}
          </div>
          <nav className="no-scrollbar flex gap-1 overflow-x-auto px-3 py-2">
            {flat.map((i) => {
              const active = location.pathname === i.to || location.pathname.startsWith(`${i.to}/`);
              const n = i.count ? counts[i.count] : 0;
              return (
                <NavLink key={i.to} to={i.to} className={`radar-admin-mobile-link shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[13px] ${active ? "is-active" : ""}`}>
                  {i.label}
                  {!!n && <span className="num ml-1 text-[11px] opacity-70">{n}</span>}
                </NavLink>
              );
            })}
          </nav>
        </div>
        <main className="radar-admin-main min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}

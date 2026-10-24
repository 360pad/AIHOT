const PROCUREMENT_TYPES = new Set(["procurement_intention", "tender_plan", "pre_bid_notice", "tender_notice"]);
const MAINTENANCE = /运维|运行维护|维护服务|运维服务|运行保障|运营维护|软件维护|系统维护/;
const SOFTWARE = /软件|系统|应用/;
const CITY = /马鞍山/;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Narrow editorial exception for Ma'anshan software maintenance opportunities. */
export function isMaanshanSoftwareMaintenance(input: {
  enabled: boolean;
  sourceTier: string;
  itemType: string | null;
  deadlineStatus: string | null;
  relevance: string | null;
  negativeKeywordHit: boolean;
  articleText: string;
  businessMatch: unknown;
}): boolean {
  if (!input.enabled || input.sourceTier === "EXCLUDE_MP" || input.relevance !== "pass" || input.deadlineStatus !== "open") return false;
  if (!PROCUREMENT_TYPES.has(input.itemType ?? "") || input.negativeKeywordHit || !CITY.test(input.articleText)) return false;

  const business = object(input.businessMatch);
  if (business.label !== "PASS") return false;
  const evidence = new Map<string, string>();
  for (const row of Array.isArray(business.evidence) ? business.evidence : []) {
    const item = object(row);
    if (item.verified === true && typeof item.id === "string" && typeof item.quote === "string") evidence.set(item.id, item.quote);
  }
  const projects = Array.isArray(business.projects) ? business.projects : [];
  return projects.some((projectValue) => {
    const project = object(projectValue);
    const projectText = [project.name, ...strings(project.lots)].filter((v): v is string => typeof v === "string").join(" ");
    const projectEvidence = strings(project.evidenceIds).map((id) => evidence.get(id)).filter((v): v is string => !!v);
    return (Array.isArray(project.tasks) ? project.tasks : []).some((taskValue) => {
      const task = object(taskValue);
      const taskText = [task.name, task.action, task.object, ...strings(task.deliverables)].filter((v): v is string => typeof v === "string").join(" ");
      const taskEvidence = [...projectEvidence, ...strings(task.evidenceIds).map((id) => evidence.get(id)).filter((v): v is string => !!v)];
      if (!MAINTENANCE.test(taskText) || ![projectText, taskText, ...taskEvidence].some((value) => CITY.test(value))) return false;
      return (Array.isArray(task.matches) ? task.matches : []).some((matchValue) => {
        const match = object(matchValue);
        if (match.capabilityId !== "software-platform" || (match.relation !== "direct" && match.relation !== "partial")) return false;
        return strings(match.evidenceIds).some((id) => {
          const quote = evidence.get(id);
          return !!quote && MAINTENANCE.test(quote) && SOFTWARE.test(quote);
        });
      });
    });
  });
}

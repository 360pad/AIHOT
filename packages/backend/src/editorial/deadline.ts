type ProcurementMaterial = { title: string; excerpt?: string | null; bodyText?: string | null };

const DEADLINE_LABEL = /(?:投标文件(?:递交|提交)?截止时间|响应文件(?:递交|提交)?截止时间|提交响应文件截止时间|投标截止时间|响应截止时间|开标时间)\s*(?:为|是|：|:)?\s*([^。；;\n]{0,80})/g;

function validDate(year: number, month: number, day: number, hour: number, minute: number, endOfDay: boolean): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const date = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${endOfDay ? "59.999" : "00.000"}+08:00`);
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day ? null : date;
}

function dateIn(text: string): Date | null {
  const compact = text.replace(/(?<=\d)\s+(?=[\d年月日时点分:：-])/g, "");
  const chinese = compact.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日(?:\s*(\d{1,2})(?:(?:时|点)\s*(\d{1,2})?\s*分?|[:：](\d{2}))?)?/);
  if (chinese) {
    const hasTime = chinese[4] !== undefined;
    return validDate(Number(chinese[1]), Number(chinese[2]), Number(chinese[3]), Number(chinese[4] ?? 23), Number(chinese[5] ?? chinese[6] ?? (hasTime ? 0 : 59)), !hasTime);
  }
  const numeric = compact.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?:日)?(?:\s*(\d{1,2}):(\d{2}))?/);
  if (numeric) return validDate(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]), Number(numeric[4] ?? 23), Number(numeric[5] ?? 59), !numeric[4]);
  return null;
}

/** Reads only dates explicitly attached to a procurement submission/opening deadline label. */
export function explicitProcurementDeadline(material: ProcurementMaterial): Date | null {
  const text = [material.title, material.excerpt, material.bodyText].filter(Boolean).join("\n");
  const deadlines: Date[] = [];
  for (const match of text.matchAll(DEADLINE_LABEL)) {
    const date = dateIn(match[1] ?? "");
    if (date) deadlines.push(date);
  }
  return deadlines.length ? deadlines[deadlines.length - 1]! : null;
}

export function procurementDeadlinePassed(material: ProcurementMaterial, now = new Date()): boolean {
  const deadline = explicitProcurementDeadline(material);
  return deadline !== null && deadline.getTime() < now.getTime();
}

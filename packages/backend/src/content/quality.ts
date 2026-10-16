const EMPTY_CONTRACT_FIELDS = [
  /合同编号[:：]\s*(?:二[、.．]\s*)?合同名称/,
  /合同名称[:：]\s*(?:三[、.．]\s*)?项目编号/,
  /项目编号[^：:]{0,100}[:：]\s*(?:四[、.．]\s*)?项目名称/,
  /项目名称[:：]\s*(?:五[、.．]\s*)?合同主体/,
  /采购人（甲方）[:：]\s*地址[:：]/,
  /供应商（乙方）[:：]\s*地址[:：]/,
  /主要标的信息[:：]\s*规格型号/,
];

/** Some procurement sites return an empty contract-form template instead of the notice body. */
export function isEmptyContractTemplate(text: string | null | undefined): boolean {
  if (!text || text.length > 5_000) return false;
  return EMPTY_CONTRACT_FIELDS.filter((pattern) => pattern.test(text)).length >= 3;
}

/** Prefer a real page body; if it is only a boilerplate form, use the source's actual listing summary. */
export function articleText(bodyText: string | null | undefined, excerpt: string | null | undefined): string | null {
  const body = bodyText?.trim();
  if (body && !isEmptyContractTemplate(body)) return body;
  return excerpt?.trim() || null;
}

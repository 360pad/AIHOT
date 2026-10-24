import { z } from "zod";
import { sql } from "../db.ts";
import { audit } from "./auth.ts";

export type QualificationCategory = "company" | "personnel";
export type BusinessQualification = { id: number; category: QualificationCategory; name: string; createdAt: Date; updatedAt: Date };

const QualificationInput = z.object({
  category: z.enum(["company", "personnel"]),
  name: z.string().trim().min(1, "请输入资质名称").max(160, "资质名称不能超过 160 个字"),
}).strict();
const QualificationPatch = z.object({ name: z.string().trim().min(1, "请输入资质名称").max(160, "资质名称不能超过 160 个字") }).strict();

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase()
    .replaceAll("一建", "一级建造师")
    .replaceAll("二建", "二级建造师")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function invalidId(id: number) {
  return !Number.isSafeInteger(id) || id < 1;
}

function duplicateError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function conflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

export async function listBusinessQualifications(category?: QualificationCategory) {
  const rows = await sql<BusinessQualification[]>`
    SELECT id, category, name, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM business_qualifications
    WHERE deleted_at IS NULL AND (${category ?? null}::text IS NULL OR category = ${category ?? null})
    ORDER BY category, name, id`;
  return { rows };
}

export async function createBusinessQualification(input: unknown, actor: string) {
  const value = QualificationInput.parse(input);
  try {
    const [row] = await sql<BusinessQualification[]>`
      INSERT INTO business_qualifications (category, name, normalized_name, created_by, updated_by)
      VALUES (${value.category}, ${value.name}, ${normalizeName(value.name)}, ${actor}, ${actor})
      RETURNING id, category, name, created_at AS "createdAt", updated_at AS "updatedAt"`;
    await audit(actor, "business.qualification.create", `qualification:${row!.id}`, null, null, row);
    return row;
  } catch (error) {
    if (duplicateError(error)) throw conflict("这个资质已在清单中");
    throw error;
  }
}

export async function updateBusinessQualification(id: number, input: unknown, actor: string) {
  if (invalidId(id)) return null;
  const value = QualificationPatch.parse(input);
  const [before] = await sql<BusinessQualification[]>`
    SELECT id, category, name, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM business_qualifications WHERE id = ${id} AND deleted_at IS NULL`;
  if (!before) return null;
  try {
    const [after] = await sql<BusinessQualification[]>`
      UPDATE business_qualifications SET name = ${value.name}, normalized_name = ${normalizeName(value.name)},
        updated_by = ${actor}, updated_at = now()
      WHERE id = ${id} AND deleted_at IS NULL
      RETURNING id, category, name, created_at AS "createdAt", updated_at AS "updatedAt"`;
    if (!after) return null;
    await audit(actor, "business.qualification.update", `qualification:${id}`, null, before, after);
    return after;
  } catch (error) {
    if (duplicateError(error)) throw conflict("这个资质已在清单中");
    throw error;
  }
}

export async function deleteBusinessQualification(id: number, actor: string) {
  if (invalidId(id)) return null;
  const [before] = await sql<BusinessQualification[]>`
    SELECT id, category, name, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM business_qualifications WHERE id = ${id} AND deleted_at IS NULL`;
  if (!before) return null;
  await sql`UPDATE business_qualifications SET deleted_at = now(), updated_by = ${actor}, updated_at = now() WHERE id = ${id}`;
  await audit(actor, "business.qualification.delete", `qualification:${id}`, null, before, { ...before, deleted: true });
  return { id };
}

export function assessQualificationRequirements(
  requirements: Array<{ kind: QualificationCategory; requirement: string; evidenceIds: string[] }>,
  qualifications: Array<{ id: number; category: QualificationCategory; name: string }>,
) {
  return requirements.map((item) => {
    const required = normalizeName(item.requirement);
    const match = qualifications.find((qualification) => {
      if (qualification.category !== item.kind) return false;
      const available = normalizeName(qualification.name);
      return available === required || (Math.min(available.length, required.length) >= 5 && (available.includes(required) || required.includes(available)));
    });
    return { ...item, matchedName: match?.name ?? null };
  });
}

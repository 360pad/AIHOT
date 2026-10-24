import { Link } from "react-router";

export const meta = () => [
  { title: "行业动态" },
  { name: "description", content: "行业动态栏目尚未接入真实信源" },
];

export default function IndustryPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16 lg:px-8">
      <p className="text-sm font-medium text-ink-4">行业观察 · P1</p>
      <h1 className="mt-3 text-3xl font-bold text-ink">行业动态尚未上线</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-ink-3">
        当前版本尚未接入行业动态信源和资料库。正式接入前不展示示例文章，也不提供会让人误以为已保存的收藏或关注操作。
      </p>
      <Link to="/" className="mt-8 inline-flex rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-700">
        返回招标信息
      </Link>
    </main>
  );
}

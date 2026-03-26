import { redirect } from "next/navigation";

// 执行已内联到首页，此路由重定向回首页
export default async function RunPage() {
  redirect("/");
}

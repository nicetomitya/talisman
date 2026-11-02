import { Suspense } from "react";
import { ApiForm } from "@/components/client";
import { TokenAction } from "@/components/auth";
export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const sp = await searchParams;
  return (
    <section className="card mx-auto max-w-md"><h1 className="mb-3 text-xl font-semibold">Восстановление пароля</h1>
      {sp.token ? <Suspense><TokenAction url="/api/auth/reset" label="Сохранить пароль" extraPassword /></Suspense> :
        <ApiForm url="/api/auth/reset-request" submit="Отправить ссылку" successText="Если аккаунт существует, ссылка отправлена в демопочту" fields={[{ name: "email", label: "Email", type: "email", required: true }]} />}
    </section>
  );
}

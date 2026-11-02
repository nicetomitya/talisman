import { Suspense } from "react";
import { TokenAction } from "@/components/auth";
export default function Verify() {
  return <section className="card mx-auto max-w-md"><h1 className="mb-3 text-xl font-semibold">Подтверждение email</h1><Suspense><TokenAction url="/api/auth/verify" label="Подтвердить email" /></Suspense></section>;
}

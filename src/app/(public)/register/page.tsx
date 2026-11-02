import { ApiForm } from "@/components/client";
export const metadata = { title: "Регистрация" };
export default function Register() {
  return (
    <section className="card mx-auto max-w-md"><h1 className="mb-1 text-xl font-semibold">Регистрация клиента</h1>
      <p className="mb-4 text-sm text-muted">Для демо используйте вымышленный адрес на домене .test. Письмо с подтверждением придёт в демопочту на странице входа.</p>
      <ApiForm url="/api/auth/register" submit="Зарегистрироваться" successText="Аккаунт создан. Подтвердите email по ссылке из демопочты на странице входа." resetOnSuccess fields={[
        { name: "name", label: "Имя", required: true, autoComplete: "name" },
        { name: "email", label: "Email", type: "email", required: true, autoComplete: "email" },
        { name: "password", label: "Пароль", type: "password", required: true, hint: "Не короче 10 символов, буквы и цифры", autoComplete: "new-password" },
        { name: "consentPd", label: "Согласен на обработку персональных данных (версия pd-2026-11-v1)", type: "checkbox" },
        { name: "consentTerms", label: "Принимаю условия использования сервиса (версия terms-2026-11-v1)", type: "checkbox" },
        { name: "consentMarketing", label: "Хочу получать подборки и предложения (необязательно)", type: "checkbox" },
      ]} />
    </section>
  );
}

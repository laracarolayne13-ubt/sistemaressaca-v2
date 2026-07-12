import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Entrar — Painel Ressaca" }] }),
  component: Login,
});

function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function entrar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro("");
    setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    setEnviando(false);
    if (error) setErro("E-mail ou senha inválidos.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[oklch(0.14_0.02_240)] p-4 text-white">
      <form onSubmit={entrar} className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-7 shadow-2xl backdrop-blur">
        <div className="mb-6 text-center">
          <div className="text-3xl">🏄‍♂️</div>
          <h1 className="mt-2 text-xl font-bold">Painel da Portaria</h1>
          <p className="mt-1 text-sm text-white/60">Entre para gerenciar as encomendas.</p>
        </div>
        <label className="mb-1 block text-xs font-semibold uppercase text-white/60">E-mail</label>
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mb-4 w-full rounded-lg border border-white/10 bg-black/20 p-3 outline-none focus:border-primary" placeholder="voce@exemplo.com" />
        <label className="mb-1 block text-xs font-semibold uppercase text-white/60">Senha</label>
        <input type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} className="w-full rounded-lg border border-white/10 bg-black/20 p-3 outline-none focus:border-primary" placeholder="Sua senha" />
        {erro && <p role="alert" className="mt-3 text-sm text-red-300">{erro}</p>}
        <button disabled={enviando} className="mt-5 w-full rounded-lg bg-primary p-3 font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}

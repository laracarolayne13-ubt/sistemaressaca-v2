import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Painel } from "./index";

export const Route = createFileRoute("/painel")({
  head: () => ({ meta: [{ title: "Painel Ressaca — Portaria" }] }),
  component: PainelProtegido,
});

function PainelProtegido() {
  const [verificando, setVerificando] = useState(true);
  const [autenticado, setAutenticado] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let ativo = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!ativo) return;
      if (!data.session) {
        void navigate({ to: "/login", replace: true });
        return;
      }
      setAutenticado(true);
      setVerificando(false);
    });
    return () => {
      ativo = false;
    };
  }, [navigate]);

  if (verificando) return <div className="min-h-screen bg-background" aria-label="Verificando sessão" />;
  if (!autenticado) return <div className="min-h-screen bg-background" aria-label="Redirecionando para login" />;
  return <Painel />;
}

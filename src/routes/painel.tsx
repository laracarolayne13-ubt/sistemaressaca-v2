import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ModalMorador } from "@/components/ui/ModalMorador";
import { Sidebar, SidebarProvider } from "@/components/ui/sidebar";


type Morador = {
  id: string;
  nome: string;
  Otimo: string;
  WhatsApp?: string;
  created_at?: string;
};

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

function Painel() {
  const [moradores, setMoradores] = useState<Morador[]>([]);
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<Morador | null>(null);

  const buscarMoradores = async () => {
    const { data, error } = await supabase.from("moradores").select("*").order("Otimo");
    if (error) return console.error(error);
    setMoradores((data ?? []) as unknown as Morador[]);
  };

  useEffect(() => {
    buscarMoradores();
  }, []);

  const remover = async (id: string) => {
    if (confirm("Remover esse morador?")) {
      const { error } = await supabase.from("moradores").delete().eq("id", id);
      if (error) return alert("Erro ao remover");
      buscarMoradores();
    }
  };

  const abrirCadastro = () => {
    setEditando(null);
    setModalAberto(true);
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen bg-background p-4 text-white">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold mb-6">Painel da Portaria</h1>


        {/* AQUI VAI TEU CONTEÚDO ATUAL: PENDENTES, ETC */}
        <div className="bg-black/30 p-4 rounded-xl mb-4 border border-zinc-800">
          <p className="opacity-70">Pendentes aqui...</p>
        </div>

        {/* BOTÃO CADASTRAR NA SIDEBAR - TROCA O ONCLICK DO TEU BOTÃO ATUAL */}

        {/* Procura onde tem o botão "Cadastrar" e troca o onClick por: onClick={abrirCadastro} */}

        {/* GESTÃO DE MORADORES */}
        <div className="bg-black/30 p-4 rounded-xl border border-zinc-800">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Moradores Cadastrados</h2>
            <button
              onClick={abrirCadastro}
              className="bg-blue-600 px-4 py-2 rounded hover:bg-blue-700"
            >
              + Novo Morador
            </button>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto">
            {moradores.map((m) => (
              <div key={m.id} className="bg-black/20 p-3 rounded flex justify-between items-center">
                <div>
                  <p className="font-bold">{m.Otimo} — {m.nome}</p>
                  <p className="text-sm opacity-70">{m.WhatsApp}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditando(m);
                      setModalAberto(true);
                    }}
                    className="bg-yellow-600 px-3 py-1 rounded text-sm hover:bg-yellow-700"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => remover(m.id)}
                    className="bg-red-600 px-3 py-1 rounded text-sm hover:bg-red-700"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
            {moradores.length === 0 && (
              <p className="opacity-50 text-center py-8">Nenhum morador cadastrado</p>
            )}
          </div>
        </div>
        </div>

        <ModalMorador
          aberto={modalAberto}
          moradorEditando={editando}
          onClose={() => {
            setModalAberto(false);
            setEditando(null);
          }}
          onSalvou={buscarMoradores}
        />
      </div>
    </SidebarProvider>
  );
}
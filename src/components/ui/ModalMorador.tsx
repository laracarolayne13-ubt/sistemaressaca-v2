import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

type Morador = {
  id: string;
  nome: string;
  Otimo: string;
  WhatsApp?: string;
};

type ModalProps = {
  aberto: boolean;
  onClose: () => void;
  moradorEditando: Morador | null;
  onSalvou: () => void;
};

export default function ModalMorador({ aberto, onClose, moradorEditando, onSalvou }: ModalProps) {
  const [nome, setNome] = useState("");
  const [apto, setApto] = useState("");
  const [telefone, setTelefone] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (moradorEditando) {
      setNome(moradorEditando.nome || "");
      setApto(moradorEditando.Otimo || "");
      setTelefone(moradorEditando.WhatsApp || "");
    } else {
      setNome("");
      setApto("");
      setTelefone("");
    }
  }, [moradorEditando, aberto]);

  if (!aberto) return null;

  const salvar = async () => {
    if (!nome.trim() ||!apto.trim()) {
      return alert("Preenche nome e apto");
    }

    setSalvando(true);

    const dados = {
      nome: nome.trim(),
      Otimo: apto.trim(),
      WhatsApp: telefone.trim()
    };

    if (moradorEditando) {
      const { error } = await supabase
       .from("mora")
       .update(dados)
       .eq("id", moradorEditando.id);
      
      if (error) {
        alert("Erro ao atualizar morador");
        setSalvando(false);
        return;
      }
    } else {
      const { error } = await supabase
       .from("mora")
       .insert(dados);
      
      if (error) {
        alert("Erro ao cadastrar morador");
        setSalvando(false);
        return;
      }
    }

    setSalvando(false);
    onSalvou();
    onClose();
  };

  const fecharNoFundo = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div 
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={fecharNoFundo}
    >
      <div className="bg-zinc-800 p-6 rounded-xl w-full max-w-md border border-zinc-700">
        <h2 className="text-xl mb-4 font-bold text-white">
          {moradorEditando? "Editar" : "Novo"} Morador
        </h2>
        
        <input
          className="bg-black/40 p-3 rounded w-full mb-3 outline-none text-white placeholder:text-zinc-500"
          placeholder="Nome - Ex: João Silva"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          disabled={salvando}
        />
        
        <input
          className="bg-black/40 p-3 rounded w-full mb-3 outline-none text-white placeholder:text-zinc-500"
          placeholder="Apto - Ex: Corvina 1"
          value={apto}
          onChange={(e) => setApto(e.target.value)}
          disabled={salvando}
        />
        
        <input
          className="bg-black/40 p-3 rounded w-full mb-4 outline-none text-white placeholder:text-zinc-500"
          placeholder="WhatsApp - Ex: 12992185143"
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          disabled={salvando}
        />
        
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={salvando}
            className="bg-zinc-600 px-4 py-2 rounded hover:bg-zinc-700 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando}
            className="bg-blue-600 px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {salvando? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
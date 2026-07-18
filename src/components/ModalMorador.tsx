import React, { useState, useEffect } from 'react'
import { supabase } from "@/integrations/supabase/client"

type Morador = {
  id?: string
  nome: string
  Otimo: string
  WhatsApp?: string
}

type Props = {
  aberto: boolean
  moradorEditando: Morador | null
  onClose: () => void
  onSalvou: () => void
}

export function ModalMorador({ aberto, moradorEditando, onClose, onSalvou }: Props) {
  const [nome, setNome] = useState('')
  const [apto, setApto] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [salvando, setSalvando] = useState(false)

  // Preenche o form quando for editar
  useEffect(() => {
    if (moradorEditando) {
      setNome(moradorEditando.nome || '')
      setApto(moradorEditando.Otimo || '')
      setWhatsapp(moradorEditando.WhatsApp || '')
    } else {
      setNome('')
      setApto('')
      setWhatsapp('')
    }
  }, [moradorEditando, aberto])

  if (!aberto) return null

  const salvar = async () => {
    if (!nome ||!apto) {
      alert('Preenche nome e apto')
      return
    }

    setSalvando(true)

    const dados = {
      nome: nome,
      Otimo: apto,
      WhatsApp: whatsapp || null
    }

    let error
    if (moradorEditando?.id) {
      // Editando
      const res = await supabase.from('mora').update(dados).eq('id', moradorEditando.id)
      error = res.error
    } else {
      // Criando novo
      const res = await supabase.from('mora').insert([dados])
      error = res.error
    }

    setSalvando(false)

    if (error) {
      console.error(error)
      alert('Erro ao salvar morador')
      return
    }

    onSalvou() // Recarrega a lista no painel
    onClose() // Fecha o modal
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white p-6 rounded-lg shadow-xl text-black w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">
          {moradorEditando? 'Editar Morador' : 'Cadastrar Morador'}
        </h2>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Nome *</label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="Nome completo"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Apto *</label>
            <input
              type="text"
              value={apto}
              onChange={(e) => setApto(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="Ex: 101, 202A"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">WhatsApp</label>
            <input
              type="text"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="(11) 99999-9999"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            disabled={salvando}
            className="flex-1 px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando}
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {salvando? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
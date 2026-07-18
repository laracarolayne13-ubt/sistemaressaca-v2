import { useState, useEffect } from 'react'
import { supabase } from "@/integrations/supabase/client"

type Morador = { id?: string; nome: string; unidade: string; whatsapp?: string }
type Props = { aberto: boolean; moradorEditando: Morador | null; onClose: () => void; onSalvou: () => void }

export function ModalMorador({ aberto, moradorEditando, onClose, onSalvou }: Props) {
  const [nome, setNome] = useState('')
  const [unidade, setUnidade] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!aberto) return
    if (moradorEditando) {
      setNome(moradorEditando.nome || '')
      // @ts-ignore compatível com Otimo antigo
      setUnidade((moradorEditando as any).unidade || (moradorEditando as any).Otimo || (moradorEditando as any).apto || '')
      setWhatsapp((moradorEditando as any).whatsapp || (moradorEditando as any).WhatsApp || '')
    } else { setNome(''); setUnidade(''); setWhatsapp('') }
  }, [moradorEditando, aberto])

  if (!aberto) return null

  const salvar = async () => {
    if (!nome ||!unidade) return alert('Preenche nome e unidade/apto')
    setSalvando(true)
    const dados = { nome: nome.trim(), unidade: unidade.trim(), whatsapp: whatsapp.trim() || null }
    let error
    if (moradorEditando?.id) {
      const res = await supabase.from('moradores').update(dados).eq('id', moradorEditando.id)
      error = res.error
    } else {
      const res = await supabase.from('moradores').insert([dados])
      error = res.error
    }
    setSalvando(false)
    if (error) { console.error(error); return alert('Erro ao salvar: ' + error.message) }
    onSalvou(); onClose()
  }

  const remover = async () => {
    if (!moradorEditando?.id) return
    if (!confirm(`Remover ${moradorEditando.nome} - ${moradorEditando.unidade}?`)) return
    setSalvando(true)
    const { error } = await supabase.from('moradores').delete().eq('id', moradorEditando.id)
    setSalvando(false)
    if (error) return alert('Erro ao remover: ' + error.message)
    onSalvou(); onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4">
      <div className="bg-white p-6 rounded-xl shadow-2xl text-black w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">{moradorEditando? 'Editar Morador' : 'Cadastrar Morador'}</h2>
        <div className="space-y-3">
          <input value={nome} onChange={e=>setNome(e.target.value)} placeholder="Nome completo" className="w-full border rounded px-3 py-2" />
          <input value={unidade} onChange={e=>setUnidade(e.target.value)} placeholder="Unidade / Apto ex: Garoupa n15, corvina 1" className="w-full border rounded px-3 py-2" />
          <input value={whatsapp} onChange={e=>setWhatsapp(e.target.value)} placeholder="(13) 99999-9999" className="w-full border rounded px-3 py-2" />
        </div>
        <div className="flex gap-2 mt-6">
          <button onClick={onClose} disabled={salvando} className="flex-1 px-4 py-2 bg-gray-200 rounded">Cancelar</button>
          {moradorEditando?.id && <button onClick={remover} disabled={salvando} className="px-4 py-2 bg-red-500 text-white rounded">Remover</button>}
          <button onClick={salvar} disabled={salvando} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded">{salvando? 'Salvando...' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}
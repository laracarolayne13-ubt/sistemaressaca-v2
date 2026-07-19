import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarcodeFormat, BrowserMultiFormatReader, DecodeHintType } from "@zxing/library";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import ubatuba from "@/assets/ubatuba.jpg";
import { ModalMorador } from "@/components/ModalMorador";


import {
  flushOutbox,
  outboxCount,
  queueCreate,
  queueDeliver,
  setupAutoFlush,
  subscribeOutbox,
  readConflicts,
  conflictsCount,
  resolveConflict,
  type Conflict,
}
 from "@/lib/offline-outbox";

const EMPRESAS_COMUNS = [
  "Correios",
  "Mercado Livre",
  "Amazon",
  "Shopee",
  "Shein",
  "AliExpress",
  "Magalu",
  "Americanas",
  "Casas Bahia",
  "Loggi",
  "Jadlog",
  "Total Express",
  "Braspress",
  "Sequoia",
  "iFood",
  "Rappi",
  "DHL",
  "FedEx",
  "Outra",
];

type Encomenda = {
  id: string;
  codigo: string;
  unidade: string;
  logradouro: string;
  empresa: string;
  tipo: string;
  foto_url: string | null;
  status: string;
  recebedor: string | null;
  created_at: string;
  entregue_at: string | null;
  porteiro_responsavel: string | null;
};

type Porteiro = { id: string; nome: string; ativo: boolean; created_at: string };

type Tema = "cinza" | "marrom" | "azul" | "foto";
const TIPOS_ENCOMENDA = ["Caixa", "Pacote", "Envelope", "Carta/Cartão"] as const;

const TEMA_BG: Record<Tema, string> = {
  cinza: "oklch(0.2 0.01 240)",
  marrom: "oklch(0.45 0.12 50)",
  azul: "oklch(0.28 0.1 250)",
  foto: "transparent",
};

const TEMPLATE_KEY = "wa-template";
const IDLE_MINUTES_KEY = "idle-timeout-min";
const DEFAULT_TEMPLATE =
  "Olá {nome}! 📦\n" +
  "Chegou uma encomenda para você na portaria.\n\n" +
  "Apto: {apto}\n" +
  "Empresa: {empresa}\n" +
  "Tipo: {tipo}\n" +
  "Código: {codigo}\n" +
  "Endereço: {logradouro}\n" +
  "{foto}\n" +
  "Por favor, retire na portaria. — Associação Moradores Bairro Ressaca 🏄‍♂️";

const DELIVERY_TEMPLATE =
  "Olá {nome}! ✅\n" +
  "Sua encomenda foi entregue na portaria.\n\n" +
  "Recebida por: {recebedor}\n" +
  "Empresa: {empresa} · Tipo: {tipo}\n" +
  "Código: {codigo}\n" +
  "Data: {data}\n\n" +
  "— Associação Moradores Bairro Ressaca 🏄‍♂️";

function getTemplate(): string {
  if (typeof window === "undefined") return DEFAULT_TEMPLATE;
  return localStorage.getItem(TEMPLATE_KEY) || DEFAULT_TEMPLATE;
}

function getIdleMinutes(): number {
  if (typeof window === "undefined") return 2;
  const raw = localStorage.getItem(IDLE_MINUTES_KEY);
  const n = raw ? Number(raw) : 2;
  if (Number.isNaN(n)) return 2;
  return Math.min(10, Math.max(1, Math.round(n)));
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderTemplate(
  tpl: string,
  vars: { nome: string; apto: string; empresa: string; tipo: string; codigo: string; logradouro: string; foto?: string | null },
): string {
  const fotoLine = vars.foto ? `📸 Clique aqui para ver a foto: ${vars.foto}` : "";
  return tpl
    .replaceAll("{nome}", vars.nome)
    .replaceAll("{apto}", vars.apto)
    .replaceAll("{empresa}", vars.empresa)
    .replaceAll("{tipo}", vars.tipo)
    .replaceAll("{codigo}", vars.codigo)
    .replaceAll("{logradouro}", vars.logradouro)
    .replaceAll("{foto}", fotoLine)
    // Remove linhas vazias extras quando não há foto
    .replace(/\n{3,}/g, "\n\n");
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Painel Ressaca — Portaria" },
      { name: "description", content: "Gestão de encomendas da Associação Moradores Bairro Ressaca." },
    ],
  }),
  component: Painel,
});

export function Painel() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tema, setTema] = useState<Tema>("foto");
  const [tocando, setTocando] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [modalNova, setModalNova] = useState(false);
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const [moradorEditando, setMoradorEditando] = useState<any>(null);


  const [modalEntrega, setModalEntrega] = useState<string | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [modalConfig, setModalConfig] = useState(false);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [conflictsAberto, setConflictsAberto] = useState(false);
  const [idle, setIdle] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState(getIdleMinutes());
  const [filtroPendentes, setFiltroPendentes] = useState("");
  const [fotoModalUrl, setFotoModalUrl] = useState<string | null>(null);

  // Idle detection: abre tela de encomendas pendentes após N minutos sem interação
  useEffect(() => {
    const TIMEOUT = idleMinutes * 60 * 1000;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      if (idle) return;
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), TIMEOUT);
    };
    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "wheel",
      "scroll",
    ];
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [idle, idleMinutes]);

  // Online/offline + outbox tracking
  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    const refreshPending = async () => {
      setPending(await outboxCount());
      setConflicts(await conflictsCount());
    };
    updateOnline();
    void refreshPending();

    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    const unsub = subscribeOutbox(refreshPending);

    const stopFlush = setupAutoFlush((r) => {
      if (r.done > 0) {
        qc.invalidateQueries({ queryKey: ["encomendas"] });
      }
      if (r.conflicts > 0) {
        setConflictsAberto(true);
      }
    });

    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      unsub();
      stopFlush();
    };
  }, [qc]);

  useEffect(() => {
    const t = (localStorage.getItem("tema") as Tema | null) ?? "foto";
    setTema(t);
  }, []);

  useEffect(() => {
    localStorage.setItem("tema", tema);
  }, [tema]);

  const pendentes = useQuery({
    queryKey: ["encomendas", "pendentes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("encomendas")
        .select("*")
        .eq("status", "pendente")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const list = (data ?? []) as Encomenda[];
      try {
        localStorage.setItem("cache-pendentes", JSON.stringify(list));
      } catch {}
      return list;
    },
    refetchInterval: 30000,
    initialData: () => {
      try {
        const raw = localStorage.getItem("cache-pendentes");
        if (raw) return JSON.parse(raw) as Encomenda[];
      } catch {}
      return undefined;
    },
    networkMode: "always",
  });

  const historico = useQuery({
    queryKey: ["encomendas", "entregues"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("encomendas")
        .select("*")
        .eq("status", "entregue")
        .order("entregue_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return (data ?? []) as Encomenda[];
    },
    enabled: historicoAberto,
    networkMode: "always",
  });

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play().then(() => setTocando(true)).catch(() => alert("Não foi possível reproduzir."));
    } else {
      a.pause();
      setTocando(false);
    }
  };

  const bgStyle =
    tema === "foto"
      ? { backgroundImage: `url(${ubatuba})`, backgroundSize: "cover", backgroundPosition: "center" }
      : { backgroundColor: TEMA_BG[tema] };

  return (
    <div className="min-h-screen text-foreground transition-colors" style={bgStyle}>
      <div className="min-h-screen bg-gradient-to-b from-black/30 via-black/55 to-black/75 p-4 pb-28 md:p-8 backdrop-blur-[2px]">
        <audio ref={audioRef} loop preload="none">
          <source src="https://stream.eldorado.fm/eldorado" type="audio/mpeg" />
        </audio>

        {/* Controles flutuantes */}
        <div className="fixed top-4 right-4 z-50 flex flex-col items-center gap-3 md:top-6 md:right-6">
          <button
            onClick={togglePlay}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-primary text-lg text-primary-foreground shadow-[var(--shadow-glow-primary)] transition active:scale-95 hover:bg-primary/90"
            aria-label="Tocar rádio"
          >
            {tocando ? "⏸" : "▶"}
          </button>
          <div className="flex flex-col gap-2 rounded-full border border-white/15 bg-black/50 p-1.5 backdrop-blur-md shadow-lg">
            {(["cinza", "marrom", "azul", "foto"] as Tema[]).map((t) => (
              <button
                key={t}
                onClick={() => setTema(t)}
                className={`h-5 w-5 rounded-full border-2 transition hover:border-white ${tema === t ? "border-white ring-2 ring-white/30" : "border-white/30"}`}
                style={
                  t === "foto"
                    ? { backgroundImage: `url(${ubatuba})`, backgroundSize: "cover" }
                    : { backgroundColor: TEMA_BG[t] }
                }
                aria-label={`Tema ${t}`}
              />
            ))}
          </div>
        </div>

        <header className="mx-auto mb-6 max-w-6xl pt-2 text-center md:mb-8 md:pt-4">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70 backdrop-blur-md">
            🏄‍♂️ Bairro Ressaca
          </div>
          <h1 className="mt-3 text-xl font-bold tracking-tight text-white md:text-3xl">
            Painel da Portaria
          </h1>
          <p className="mt-1 text-xs text-white/60 md:text-sm">Gestão de encomendas em tempo real</p>
          <button
            type="button"
            onClick={async () => {
              await supabase.auth.signOut();
              void navigate({ to: "/login", replace: true });
            }}
            className="mt-3 rounded-lg border border-white/20 bg-black/20 px-3 py-1.5 text-xs font-semibold text-white/85 transition hover:bg-white/10"
          >
            Sair
          </button>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold backdrop-blur-sm ${
                online
                  ? "border-[oklch(0.7_0.17_155)]/30 bg-[oklch(0.7_0.17_155)]/15 text-[oklch(0.88_0.14_155)]"
                  : "border-[oklch(0.7_0.2_35)]/30 bg-[oklch(0.7_0.2_35)]/15 text-[oklch(0.88_0.14_35)]"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-[oklch(0.75_0.18_155)] shadow-[0_0_8px_oklch(0.75_0.18_155)]" : "bg-[oklch(0.75_0.2_35)]"}`} />
              {online ? "Online" : "Offline"}
            </span>
            {pending > 0 && (
              <button
                onClick={async () => {
                  const r = await flushOutbox();
                  if (r.done > 0) qc.invalidateQueries({ queryKey: ["encomendas"] });
                  if (r.conflicts > 0) setConflictsAberto(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-[oklch(0.78_0.16_75)]/30 bg-[oklch(0.78_0.16_75)]/15 px-2.5 py-1 font-semibold text-[oklch(0.9_0.15_75)] backdrop-blur-sm transition hover:bg-[oklch(0.78_0.16_75)]/25"
                title="Sincronizar agora"
              >
                ⏳ {pending} aguardando sync
              </button>
            )}
            {conflicts > 0 && (
              <button
                onClick={() => setConflictsAberto(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-[oklch(0.7_0.2_25)]/40 bg-[oklch(0.7_0.2_25)]/15 px-2.5 py-1 font-semibold text-[oklch(0.9_0.18_30)] backdrop-blur-sm transition hover:bg-[oklch(0.7_0.2_25)]/25"
                title="Resolver conflitos"
              >
                ⚠ {conflicts} conflito{conflicts > 1 ? "s" : ""}
              </button>
            )}
          </div>
        </header>

        <div className="mx-auto flex max-w-6xl flex-col gap-5 md:flex-row md:gap-6">
          {/* Menu lateral */}
          <aside className="grid w-full grid-cols-2 gap-3 md:flex md:w-1/3 md:flex-col md:gap-4">
            <MenuButton
              icon="📦"
              variant="primary"
              onClick={() => setModalNova(true)}
              hint="Registrar nova"
            >
              Nova encomenda
            </MenuButton>
            <MenuButton
              icon="👤"
              variant="muted"
              onClick={() => {
                setMoradorEditando(null)
                setCadastroAberto(true)
              }}
              hint="Adicionar morador"
            >
              Cadastrar
            </MenuButton>

            <MenuButton
              icon="⚙"
              variant="amber"
              onClick={() => setModalConfig(true)}
              hint="Tema e WhatsApp"
            >
              Configurações
            </MenuButton>
            <MenuButton
              icon="📜"
              variant="violet"
              onClick={() => setHistoricoAberto((v) => !v)}
              hint="Entregas recentes"
            >
              Histórico
            </MenuButton>
          </aside>

          {/* Tabela */}
          <section className="flex w-full flex-col gap-6 md:w-2/3">
            {!historicoAberto && (
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl backdrop-blur-xl md:p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
                  Pendentes
                </h2>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--status-warn)]/30 bg-[var(--status-warn-bg)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--status-warn)]">
                  {pendentes.data?.length ?? 0} aguardando
                </span>
              </div>

              <div className="mb-3">
                <input
                  value={filtroPendentes}
                  onChange={(e) => setFiltroPendentes(e.target.value)}
                  placeholder="🔎 Filtrar por morador, apto, empresa ou código"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-primary"
                />
              </div>

              {pendentes.isLoading && (
                <div className="py-10 text-center text-sm text-white/50">Carregando…</div>
              )}
              {!pendentes.isLoading && pendentes.data?.length === 0 && (
                <div className="py-10 text-center text-sm text-white/60">
                  <div className="mb-2 text-3xl">🎉</div>
                  Nenhuma encomenda pendente
                </div>
              )}

              {(() => {
                const q = filtroPendentes.trim().toLowerCase();
                const lista = (pendentes.data ?? []).filter((e) => {
                  if (!q) return true;
                  return (
                    e.unidade.toLowerCase().includes(q) ||
                    e.empresa.toLowerCase().includes(q) ||
                    e.codigo.toLowerCase().includes(q) ||
                    e.logradouro.toLowerCase().includes(q)
                  );
                });
                const grupos = new Map<string, Encomenda[]>();
                for (const e of lista) {
                  const arr = grupos.get(e.unidade) ?? [];
                  arr.push(e);
                  grupos.set(e.unidade, arr);
                }
                const grupoList = Array.from(grupos.entries()).sort(([a], [b]) =>
                  a.localeCompare(b, "pt-BR"),
                );
                if (q && grupoList.length === 0 && (pendentes.data?.length ?? 0) > 0) {
                  return (
                    <div className="py-8 text-center text-sm text-white/60">
                      Nenhum resultado para “{filtroPendentes}”.
                    </div>
                  );
                }
                return (
                  <div className="space-y-4">
                    {grupoList.map(([unidade, itens]) => (
                      <div key={unidade} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2 px-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-base">🏠</span>
                            <span className="truncate text-sm font-bold text-white">{unidade}</span>
                          </div>
                          <span className="shrink-0 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-white/80">
                            {itens.length} {itens.length === 1 ? "encomenda" : "encomendas"}
                          </span>
                        </div>
                        <ul className="space-y-2">
                          {itens.map((e) => (
                            <li
                              key={e.id}
                              className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-2.5 transition hover:border-white/20 hover:bg-white/[0.07]"
                            >
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--status-info)]/25 bg-[var(--status-info-bg)] text-base">
                                📦
                              </div>
                              {e.foto_url && (
                                <button
                                  onClick={() => setFotoModalUrl(e.foto_url)}
                                  title="Ver foto da encomenda"
                                  className="shrink-0"
                                >
                                  <img
                                    src={e.foto_url}
                                    alt="Foto"
                                    className="h-11 w-11 rounded-lg border border-white/15 object-cover"
                                  />
                                </button>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-xs font-semibold text-white/90">{e.empresa}</span>
                                  <span className="shrink-0 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/70">
                                    {e.tipo}
                                  </span>
                                </div>
                                <p className="truncate font-mono text-[11px] text-white/60">{e.codigo}</p>
                                <p className="text-[10px] text-white/50">
                                  Inserido em {formatDateTime(e.created_at)}
                                </p>
                                <div className="mt-1.5 flex items-center gap-2">
                                  <button
                                    onClick={() => setModalEntrega(e.id)}
                                    className="rounded-lg bg-[var(--status-ok)] px-3 py-1 text-xs font-bold text-black/85 transition active:scale-95 hover:brightness-110"
                                  >
                                    Entregar
                                  </button>
                                  {e.foto_url && (
                                    <button
                                      onClick={() => setFotoModalUrl(e.foto_url)}
                                      className="rounded-lg border border-white/15 px-2.5 py-1 text-xs font-semibold text-white/80 hover:bg-white/5"
                                    >
                                      📷 Foto
                                    </button>
                                  )}
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
            )}

            {historicoAberto && (
              <div className="overflow-x-auto rounded-3xl border border-white/10 bg-[oklch(0.3_0.08_45)]/60 p-4 shadow-2xl backdrop-blur-xl md:p-6">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                  Entregas recentes
                </h2>
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/20 uppercase text-white/70">
                    <tr>
                      <th className="pb-2">Foto</th>
                      <th className="pb-2">Morador / Endereço</th>
                      <th className="pb-2">Empresa / Tipo</th>
                      <th className="pb-2">Recebedor</th>
                      <th className="pb-2">Responsável</th>
                      <th className="pb-2">Entregue em</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {historico.data?.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-2 text-center text-white/60">
                          Nenhuma entrega encontrada.
                        </td>
                      </tr>
                    )}
                    {historico.data?.map((e) => (
                      <tr key={e.id} className="hover:bg-white/5">
                        <td className="py-2">
                          {e.foto_url ? (
                            <button
                              onClick={() => setFotoModalUrl(e.foto_url)}
                              className="font-bold text-white hover:underline"
                            >
                              📷 Ver
                            </button>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2">
                          {e.unidade} — {e.logradouro}
                        </td>
                        <td className="py-2">
                          {e.empresa} ({e.tipo})
                        </td>
                        <td className="py-2 font-bold text-[oklch(0.88_0.14_75)]">{e.recebedor ?? "Portaria"}</td>
                        <td className="py-2 text-white/80">{e.porteiro_responsavel ? `Entregue por: ${e.porteiro_responsavel}` : "—"}</td>
                        <td className="py-2 whitespace-nowrap text-white/70">{formatDateTime(e.entregue_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {modalNova && (
          <NovaEncomendaModal
            onClose={() => setModalNova(false)}
            onSaved={() => {
              setModalNova(false);
              qc.invalidateQueries({ queryKey: ["encomendas"] });
            }}
            onOpenFoto={(url) => setFotoModalUrl(url)}
          />
        )}

        {modalEntrega && (
          <EntregaModal
            encomendaId={modalEntrega}
            base={pendentes.data?.find((e) => e.id === modalEntrega) ?? null}
            onClose={() => setModalEntrega(null)}
            onConfirmed={() => {
              setModalEntrega(null);
              qc.invalidateQueries({ queryKey: ["encomendas"] });
            }}
            onOpenFoto={(url) => setFotoModalUrl(url)}
          />
        )}

        {conflictsAberto && (
          <ConflictsModal
            onClose={() => setConflictsAberto(false)}
            onResolved={() => {
              qc.invalidateQueries({ queryKey: ["encomendas"] });
            }}
          />
        )}

        {modalConfig && (
          <ConfigModal
            idleMinutes={idleMinutes}
            onIdleChange={setIdleMinutes}
            onClose={() => setModalConfig(false)}
          />
        )}

        {fotoModalUrl && (
          <FotoModal
            url={fotoModalUrl}
            onClose={() => setFotoModalUrl(null)}
          />
        )}

        {idle && (
          <IdleScreen
            encomendas={pendentes.data ?? []}
            onDismiss={() => setIdle(false)}
          />
        )}

        {cadastroAberto && (
          <CadastroMoradorModal
            unidadeInicial={""}
            atual={null}
            onClose={() => setCadastroAberto(false)}
            onSaved={(m) => {
              setCadastroAberto(false);
            }}
          />
        )}

      </div>
    </div>
  );
}

function IdleScreen({
  encomendas,
  onDismiss,
}: {
  encomendas: Encomenda[];
  onDismiss: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (encomendas.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % encomendas.length), 5000);
    return () => clearInterval(t);
  }, [encomendas.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onDismiss]);

  const destaque = encomendas[idx] ?? null;
  const hora = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const data = now.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  return (
    <div
      onClick={onDismiss}
      className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-gradient-to-br from-[oklch(0.16_0.04_250)] via-[oklch(0.2_0.08_260)] to-[oklch(0.18_0.1_200)] p-6 text-white backdrop-blur-xl md:p-12"
    >
      <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-primary/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[28rem] w-[28rem] rounded-full bg-[oklch(0.65_0.2_200)]/30 blur-3xl" />

      <header className="relative flex items-start justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
            🏄‍♂️ Bairro Ressaca • Portaria
          </div>
          <div className="mt-2 text-6xl font-bold tabular-nums tracking-tight md:text-8xl">
            {hora}
          </div>
          <div className="mt-1 text-sm capitalize text-white/70 md:text-base">{data}</div>
        </div>
        <div className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs backdrop-blur-md">
          Toque para voltar
        </div>
      </header>

      <div className="relative mt-8 flex flex-1 flex-col gap-6 overflow-hidden md:flex-row">
        {/* Destaque */}
        <section className="flex flex-1 flex-col justify-center rounded-3xl border border-white/15 bg-white/5 p-6 shadow-2xl backdrop-blur-md md:p-10">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-primary-foreground/80">
            📦 Aguardando retirada
          </div>
          <div className="mt-2 text-7xl font-black tabular-nums leading-none md:text-9xl">
            {encomendas.length}
          </div>
          <div className="mt-1 text-sm text-white/60">
            {encomendas.length === 1 ? "encomenda pendente" : "encomendas pendentes"}
          </div>

          {destaque && (
            <div className="mt-8 rounded-2xl border border-white/15 bg-black/30 p-5">
              <div className="text-[10px] uppercase tracking-[0.25em] text-white/50">
                Em destaque
              </div>
              <div className="mt-2 flex items-center gap-4">
                {destaque.foto_url ? (
                  <img
                    src={destaque.foto_url}
                    alt=""
                    className="h-20 w-20 rounded-xl border border-white/20 object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-3xl">
                    📦
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-2xl font-bold">Apto {destaque.unidade}</div>
                  <div className="truncate text-sm text-white/70">
                    {destaque.empresa} • {destaque.tipo}
                  </div>
                  <div className="truncate font-mono text-xs text-white/50">
                    {destaque.codigo}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Lista rolagem */}
        <section className="flex flex-1 flex-col overflow-hidden rounded-3xl border border-white/15 bg-black/30 p-6 backdrop-blur-md md:p-8">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-white/60">
              Lista completa
            </div>
            <div className="text-xs text-white/50">Atualizado agora</div>
          </div>
          {encomendas.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <div className="text-6xl">✅</div>
              <div className="text-xl font-semibold">Nenhuma encomenda pendente</div>
              <div className="text-sm text-white/60">Tudo em dia por aqui!</div>
            </div>
          ) : (
            <ul className="flex-1 space-y-2 overflow-y-auto pr-2">
              {encomendas.map((e, i) => (
                <li
                  key={e.id}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition ${
                    i === idx
                      ? "border-primary/60 bg-primary/15"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  <div className="text-lg font-bold tabular-nums text-white/70">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">Apto {e.unidade}</div>
                    <div className="truncate text-xs text-white/60">
                      {e.empresa} • {e.tipo}
                    </div>
                  </div>
                  <div className="shrink-0 rounded-full border border-white/15 bg-black/40 px-2 py-0.5 font-mono text-[10px] text-white/60">
                    {e.codigo.slice(-6)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="relative mt-6 flex flex-col items-center gap-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/15 px-6 py-3 text-sm font-semibold text-white shadow-lg backdrop-blur-md transition hover:bg-white/25 active:scale-95"
        >
          ↩ Voltar ao painel
        </button>
        <div className="text-center text-xs text-white/40">
          Modo apresentação • Toque no botão, em qualquer lugar ou pressione{" "}
          <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>{" "}
          para retornar
        </div>
      </footer>
    </div>
  );
}

function MenuButton({
  children,
  icon,
  variant,
  hint,
  onClick,
}: {
  children: React.ReactNode;
  icon: string;
  variant: "primary" | "muted" | "amber" | "violet";
  hint?: string;
  onClick: () => void;
}) {
  const styles: Record<typeof variant, string> = {
    primary:
      "border-primary/30 bg-gradient-to-br from-primary to-[oklch(0.55_0.2_260)] text-primary-foreground shadow-[var(--shadow-glow-primary)]",
    muted:
      "border-white/10 bg-white/[0.05] text-white hover:bg-white/[0.08]",
    amber:
      "border-[oklch(0.6_0.18_45)]/40 bg-gradient-to-br from-[oklch(0.6_0.18_45)] to-[oklch(0.5_0.2_30)] text-white",
    violet:
      "border-[oklch(0.45_0.2_320)]/40 bg-gradient-to-br from-[oklch(0.5_0.22_320)] to-[oklch(0.4_0.2_290)] text-white",
  };
  return (
    <button
      onClick={onClick}
      className={`group flex items-start gap-3 rounded-2xl border p-4 text-left shadow-lg backdrop-blur-md transition active:scale-[0.98] hover:-translate-y-0.5 md:p-5 ${styles[variant]}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-lg backdrop-blur-sm">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-bold leading-tight md:text-base">{children}</span>
        {hint && <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-white/70 md:text-[11px]">{hint}</span>}
      </span>
    </button>
  );
}

function NovaEncomendaModal({ onClose, onSaved, onOpenFoto }: { onClose: () => void; onSaved: () => void; onOpenFoto: (url: string) => void }) {
  const [codigo, setCodigo] = useState("");
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<{ nome: string; unidade: string; whatsapp: string }[]>([]);
  const [morador, setMorador] = useState<{ nome: string; unidade: string; whatsapp: string } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const [empresa, setEmpresa] = useState("");
  const [tipo, setTipo] = useState<typeof TIPOS_ENCOMENDA[number]>("Caixa");
  const [scannerAtivo, setScannerAtivo] = useState(false);
  const [leitorAberto, setLeitorAberto] = useState(false);
  const [waFallback, setWaFallback] = useState<{ url: string; msg: string } | null>(null);
  const [salvouUltima, setSalvouUltima] = useState(false);
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const arquivoRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const leitorRef = useRef<BrowserMultiFormatReader | null>(null);

  const fecharLeitor = () => {
    leitorRef.current?.reset();
    leitorRef.current = null;
    setLeitorAberto(false);
  };

  const abrirLeitor = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      stream.getTracks().forEach((track) => track.stop());
      setLeitorAberto(true);
    } catch (error) {
      if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) {
        toast.error("Permissão de câmera negada");
      } else {
        toast.error("Não foi possível acessar a câmera");
      }
    }
  };

  useEffect(() => {
    if (!leitorAberto || !videoRef.current) return;
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE]);
    const leitor = new BrowserMultiFormatReader(hints, 300);
    leitorRef.current = leitor;
    void leitor.decodeFromVideoDevice(undefined, videoRef.current, (resultado) => {
      if (!resultado) return;
      setCodigo(resultado.getText());
      setScannerAtivo(true);
      fecharLeitor();
    });
    return () => leitor.reset();
  }, [leitorAberto]);

  useEffect(() => {
    if (!foto) {
      setFotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(foto);
    setFotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  // Quando o código é digitado/lido com o scanner ativo, abre a câmera
  // automaticamente para bater a foto da encomenda.
  useEffect(() => {
    if (!scannerAtivo || !codigo.trim() || foto) return;
    const t = window.setTimeout(() => cameraRef.current?.click(), 200);
    return () => window.clearTimeout(t);
  }, [codigo, scannerAtivo, foto]);

  // Busca incremental por nome ou unidade
  useEffect(() => {
    const q = busca.trim();
    if (!q || morador) {
      setResultados([]);
      return;
    }
    let cancelled = false;
    setBuscando(true);
    const t = window.setTimeout(async () => {
      const { data, error } = await supabase
        .from("moradores")
        .select("nome, unidade, whatsapp")
        .or(`nome.ilike.%${q}%,unidade.ilike.%${q}%`)
        .limit(20);
      if (cancelled) return;
      setBuscando(false);
      if (error) {
        console.error(error);
        setResultados([]);
        return;
      }
      setResultados((data ?? []) as { nome: string; unidade: string; whatsapp: string }[]);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [busca, morador]);

  const mutation = useMutation({
    mutationFn: async (): Promise<{ queued: boolean; waUrl: string | null; waMsg: string | null }> => {
      if (!codigo.trim() || !empresa.trim()) {
        throw new Error("Preencha o código e a empresa.");
      }
      if (!foto) {
        throw new Error("A foto da encomenda é obrigatória. Tire uma foto ou escolha um arquivo.");
      }
      if (!TIPOS_ENCOMENDA.includes(tipo as typeof TIPOS_ENCOMENDA[number])) {
        throw new Error("Tipo de encomenda inválido. Escolha entre Caixa, Pacote, Envelope ou Carta/Cartão.");
      }
      if (!morador) {
        throw new Error("Selecione ou cadastre o morador antes de salvar.");
      }
      const apto = morador.unidade;
      const logradouro = morador.unidade;
      const payload = {
        codigo,
        unidade: `${apto} — ${morador.nome}`,
        logradouro,
        empresa,
        tipo,
      };
      const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
      if (!isOnline) {
        await queueCreate(payload, foto);
        const wa = await buildWaUrl(morador, { codigo, apto, empresa, tipo, logradouro, foto: null });
        return { queued: true, waUrl: wa?.url ?? null, waMsg: wa?.msg ?? null };
      }
      try {
        let foto_url: string | null = null;
        if (foto) {
          const ext = (foto.name.split(".").pop() || "jpg").toLowerCase();
          const path = `${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
          const up = await supabase.storage.from("encomendas").upload(path, foto, {
            contentType: foto.type || "image/jpeg",
          });
          if (up.error) throw up.error;
          // Bucket privado: gera URL assinada de longa duração para o WhatsApp
          const signed = await supabase.storage
            .from("encomendas")
            .createSignedUrl(path, 60 * 60 * 24 * 365);
          foto_url = signed.data?.signedUrl ?? null;
        }
        const { error } = await supabase
          .from("encomendas")
          .insert({ ...payload, foto_url, status: "pendente" });
        if (error) throw error;
        const wa = await buildWaUrl(morador, { codigo, apto, empresa, tipo, logradouro, foto: foto_url });
        return { queued: false, waUrl: wa?.url ?? null, waMsg: wa?.msg ?? null };
      } catch (e) {
        // network/server failure: queue for later
        await queueCreate(payload, foto);
        const wa = await buildWaUrl(morador, { codigo, apto, empresa, tipo, logradouro, foto: null });
        return { queued: true, waUrl: wa?.url ?? null, waMsg: wa?.msg ?? null };
      }
    },
    onSuccess: (r) => {
      if (r.queued) {
        alert("📡 Sem conexão — encomenda salva offline e será sincronizada quando voltar.");
      }
      if (r.waUrl) {
        // Mostra a pré-visualização da mensagem antes de abrir o WhatsApp,
        // para o porteiro conferir o link da foto e o texto final.
        setWaFallback({ url: r.waUrl, msg: r.waMsg ?? "" });
      }
      // Mantém o modal aberto com morador/empresa/tipo preservados para
      // facilitar adicionar outra encomenda do mesmo morador.
      setCodigo("");
      setFoto(null);
      setSalvouUltima(true);
    },
    onError: (e: Error) => alert("❌ " + e.message),
  });


  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[oklch(0.18_0.02_240)] p-8 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-xl font-bold">📦 Nova encomenda</h2>
          <div className="text-right">
            <div className="text-lg font-bold tabular-nums leading-none">
              {now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="text-[10px] text-white/60">
              {now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}
            </div>
          </div>
        </div>

        <label className="text-xs uppercase text-white/60">Código (ou escaneie)</label>
        <div className="mb-3 flex gap-2">
          <input
            autoFocus
            value={codigo}
            onChange={(e) => {
              setCodigo(e.target.value);
              setSalvouUltima(false);
            }}
            placeholder="Código / código de barras"
            className={`flex-1 rounded-lg border bg-white/5 p-3 outline-none transition focus:border-primary ${
              scannerAtivo ? "border-[oklch(0.7_0.2_145)] shadow-[0_0_10px_oklch(0.7_0.2_145/0.4)]" : "border-white/10"
            }`}
          />
          <button
            onClick={() => void abrirLeitor()}
            className="rounded-lg bg-[oklch(0.5_0.2_320)] px-4 py-3 font-bold transition hover:opacity-90"
            title="Ativar leitor"
          >
            📱
          </button>
        </div>

        <label className="text-xs uppercase text-white/60">Buscar morador, endereço ou apto</label>
        {morador ? (
          <div className="mb-3 flex items-center justify-between rounded-lg border border-[oklch(0.65_0.18_145)]/30 bg-[oklch(0.65_0.18_145)]/10 px-3 py-2 text-sm">
            <div>
              <div className="font-bold">{morador.nome}</div>
              <div className="text-xs text-white/60">
                🏠 {morador.unidade} · 📱 {morador.whatsapp}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setMorador(null);
                setBusca("");
              }}
              className="text-xs text-white/60 underline hover:text-white"
            >
              trocar
            </button>
          </div>
        ) : (
          <>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nome do morador, endereço ou nº do apto"
              className="mb-2 w-full rounded-lg border border-white/10 bg-white/5 p-3 outline-none transition focus:border-primary"
            />
            {busca.trim() && (
              <div className="mb-3 max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-white/5">
                {buscando && (
                  <div className="px-3 py-2 text-xs text-white/50">Buscando…</div>
                )}
                {!buscando && resultados.length === 0 && (
                  <div className="px-3 py-2 text-xs text-white/50">Nenhum morador encontrado.</div>
                )}
                {resultados.map((m, i) => (
                  <button
                    key={`${m.unidade}-${m.nome}-${i}`}
                    type="button"
                    onClick={() => {
                      setMorador(m);
                      setBusca("");
                      setResultados([]);
                    }}
                    className="block w-full border-b border-white/5 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-white/10"
                  >
                    <div className="font-semibold">{m.nome}</div>
                    <div className="text-xs text-white/60">🏠 {m.unidade} · 📱 {m.whatsapp}</div>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCadastroAberto(true)}
                  className="block w-full border-t border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-white/80 hover:bg-white/10"
                >
                  ➕ Cadastrar novo morador
                </button>
              </div>
            )}
          </>
        )}

        <label className="text-xs uppercase text-white/60">Empresa</label>
        <input
          list="empresas-comuns"
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value)}
          placeholder="Selecione ou digite (Correios, Mercado Livre, Amazon...)"
          className="mb-3 w-full rounded-lg border border-white/10 bg-white/5 p-3 outline-none focus:border-primary"
        />
        <datalist id="empresas-comuns">
          {EMPRESAS_COMUNS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {EMPRESAS_COMUNS.slice(0, 6).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setEmpresa(c)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                empresa === c
                  ? "border-primary bg-primary/20 text-white"
                  : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <select
          value={tipo}
          onChange={(e) => {
            const v = e.target.value as typeof TIPOS_ENCOMENDA[number];
            if (TIPOS_ENCOMENDA.includes(v)) setTipo(v);
          }}
          className="mb-4 w-full rounded-lg border border-white/10 bg-white/5 p-3 outline-none focus:border-primary"
        >
          {TIPOS_ENCOMENDA.map((t) => (
            <option key={t} value={t} className="bg-[oklch(0.18_0.02_240)]">
              {t}
            </option>
          ))}
        </select>

        <label className="text-xs uppercase text-white/60">Foto da encomenda</label>
        <p className="mb-1 text-[11px] font-semibold text-[oklch(0.85_0.18_60)]">
          Obrigatório: toda encomenda precisa de uma foto no registro.
        </p>
        <p className="mb-2 text-[11px] text-white/50">
          Com o scanner ativo, a câmera abre automaticamente após ler o código. Sem rastreio,
          use "Escolher arquivo" para anexar uma imagem.
        </p>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
        />
        <input
          ref={arquivoRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
        />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20"
          >
            📷 Tirar foto
          </button>
          <button
            type="button"
            onClick={() => arquivoRef.current?.click()}
            className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80 hover:bg-white/5"
          >
            🖼 Escolher arquivo
          </button>
          {fotoPreview && (
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2">
              <img
                src={fotoPreview}
                alt="Prévia da encomenda"
                className="h-12 w-12 rounded object-cover"
              />
              <button
                type="button"
                onClick={() => setFoto(null)}
                className="text-xs text-white/60 underline hover:text-white"
              >
                remover
              </button>
            </div>
          )}
        </div>

        {salvouUltima && morador && (
          <div className="mb-3 rounded-lg border border-[oklch(0.65_0.18_145)]/30 bg-[oklch(0.65_0.18_145)]/10 p-3 text-sm">
            ✓ Encomenda salva para <span className="font-bold">{morador.nome}</span>. Digite outro
            código para adicionar mais uma para o mesmo morador.
          </div>
        )}

        <div className="flex gap-2">
          <button
            disabled={mutation.isPending || !morador || !foto}
            onClick={() => mutation.mutate()}
            className="flex-1 rounded-lg bg-[oklch(0.65_0.18_145)] p-3 font-bold transition hover:opacity-90 disabled:opacity-50"
          >
            {mutation.isPending ? "Salvando…" : "✅ Salvar"}
          </button>
          <button
            onClick={() => {
              if (salvouUltima) onSaved();
              else onClose();
            }}
            className="flex-1 rounded-lg bg-destructive p-3 font-bold text-destructive-foreground transition hover:opacity-90"
          >
            {salvouUltima ? "✓ Concluir" : "❌ Cancelar"}
          </button>
        </div>
      </div>
      {cadastroAberto && (
        <CadastroMoradorModal
          unidadeInicial={busca.trim()}
          atual={null}
          onClose={() => setCadastroAberto(false)}
          onSaved={(m) => {
            setMorador({ nome: m.nome, unidade: m.unidade, whatsapp: m.whatsapp });
            setBusca("");
            setCadastroAberto(false);
          }}
        />
      )}
      {waFallback && (
        <WaFallbackModal
          url={waFallback.url}
          msg={waFallback.msg}
          onClose={() => setWaFallback(null)}
          onOpenFoto={onOpenFoto}
        />
      )}
      {leitorAberto && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[oklch(0.14_0.02_240)] p-5 shadow-2xl">
            <h3 className="mb-3 text-lg font-bold">Escanear código</h3>
            <video ref={videoRef} className="aspect-video w-full rounded-xl bg-black object-cover" muted playsInline />
            <p className="my-3 text-sm text-white/60">Aponte a câmera para um EAN-13, Code 128 ou QR Code.</p>
            <button type="button" onClick={fecharLeitor} className="w-full rounded-lg bg-white/10 p-3 font-semibold hover:bg-white/20">
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


function ConfigModal({
  idleMinutes,
  onIdleChange,
  onClose,
}: {
  idleMinutes: number;
  onIdleChange: (v: number) => void;
  onClose: () => void;
}) {
  const [tpl, setTpl] = useState<string>(() => getTemplate());
  const [localIdle, setLocalIdle] = useState(idleMinutes);
  const [saved, setSaved] = useState(false);
  const [novoPorteiro, setNovoPorteiro] = useState("");
  const [adicionandoPorteiro, setAdicionandoPorteiro] = useState(false);
  const porteiros = useQuery({
    queryKey: ["porteiros"],
    queryFn: async () => {
      const { data, error } = await supabase.from("porteiros").select("*").order("nome");
      if (error) throw error;
      return (data ?? []) as Porteiro[];
    },
  });
  const qc = useQueryClient();

  async function salvarPorteiro() {
    const nome = novoPorteiro.trim();
    if (!nome) return;
    const { error } = await supabase.from("porteiros").insert({ nome });
    if (error) return toast.error(error.message);
    setNovoPorteiro("");
    setAdicionandoPorteiro(false);
    qc.invalidateQueries({ queryKey: ["porteiros"] });
  }

  async function alternarPorteiro(porteiro: Porteiro) {
    const { error } = await supabase.from("porteiros").update({ ativo: !porteiro.ativo }).eq("id", porteiro.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["porteiros"] });
  }

  async function excluirPorteiro(porteiro: Porteiro) {
    if (!window.confirm(`Excluir ${porteiro.nome}?`)) return;
    const { error } = await supabase.from("porteiros").delete().eq("id", porteiro.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["porteiros"] });
  }

  const preview = renderTemplate(tpl, {
    nome: "Maria",
    apto: "101",
    empresa: "Mercado Livre",
    tipo: "Caixa",
    codigo: "ABC123",
    logradouro: "Rua das Flores, 100",
    foto: "https://exemplo.com/foto-da-encomenda.jpg",
  });

  function salvar() {
    localStorage.setItem(TEMPLATE_KEY, tpl);
    const rounded = Math.min(10, Math.max(1, Math.round(localIdle)));
    localStorage.setItem(IDLE_MINUTES_KEY, String(rounded));
    onIdleChange(rounded);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function restaurar() {
    setTpl(DEFAULT_TEMPLATE);
    localStorage.removeItem(TEMPLATE_KEY);
  }

  function inserir(token: string) {
    setTpl((t) => t + token);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl border border-white/10 bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">⚙ Configurações</h3>
          <button onClick={onClose} className="text-white/60 hover:text-white" aria-label="Fechar">
            ✕
          </button>
        </div>

        {/* Tempo de inatividade */}
        <div className="mb-5 rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">Tela de descanso</div>
              <div className="text-xs text-white/60">
                Tempo de inatividade para abrir a apresentação automática.
              </div>
            </div>
            <div className="text-2xl font-black text-primary">{localIdle} min</div>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={localIdle}
            onChange={(e) => setLocalIdle(Number(e.target.value))}
            className="w-full accent-primary"
            aria-label="Tempo de inatividade em minutos"
          />
          <div className="mt-1 flex justify-between text-[10px] text-white/40">
            <span>1 min</span>
            <span>5 min</span>
            <span>10 min</span>
          </div>
        </div>

        <hr className="mb-5 border-white/10" />

        <section className="mb-5 rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">Porteiros Responsáveis</div>
              <div className="text-xs text-white/60">Disponíveis como atalhos ao confirmar uma entrega.</div>
            </div>
            <button type="button" onClick={() => setAdicionandoPorteiro(true)} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Adicionar Porteiro</button>
          </div>
          <div className="space-y-2">
            {porteiros.isLoading && <p className="text-sm text-white/60">Carregando…</p>}
            {porteiros.data?.map((porteiro) => (
              <div key={porteiro.id} className="flex items-center gap-3 rounded-lg bg-white/5 p-2.5">
                <span className="flex-1 text-sm font-medium">{porteiro.nome}</span>
                <div className="flex items-center gap-2 text-xs text-white/60">
                  <Switch checked={porteiro.ativo} onCheckedChange={() => void alternarPorteiro(porteiro)} aria-label={`Ativar ${porteiro.nome}`} />
                  {porteiro.ativo ? "Ativo" : "Inativo"}
                </div>
                <button type="button" onClick={() => void excluirPorteiro(porteiro)} className="text-sm text-red-300 hover:text-red-200">Excluir</button>
              </div>
            ))}
            {!porteiros.isLoading && porteiros.data?.length === 0 && <p className="text-sm text-white/60">Nenhum porteiro cadastrado.</p>}
          </div>
          {adicionandoPorteiro && <div className="mt-3 flex gap-2"><input autoFocus value={novoPorteiro} onChange={(e) => setNovoPorteiro(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void salvarPorteiro()} placeholder="Nome do porteiro" className="flex-1 rounded-lg border border-white/10 bg-white/5 p-2 outline-none focus:border-primary" /><button type="button" onClick={() => void salvarPorteiro()} className="rounded-lg bg-white/10 px-3 text-sm font-semibold">Adicionar</button></div>}
        </section>

        <div className="mb-2 text-sm font-semibold text-white">Modelo da mensagem do WhatsApp</div>
        <p className="mb-2 text-xs text-white/60">
          Use os marcadores abaixo. Eles serão substituídos pelos dados da encomenda no envio.
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {["{nome}", "{apto}", "{empresa}", "{tipo}", "{codigo}", "{logradouro}", "{foto}"].map((tk) => (
            <button
              key={tk}
              type="button"
              onClick={() => inserir(tk)}
              className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/90 hover:bg-white/20"
            >
              {tk}
            </button>
          ))}
        </div>

        <textarea
          value={tpl}
          onChange={(e) => setTpl(e.target.value)}
          rows={10}
          className="w-full rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-sm text-white outline-none focus:border-white/30"
        />

        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wider text-white/50">Pré-visualização</div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white/90">
{preview}
          </pre>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {saved && <span className="mr-auto text-sm text-emerald-400">✓ Salvo</span>}
          <button
            onClick={restaurar}
            className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            Restaurar padrão
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

async function shortenUrl(url: string): Promise<string> {
  try {
    const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    if (!res.ok) return url;
    const short = (await res.text()).trim();
    return short.startsWith("http") ? short : url;
  } catch {
    return url;
  }
}

async function buildWaUrl(
  morador: { nome: string; whatsapp: string },
  e: { codigo: string; apto: string; empresa: string; tipo: string; logradouro: string; foto?: string | null },
) {
  const digits = morador.whatsapp.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const phone = digits.startsWith("55") ? digits : `55${digits}`;
  const fotoShort = e.foto ? await shortenUrl(e.foto) : null;
  const msg = renderTemplate(getTemplate(), {
    nome: morador.nome,
    apto: e.apto,
    empresa: e.empresa,
    tipo: e.tipo,
    codigo: e.codigo,
    logradouro: e.logradouro,
    foto: fotoShort,
  });
  return {
    url: `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`,
    msg,
  };
}


function EntregaModal({
  encomendaId,
  base,
  onClose,
  onConfirmed,
  onOpenFoto,
}: {
  encomendaId: string;
  base: Encomenda | null;
  onClose: () => void;
  onConfirmed: () => void;
  onOpenFoto: (url: string) => void;
}) {
  const [recebedor, setRecebedor] = useState("");
  const [porteiroResponsavel, setPorteiroResponsavel] = useState("");
  const [waFallback, setWaFallback] = useState<{ url: string; msg: string } | null>(null);
  const porteiros = useQuery({
    queryKey: ["porteiros", "ativos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("porteiros").select("id, nome, ativo, created_at").eq("ativo", true).order("nome");
      if (error) throw error;
      return (data ?? []) as Porteiro[];
    },
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<{ queued: boolean; wa: { url: string; msg: string } | null }> => {
      if (!recebedor.trim()) throw new Error("Digite o nome do recebedor.");
      if (!porteiroResponsavel.trim()) throw new Error("Informe o responsável pela entrega.");
      const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
      const snapshot = base
        ? { status: base.status, recebedor: base.recebedor, porteiro_responsavel: base.porteiro_responsavel, entregue_at: base.entregue_at }
        : undefined;
      const entregueAt = new Date();

      // Tenta localizar o morador para montar a mensagem de WhatsApp.
      // `base.unidade` foi salvo como "APTO — Nome" no cadastro.
      let wa: { url: string; msg: string } | null = null;
      if (base && isOnline) {
        const [aptoRaw, ...nomeParts] = base.unidade.split(" — ");
        const apto = (aptoRaw ?? "").trim();
        const nomeAlvo = nomeParts.join(" — ").trim();
        if (apto) {
          const { data: mds } = await supabase
            .from("moradores")
            .select("nome, unidade, whatsapp")
            .eq("unidade", apto);
          const lista = (mds ?? []) as { nome: string; unidade: string; whatsapp: string }[];
          const alvo =
            lista.find((m) => m.nome.trim().toLowerCase() === nomeAlvo.toLowerCase()) ??
            lista[0] ??
            null;
          if (alvo) {
            const digits = alvo.whatsapp.replace(/\D/g, "");
            if (digits.length >= 10) {
              const phone = digits.startsWith("55") ? digits : `55${digits}`;
              const dataFmt = entregueAt.toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });
              const msg = DELIVERY_TEMPLATE
                .replaceAll("{nome}", alvo.nome)
                .replaceAll("{recebedor}", recebedor.trim())
                .replaceAll("{empresa}", base.empresa)
                .replaceAll("{tipo}", base.tipo)
                .replaceAll("{codigo}", base.codigo)
                .replaceAll("{data}", dataFmt);
              wa = {
                url: `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`,
                msg,
              };
            }
          }
        }
      }

      if (!isOnline) {
        await queueDeliver(encomendaId, recebedor, porteiroResponsavel.trim(), snapshot);
        return { queued: true, wa };
      }
      try {
        const { error } = await supabase
          .from("encomendas")
          .update({ status: "entregue", recebedor, porteiro_responsavel: porteiroResponsavel.trim(), entregue_at: entregueAt.toISOString() })
          .eq("id", encomendaId);
        if (error) throw error;
        return { queued: false, wa };
      } catch {
        await queueDeliver(encomendaId, recebedor, porteiroResponsavel.trim(), snapshot);
        return { queued: true, wa };
      }
    },
    onSuccess: (r) => {
      if (r.queued) {
        alert("📡 Sem conexão — entrega salva offline e será sincronizada quando voltar.");
      }
      if (r.wa) {
        setWaFallback(r.wa);
      } else {
        onConfirmed();
      }
    },
    onError: (e: Error) => alert("❌ " + e.message),
  });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[oklch(0.14_0.02_240)] p-8 shadow-2xl">
        <h2 className="mb-4 text-xl font-bold">✅ Confirmar entrega</h2>
        <input
          autoFocus
          value={recebedor}
          onChange={(e) => setRecebedor(e.target.value)}
          placeholder="Nome do recebedor (obrigatório)"
          className="mb-6 w-full rounded-lg border border-white/10 bg-white/5 p-3 outline-none focus:border-[oklch(0.65_0.18_145)]"
        />
        <label className="mb-1 block text-xs uppercase text-white/60">Responsável pela entrega</label>
        <input
          value={porteiroResponsavel}
          onChange={(e) => setPorteiroResponsavel(e.target.value)}
          placeholder="Nome do porteiro (obrigatório)"
          className="mb-2 w-full rounded-lg border border-white/10 bg-white/5 p-3 outline-none focus:border-[oklch(0.65_0.18_145)]"
        />
        {porteiros.data && porteiros.data.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            {porteiros.data.map((porteiro) => (
              <button key={porteiro.id} type="button" onClick={() => setPorteiroResponsavel(porteiro.nome)} className={`rounded bg-gray-800 px-3 py-1.5 text-sm transition hover:bg-gray-700 ${porteiroResponsavel === porteiro.nome ? "ring-1 ring-primary" : ""}`}>
                {porteiro.nome}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          <button
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            className="flex-1 rounded-lg bg-[oklch(0.65_0.18_145)] p-3 font-bold transition hover:opacity-90 disabled:opacity-50"
          >
            ✓ Confirmar
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-lg bg-destructive p-3 font-bold text-destructive-foreground transition hover:opacity-90"
          >
            ✕ Voltar
          </button>
        </div>
      </div>
      {waFallback && (
        <WaFallbackModal
          url={waFallback.url}
          msg={waFallback.msg}
          onClose={() => {
            setWaFallback(null);
            onConfirmed();
          }}
          onOpenFoto={onOpenFoto}
        />
      )}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="mb-2 w-full rounded-lg border border-white/10 bg-white/5 p-3 outline-none transition focus:border-primary"
    />
  );
}

function CadastroMoradorModal({
  unidadeInicial,
  atual,
  onClose,
  onSaved,
}: {
  unidadeInicial: string;
  atual: { nome: string; whatsapp: string } | null;
  onClose: () => void;
  onSaved: (m: { unidade: string; nome: string; whatsapp: string }) => void;
}) {
  const [unidade, setUnidade] = useState(unidadeInicial);
  const [nome, setNome] = useState(atual?.nome ?? "");
  const [whatsapp, setWhatsapp] = useState(atual?.whatsapp ?? "");
  const [existentes, setExistentes] = useState<{ nome: string; whatsapp: string }[]>([]);

  // Carrega moradores já cadastrados na mesma unidade para agrupar visualmente
  useEffect(() => {
    const u = unidade.trim();
    if (!u) {
      setExistentes([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const { data, error } = await supabase
        .from("moradores")
        .select("nome, whatsapp")
        .eq("unidade", u);
      if (cancelled || error) return;
      setExistentes((data ?? []) as { nome: string; whatsapp: string }[]);
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [unidade]);

  const mutation = useMutation({
    mutationFn: async () => {
      const u = unidade.trim();
      const n = nome.trim();
      const w = whatsapp.replace(/\D/g, "");
      if (!u || !n || w.length < 10) {
        throw new Error("Preencha apartamento, nome e WhatsApp (DDD + número).");
      }
      // Permite múltiplos moradores na mesma unidade (mesmo apto/casa).
      // Evita duplicar o mesmo morador (mesmo nome) na mesma unidade.
      const jaExiste = existentes.some(
        (m) => m.nome.trim().toLowerCase() === n.toLowerCase(),
      );
      if (!jaExiste) {
        const { error } = await supabase
          .from("moradores")
          .insert({ unidade: u, nome: n, whatsapp: w });
        if (error) throw error;
      }
      return { unidade: u, nome: n, whatsapp: w };
    },
    onSuccess: (m) => onSaved(m),
    onError: (e: Error) => alert("❌ " + e.message),
  });

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[oklch(0.14_0.02_240)] p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-bold">👤 Cadastro rápido de morador</h2>
        <p className="mb-4 text-xs text-white/60">
          Vários moradores podem dividir o mesmo apto/casa.
        </p>

        <label className="text-xs uppercase text-white/60">Apartamento / Unidade</label>
        <input
          autoFocus={!unidadeInicial}
          value={unidade}
          onChange={(e) => setUnidade(e.target.value)}
          placeholder="Ex: 101"
          className="mb-3 w-full rounded-lg border border-white/10 bg-white/5 p-3 outline-none focus:border-primary"
        />

        {existentes.length > 0 && (
          <div className="mb-3 rounded-lg border border-white/10 bg-white/5 p-2">
            <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-white/50">
              Já moram aqui ({existentes.length})
            </div>
            <ul className="space-y-1">
              {existentes.map((m, i) => (
                <li
                  key={`${m.nome}-${i}`}
                  className="flex items-center justify-between rounded px-2 py-1 text-xs"
                >
                  <span className="font-semibold">{m.nome}</span>
                  <button
                    type="button"
                    onClick={() => onSaved({ unidade: unidade.trim(), nome: m.nome, whatsapp: m.whatsapp })}
                    className="text-white/60 underline hover:text-white"
                  >
                    usar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="text-xs uppercase text-white/60">Nome do morador</label>
        <input
          autoFocus={!!unidadeInicial}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome completo"
          className="mb-3 w-full rounded-lg border border-white/10 bg-white/5 p-3 outline-none focus:border-primary"
        />

        <label className="text-xs uppercase text-white/60">WhatsApp</label>
        <input
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="(11) 91234-5678"
          inputMode="tel"
          className="mb-5 w-full rounded-lg border border-white/10 bg-white/5 p-3 outline-none focus:border-primary"
        />

        <div className="flex gap-2">
          <button
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            className="flex-1 rounded-lg bg-[oklch(0.65_0.18_145)] p-3 font-bold transition hover:opacity-90 disabled:opacity-50"
          >
            {mutation.isPending ? "Salvando…" : "✅ Salvar morador"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-lg bg-destructive p-3 font-bold text-destructive-foreground transition hover:opacity-90"
          >
            ✕ Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function WaFallbackModal({
  url,
  msg,
  onClose,
  onOpenFoto,
}: {
  url: string;
  msg: string;
  onClose: () => void;
  onOpenFoto: (url: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  // Extrai o link da foto (se houver) para destacar na pré-visualização.
  const fotoUrl = msg.match(/https?:\/\/\S+/)?.[0] ?? null;

  const copyMsg = async () => {
    try {
      await navigator.clipboard.writeText(msg);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback silencioso: usuário pode selecionar manualmente
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[oklch(0.14_0.02_240)] p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-bold">📱 Pré-visualização da mensagem</h2>
        <p className="mb-4 text-xs text-white/60">
          Confira o texto que será enviado ao morador antes de abrir o WhatsApp.
        </p>

        <label className="text-xs uppercase text-white/60">Mensagem</label>
        <div className="mb-3 max-h-64 overflow-auto rounded-lg border border-[oklch(0.65_0.18_145)]/25 bg-[oklch(0.2_0.03_150)]/40 p-3 text-sm whitespace-pre-wrap text-white/90">
          {msg}
        </div>

        {fotoUrl && (
          <div className="mb-3 rounded-lg border border-white/10 bg-white/5 p-3 text-xs">
            <div className="mb-1 font-semibold uppercase tracking-wider text-white/60">
              📷 Foto da encomenda
            </div>
            <button
              onClick={() => onOpenFoto(fotoUrl)}
              className="block w-full text-left break-all text-[oklch(0.85_0.15_200)] underline hover:text-white"
            >
              Clique aqui para ver a foto
            </button>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={copyMsg}
            className="flex-1 rounded-lg bg-white/10 p-3 text-sm font-bold transition hover:bg-white/20"
          >
            {copied ? "✓ Copiado" : "📋 Copiar mensagem"}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={() => setTimeout(onClose, 200)}
            className="flex-1 rounded-lg bg-[oklch(0.65_0.18_145)] p-3 text-center text-sm font-bold transition hover:opacity-90"
          >
            📤 Enviar no WhatsApp
          </a>
        </div>
        <button
          onClick={onClose}
          className="mt-3 w-full rounded-lg border border-white/15 p-2.5 text-sm font-semibold text-white/70 transition hover:bg-white/5"
        >
          Cancelar envio
        </button>
      </div>
    </div>
  );
}

function ConflictsModal({
  onClose,
  onResolved,
}: {
  onClose: () => void;
  onResolved: () => void;
}) {
  const [list, setList] = useState<Conflict[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => setList(await readConflicts());

  useEffect(() => {
    void refresh();
    const unsub = subscribeOutbox(refresh);
    return () => {
      unsub();
    };
  }, []);

  const handle = async (id: string, choice: "keep_server" | "force_local") => {
    setBusy(id);
    const ok = await resolveConflict(id, choice);
    setBusy(null);
    if (!ok) {
      alert("Não foi possível resolver o conflito agora. Verifique a conexão.");
      return;
    }
    await refresh();
    onResolved();
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[oklch(0.16_0.02_240)] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">⚠ Conflitos de sincronização</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            ✕
          </button>
        </div>
        <p className="mb-4 text-sm text-white/70">
          Estas alterações feitas offline divergem do estado atual no servidor. Escolha como
          resolver cada uma:
        </p>
        {list.length === 0 && (
          <div className="rounded-lg bg-white/5 py-8 text-center text-white/60">
            Nenhum conflito pendente. 🎉
          </div>
        )}
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          {list.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-[oklch(0.55_0.22_25)]/30 bg-white/5 p-4"
            >
              {c.kind === "deliver" ? (
                <>
                  <div className="mb-2 text-sm font-bold text-[oklch(0.9_0.18_30)]">
                    Entrega — {c.reason === "missing" ? "encomenda não existe mais" : "já foi entregue"}
                  </div>
                  <div className="grid gap-3 text-xs md:grid-cols-2">
                    <div className="rounded bg-black/30 p-3">
                      <div className="mb-1 font-bold text-white/60 uppercase">Servidor</div>
                      <div>Status: {c.server.status}</div>
                      <div>Recebedor: {c.server.recebedor ?? "—"}</div>
                      <div>Em: {c.server.entregue_at ?? "—"}</div>
                    </div>
                    <div className="rounded bg-black/30 p-3">
                      <div className="mb-1 font-bold text-white/60 uppercase">Sua versão (offline)</div>
                      <div>Status: entregue</div>
                      <div>Recebedor: {c.op.payload.recebedor}</div>
                      <div>Em: {c.op.payload.entregueAt}</div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-2 text-sm font-bold text-[oklch(0.9_0.18_30)]">
                    Nova encomenda — código já existe no servidor
                  </div>
                  <div className="grid gap-3 text-xs md:grid-cols-2">
                    <div className="rounded bg-black/30 p-3">
                      <div className="mb-1 font-bold text-white/60 uppercase">Servidor</div>
                      <div>Código: {c.server.codigo}</div>
                      <div>Morador: {c.server.unidade}</div>
                      <div>Status: {c.server.status}</div>
                    </div>
                    <div className="rounded bg-black/30 p-3">
                      <div className="mb-1 font-bold text-white/60 uppercase">Sua versão (offline)</div>
                      <div>Código: {c.op.payload.codigo}</div>
                      <div>Morador: {c.op.payload.unidade}</div>
                      <div>Empresa: {c.op.payload.empresa}</div>
                    </div>
                  </div>
                </>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  disabled={busy === c.id}
                  onClick={() => handle(c.id, "keep_server")}
                  className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm font-bold transition hover:bg-white/20 disabled:opacity-50"
                >
                  Manter servidor
                </button>
                <button
                  disabled={busy === c.id || c.reason === "missing"}
                  onClick={() => handle(c.id, "force_local")}
                  title={c.reason === "missing" ? "Encomenda não existe mais no servidor" : ""}
                  className="flex-1 rounded-lg bg-[oklch(0.55_0.22_25)] px-3 py-2 text-sm font-bold transition hover:opacity-90 disabled:opacity-50"
                >
                  {c.kind === "create" ? "Inserir mesmo assim" : "Sobrescrever c/ minha versão"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FotoModal({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] max-w-5xl flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-white/20"
          aria-label="Fechar"
        >
          ✕ Fechar
        </button>
        <img
          src={url}
          alt="Foto da encomenda"
          className="max-h-[80vh] max-w-full rounded-xl border border-white/10 object-contain shadow-2xl"
        />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
        >
          🌐 Abrir imagem original
        </a>

      </div>
      
    </div>
  );
}

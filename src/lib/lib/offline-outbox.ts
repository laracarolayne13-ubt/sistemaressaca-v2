import { get, set } from "idb-keyval";
import { supabase } from "@/integrations/supabase/client";

export type EncomendaSnapshot = {
  status: string;
  recebedor: string | null;
  porteiro_responsavel: string | null;
  entregue_at: string | null;
};

export type PendingOp =
  | {
      id: string;
      kind: "create";
      createdAt: number;
      payload: {
        codigo: string;
        unidade: string;
        logradouro: string;
        empresa: string;
        tipo: string;
      };
      foto?: { name: string; type: string; data: number[] } | null;
    }
  | {
      id: string;
      kind: "deliver";
      createdAt: number;
      payload: {
        encomendaId: string;
        recebedor: string;
        porteiroResponsavel: string;
        entregueAt: string;
      };
      /** State observed on the device when the op was queued. Used to detect
       *  remote changes that happened before sync. */
      baseSnapshot?: EncomendaSnapshot;
    };

export type Conflict =
  | {
      id: string;
      kind: "deliver";
      detectedAt: number;
      op: Extract<PendingOp, { kind: "deliver" }>;
      server: EncomendaSnapshot & { id: string; codigo: string; unidade: string };
      reason: "already_delivered" | "missing";
    }
  | {
      id: string;
      kind: "create";
      detectedAt: number;
      op: Extract<PendingOp, { kind: "create" }>;
      server: { id: string; status: string; codigo: string; unidade: string };
      reason: "duplicate_codigo";
    };

const KEY = "encomendas-outbox-v1";
const CONFLICTS_KEY = "encomendas-conflicts-v1";
const listeners = new Set<() => void>();

export function subscribeOutbox(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  listeners.forEach((l) => l());
}

export async function readOutbox(): Promise<PendingOp[]> {
  return (await get<PendingOp[]>(KEY)) ?? [];
}

async function writeOutbox(ops: PendingOp[]) {
  await set(KEY, ops);
  notify();
}

export async function readConflicts(): Promise<Conflict[]> {
  return (await get<Conflict[]>(CONFLICTS_KEY)) ?? [];
}

async function writeConflicts(list: Conflict[]) {
  await set(CONFLICTS_KEY, list);
  notify();
}

async function addConflict(c: Conflict) {
  const list = await readConflicts();
  list.push(c);
  await writeConflicts(list);
}

export async function conflictsCount() {
  return (await readConflicts()).length;
}

export async function resolveConflict(
  conflictId: string,
  choice: "keep_server" | "force_local",
): Promise<boolean> {
  const list = await readConflicts();
  const c = list.find((x) => x.id === conflictId);
  if (!c) return false;
  let ok = true;
  if (choice === "force_local") {
    if (c.kind === "deliver") {
      const { error } = await supabase
        .from("encomendas")
        .update({
          status: "entregue",
          recebedor: c.op.payload.recebedor,
          porteiro_responsavel: c.op.payload.porteiroResponsavel,
          entregue_at: c.op.payload.entregueAt,
        })
        .eq("id", c.op.payload.encomendaId);
      ok = !error;
    } else if (c.kind === "create") {
      // re-queue create as a fresh op (force insert anyway)
      await enqueue({ ...c.op, id: crypto.randomUUID(), createdAt: Date.now() });
      ok = true;
    }
  }
  if (ok) {
    await writeConflicts(list.filter((x) => x.id !== conflictId));
  }
  return ok;
}

export async function enqueue(op: PendingOp) {
  const ops = await readOutbox();
  ops.push(op);
  await writeOutbox(ops);
}

export async function outboxCount() {
  return (await readOutbox()).length;
}

async function fileToBytes(file: File) {
  const buf = await file.arrayBuffer();
  return Array.from(new Uint8Array(buf));
}

export async function queueCreate(
  payload: { codigo: string; unidade: string; logradouro: string; empresa: string; tipo: string },
  foto: File | null,
) {
  const op: PendingOp = {
    id: crypto.randomUUID(),
    kind: "create",
    createdAt: Date.now(),
    payload,
    foto: foto ? { name: foto.name, type: foto.type, data: await fileToBytes(foto) } : null,
  };
  await enqueue(op);
}

export async function queueDeliver(
  encomendaId: string,
  recebedor: string,
  porteiroResponsavel: string,
  baseSnapshot?: EncomendaSnapshot,
) {
  const op: PendingOp = {
    id: crypto.randomUUID(),
    kind: "deliver",
    createdAt: Date.now(),
    payload: { encomendaId, recebedor, porteiroResponsavel, entregueAt: new Date().toISOString() },
    baseSnapshot,
  };
  await enqueue(op);
}

type OpResult = "ok" | "fail" | "conflict";

async function runOp(op: PendingOp): Promise<OpResult> {
  if (op.kind === "create") {
    // Conflict policy: always overwrite. Duplicates simply create a second
    // row; the local op wins.
    let foto_url: string | null = null;
    if (op.foto) {
      const bytes = new Uint8Array(op.foto.data);
      const blob = new Blob([bytes], { type: op.foto.type });
      const ext = op.foto.name.split(".").pop() ?? "jpg";
      const path = `${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
      const up = await supabase.storage.from("encomendas").upload(path, blob, {
        contentType: op.foto.type,
      });
      if (up.error) return "fail";
      foto_url = supabase.storage.from("encomendas").getPublicUrl(path).data.publicUrl;
    }
    const { error } = await supabase.from("encomendas").insert({
      ...op.payload,
      foto_url,
      status: "pendente",
    });
    return error ? "fail" : "ok";
  }
  if (op.kind === "deliver") {
    // Conflict policy: always overwrite. The local delivery wins even if
    // the server already has a different recebedor/status.
    const { error } = await supabase
      .from("encomendas")
      .update({
        status: "entregue",
        recebedor: op.payload.recebedor,
        porteiro_responsavel: op.payload.porteiroResponsavel,
        entregue_at: op.payload.entregueAt,
      })
      .eq("id", op.payload.encomendaId);
    return error ? "fail" : "ok";
  }
  return "fail";
}

let flushing = false;

export async function flushOutbox(): Promise<{
  done: number;
  remaining: number;
  conflicts: number;
}> {
  if (flushing)
    return {
      done: 0,
      remaining: (await readOutbox()).length,
      conflicts: await conflictsCount(),
    };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      done: 0,
      remaining: (await readOutbox()).length,
      conflicts: await conflictsCount(),
    };
  }
  flushing = true;
  let done = 0;
  let conflicts = 0;
  try {
    let ops = await readOutbox();
    const remaining: PendingOp[] = [];
    for (const op of ops) {
      try {
        const r = await runOp(op);
        if (r === "ok") done++;
        else if (r === "conflict") conflicts++;
        // ok or conflict → remove from outbox; fail → keep for retry
        else remaining.push(op);
      } catch {
        remaining.push(op);
      }
    }
    await writeOutbox(remaining);
    return { done, remaining: remaining.length, conflicts };
  } finally {
    flushing = false;
  }
}

export function setupAutoFlush(
  onFlushed: (result: { done: number; remaining: number; conflicts: number }) => void,
) {
  if (typeof window === "undefined") return () => {};
  const handler = async () => {
    const r = await flushOutbox();
    if (r.done > 0 || r.conflicts > 0) onFlushed(r);
  };
  window.addEventListener("online", handler);
  const interval = window.setInterval(handler, 30000);
  // try once on setup
  void handler();
  return () => {
    window.removeEventListener("online", handler);
    window.clearInterval(interval);
  };
}

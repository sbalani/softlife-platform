import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { login, password } = await req.json();
  if (!login || !password) {
    return NextResponse.json({ error: { message: "Missing credentials" } }, { status: 400 });
  }
  // TODO: integrate Supabase Auth (signInWithPassword). For now: pass-through.
  return NextResponse.json({
    token: "sl-" + Buffer.from(login + Date.now()).toString("base64url"),
    user: {
      uid: 1,
      name: "Operador Demo",
      login,
      role: "limpieza_reposicion",
      warehouse_id: 1,
    },
  });
}

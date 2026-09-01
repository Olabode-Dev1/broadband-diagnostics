import { NextResponse } from "next/server";
import { x17uAdapter } from "../../../../lib/router-adapters/x17u";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      baseUrl?: string;
      username?: string;
      password?: string;
      sessionId?: string;
    };

    if (!body.baseUrl) {
      return NextResponse.json(
        { error: "Router address is required." },
        { status: 400 },
      );
    }

    if (body.sessionId) {
      const snapshot = await x17uAdapter.readStats(body.sessionId, body.baseUrl);
      return NextResponse.json({
        snapshot,
        sessionId: body.sessionId,
        sessionMode: "existing",
      });
    }

    if (!body.password) {
      return NextResponse.json(
        { error: "Sign in once with the router password first." },
        { status: 400 },
      );
    }

    const login = await x17uAdapter.login({
      baseUrl: body.baseUrl,
      username: body.username || "admin",
      password: body.password,
    });
    const snapshot = await x17uAdapter.readStats(login.sessionId, body.baseUrl);

    return NextResponse.json({
      snapshot,
      sessionId: login.sessionId,
      sessionMode: "new",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The router could not be reached.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

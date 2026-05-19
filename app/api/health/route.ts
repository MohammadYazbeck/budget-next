import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    const authConfigured = hasAdminCredentials();

    if (env.NODE_ENV === "production" && !authConfigured) {
      return NextResponse.json(
        {
          status: "error",
          service: "budget-next",
          auth: "missing",
          database: "ok",
          timeZone: env.APP_TIME_ZONE,
          timestamp: new Date().toISOString(),
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      status: "ok",
      service: "budget-next",
      auth: authConfigured ? "configured" : "disabled",
      database: "ok",
      timeZone: env.APP_TIME_ZONE,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        service: "budget-next",
        auth: hasAdminCredentials() ? "configured" : "missing",
        database: "error",
        message: error instanceof Error ? error.message : "Unknown database error",
        timeZone: env.APP_TIME_ZONE,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}

function hasAdminCredentials() {
  return Boolean(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD);
}

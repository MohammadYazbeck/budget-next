import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_TIME_ZONE: z.string().min(1).default("Asia/Damascus"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  APP_TIME_ZONE: process.env.APP_TIME_ZONE,
  NODE_ENV: process.env.NODE_ENV,
});

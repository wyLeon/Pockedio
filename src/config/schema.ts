import { z } from "zod";

export const mbtiTypes = [
  "INTJ", "INTP", "ENTJ", "ENTP",
  "INFJ", "INFP", "ENFJ", "ENFP",
  "ISTJ", "ISFJ", "ESTJ", "ESFJ",
  "ISTP", "ISFP", "ESTP", "ESFP"
] as const;

export const fishAudioModelDir =
  "/Users/leonw/.cache/huggingface/hub/models--appautomaton--fishaudio-s2-pro-8bit-mlx/snapshots/29ab46393de21f696a82050d8594a677a5797f7e";

export const pockedioConfigSchema = z.object({
  netease: z.object({
    baseUrl: z.string().url().default("http://127.0.0.1:3000")
  }).default({}),
  weather: z.object({
    location: z.string().min(1).default("Shanghai")
  }).default({}),
  calendar: z.object({
    enabled: z.boolean().default(true)
  }).default({}),
  diary: z.object({
    enabled: z.boolean().default(false),
    path: z.string().min(1).optional()
  }).default({}),
  personality: z.object({
    mbti: z.enum(mbtiTypes).optional()
  }).default({}),
  llm: z.object({
    provider: z.literal("openai").default("openai"),
    model: z.string().min(1).default("gpt-4.1-mini"),
    baseUrl: z.string().url().optional(),
    apiKeyEnv: z.string().min(1).default("OPENAI_API_KEY")
  }).default({}),
  fishAudio: z.object({
    pythonPath: z.string().min(1).default(".cache/mlx-speech-venv/bin/python"),
    scriptPath: z.string().min(1).default(".cache/mlx-speech/scripts/generate/fish_s2_pro.py"),
    modelDir: z.string().min(1).default(fishAudioModelDir)
  }).default({}),
  paths: z.object({
    database: z.string().min(1),
    taste: z.string().min(1),
    personas: z.string().min(1),
    djAudioDir: z.string().min(1)
  })
});

export type PockedioConfig = z.infer<typeof pockedioConfigSchema>;
export type MbtiType = typeof mbtiTypes[number];

import { z } from "zod";

export const mbtiTypes = [
  "INTJ", "INTP", "ENTJ", "ENTP",
  "INFJ", "INFP", "ENFJ", "ENFP",
  "ISTJ", "ISFJ", "ESTJ", "ESFJ",
  "ISTP", "ISFP", "ESTP", "ESFP"
] as const;

export const djProgramLengths = ["short", "standard", "extended"] as const;
export const djStyles = ["direct", "warm", "exploratory", "low-talk"] as const;
export const ttsProviders = ["auto", "macos", "kokoro", "fish", "fish_api", "text"] as const;
export const macosVoices = ["lumen", "sable", "arden", "vale", "sol"] as const;
export const kokoroVoices = ["af_kore", "af_nicole", "bf_isabella", "am_michael", "am_onyx", "bm_daniel", "bm_george", "bm_lewis"] as const;
export const fishVoices = ["mina", "nova"] as const;
export const musicProviders = ["netease"] as const;
export const neteaseAuthModes = ["anonymous", "account"] as const;
export const neteaseQualityLevels = ["standard", "higher", "exhigh", "lossless", "hires"] as const;
const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const scheduledDjProgramSchema = z.object({
  enabled: z.boolean().default(true),
  playTime: timeOfDaySchema,
  prepareMinutesBefore: z.number().int().min(0).max(120).default(20)
});

export const fishAudioModelDir = ".cache/fishaudio-s2-pro-8bit-mlx";
export const fishApiDefaultReferenceIds = {
  mina: "20f9a738ef5a4b0396b320fc2a5693c2",
  nova: "20f9a738ef5a4b0396b320fc2a5693c2"
} as const;
export const kokoroAudioDir = ".cache/kokoro-spike";
export const kokoroAudioPythonPath = `${kokoroAudioDir}/.venv/bin/python`;
export const kokoroAudioModelPath = `${kokoroAudioDir}/kokoro-v1.0.onnx`;
export const kokoroAudioVoicesPath = `${kokoroAudioDir}/voices-v1.0.bin`;

export const pockedioConfigSchema = z.object({
  netease: z.object({
    baseUrl: z.string().url().default("http://127.0.0.1:3000"),
    authMode: z.enum(neteaseAuthModes).default("anonymous"),
    qualityLevel: z.enum(neteaseQualityLevels).default("standard")
  }).default({}),
  music: z.object({
    provider: z.enum(musicProviders).default("netease")
  }).default({}),
  weather: z.object({
    enabled: z.boolean().default(false),
    location: z.string().min(1).default("Shanghai")
  }).default({}),
  calendar: z.object({
    enabled: z.boolean().default(false)
  }).default({}),
  diary: z.object({
    enabled: z.boolean().default(false),
    path: z.string().min(1).optional()
  }).default({}),
  personality: z.object({
    mbti: z.enum(mbtiTypes).optional()
  }).default({}),
  freshness: z.object({
    enabled: z.boolean().default(true)
  }).default({}),
  memory: z.object({
    dailyHeartbeat: z.boolean().default(true),
    heartbeatIntervalHours: z.number().min(0.1).max(24).default(6),
    heartbeatHistoryLimit: z.number().int().min(0).max(500).default(20)
  }).default({}),
  llm: z.object({
    provider: z.literal("openai").default("openai"),
    model: z.string().min(1).default("gpt-4.1-mini"),
    baseUrl: z.string().url().optional(),
    apiKeyEnv: z.string().min(1).default("OPENAI_API_KEY")
  }).default({}),
  tts: z.object({
    provider: z.enum(ttsProviders).default("auto"),
    macosVoice: z.enum(macosVoices).default("vale"),
    kokoroVoice: z.enum(kokoroVoices).default("af_nicole"),
    fishVoice: z.enum(fishVoices).default("mina")
  }).default({}),
  dj: z.object({
    personaPreference: z.string().min(1).default("scheduled"),
    displayName: z.string().min(1).default("Pockedio"),
    language: z.string().min(1).default("English"),
    programLength: z.enum(djProgramLengths).default("standard"),
    style: z.enum(djStyles).default("warm"),
    schedule: z.object({
      morning: scheduledDjProgramSchema.default({ playTime: "08:45" }),
      evening: scheduledDjProgramSchema.default({ playTime: "17:00" })
    }).default({})
  }).default({}),
  fishAudio: z.object({
    pythonPath: z.string().min(1).default(".cache/mlx-speech-venv/bin/python"),
    scriptPath: z.string().min(1).default(".cache/mlx-speech/scripts/generate/fish_s2_pro.py"),
    modelDir: z.string().min(1).default(fishAudioModelDir),
    referenceAudioPath: z.string().min(1).optional(),
    referenceText: z.string().min(1).optional()
  }).default({}),
  fishApi: z.object({
    baseUrl: z.string().url().default("https://api.fish.audio"),
    apiKeyEnv: z.string().min(1).default("FISH_API_KEY"),
    proxyEnv: z.string().min(1).default("POCKEDIO_FISH_PROXY"),
    model: z.string().min(1).default("s2-pro"),
    format: z.enum(["mp3", "wav", "pcm", "opus"]).default("mp3"),
    latency: z.enum(["low", "balanced", "normal"]).default("balanced"),
    chunkLength: z.number().int().min(100).max(300).default(150),
    referenceIds: z.object({
      mina: z.string().min(1).default(fishApiDefaultReferenceIds.mina),
      nova: z.string().min(1).default(fishApiDefaultReferenceIds.nova)
    }).default({})
  }).default({}),
  kokoroAudio: z.object({
    pythonPath: z.string().min(1).default(kokoroAudioPythonPath),
    modelPath: z.string().min(1).default(kokoroAudioModelPath),
    voicesPath: z.string().min(1).default(kokoroAudioVoicesPath)
  }).default({}),
  paths: z.object({
    database: z.string().min(1),
    taste: z.string().min(1),
    personas: z.string().min(1),
    djAudioDir: z.string().min(1),
    neteaseCookie: z.string().min(1),
    llmSecrets: z.string().min(1)
  })
});

export type PockedioConfig = z.infer<typeof pockedioConfigSchema>;
export type MbtiType = typeof mbtiTypes[number];
export type DjProgramLength = typeof djProgramLengths[number];
export type DjStyle = typeof djStyles[number];
export type TtsProvider = typeof ttsProviders[number];
export type MacosVoice = typeof macosVoices[number];
export type KokoroVoice = typeof kokoroVoices[number];
export type FishVoice = typeof fishVoices[number];
export type ScheduledDjProgramConfig = PockedioConfig["dj"]["schedule"]["morning"];
export type NetEaseAuthMode = typeof neteaseAuthModes[number];
export type NetEaseQualityLevel = typeof neteaseQualityLevels[number];
export type MusicProviderName = typeof musicProviders[number];

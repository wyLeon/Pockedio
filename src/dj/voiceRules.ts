export type DjAudioTriggerType =
  | "normal_playback"
  | "direct_playback"
  | "scheduled_morning"
  | "scheduled_evening"
  | "conversation"
  | "mood_check";

export type SpokenDjAudioInput = {
  triggerType: DjAudioTriggerType;
  userExplicitlyRequestedDjAudio: boolean;
  now?: Date;
};

export function shouldUseSpokenDjAudio(input: SpokenDjAudioInput): boolean {
  if (input.userExplicitlyRequestedDjAudio) {
    return true;
  }

  return input.triggerType === "scheduled_morning" || input.triggerType === "scheduled_evening";
}

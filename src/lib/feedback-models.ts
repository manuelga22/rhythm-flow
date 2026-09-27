import { supabase } from "@/lib/supabase";

/** A row of public.feedback_models: a model the learner can pick to write their take feedback. */
export type FeedbackModel = {
  id: string;
  label: string;
  description: string;
  /** "gemini" models listen to the take; "template" is the rule-based feedback. */
  provider: "gemini" | "template";
  is_default: boolean;
};

export const feedbackModelsKey = ["feedback-models"] as const;

export async function fetchFeedbackModels(): Promise<FeedbackModel[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("feedback_models").select("id,label,description,provider,is_default").order("sort").returns<FeedbackModel[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

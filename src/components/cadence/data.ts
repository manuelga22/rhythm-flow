export type Stage = "source" | "shadow" | "shadowFeedback" | "improvise" | "improvFeedback" | "complete";

export const waveA = [36,62,43,88,55,29,72,47,94,58,34,77,52,85,43,65,31,76,48,91,54,37,70,44,82,40,68,33,73,49];
export const waveB = [42,70,39,91,61,35,79,50,96,64,40,81,55,89,49,71,34,72,52,87,60,41,75,48,78,45,63,37,69,54];

export const stepLabels = ["Source", "Shadow", "Compare", "Improvise", "Complete"];
export const stageStep: Record<Stage, number> = { source: 0, shadow: 1, shadowFeedback: 2, improvise: 3, improvFeedback: 3, complete: 4 };

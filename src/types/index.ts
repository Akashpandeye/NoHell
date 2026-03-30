/** Lifecycle of a watch/learn session. */
export type SessionStatus = "active" | "paused" | "completed" | "abandoned";

/** A milestone or section marker along the tutorial timeline. */
export interface Checkpoint {
  id: string;
  /** Position in the video (seconds). */
  timestampSeconds: number;
  label: string;
  summary?: string;
  completed?: boolean;
}

/** Spaced-repetition style card (e.g. hourly revision). */
export interface RevisionCard {
  id: string;
  sessionId: string;
  front: string;
  back: string;
  dueAt: Date | null;
  createdAt: Date;
}

/** AI-generated segment recap (Claude `/api/revision/card`). */
export interface TutorialRevisionCard {
  time_range: string;
  concepts: Array<{
    name: string;
    what: string;
    why: string;
    analogy: string;
  }>;
  code_skeleton: string;
  recall_question: string;
}

/** Active recall prompt tied to a session. */
export interface RecallQuestion {
  id: string;
  sessionId: string;
  question: string;
  answer: string;
  topic?: string;
  createdAt: Date;
}

/** End-of-session recall prompts (stored on session doc from `/api/session/end`). */
export interface SessionRecallQuestion {
  id: string;
  question: string;
  hint: string;
}

export interface Session {
  id: string;
  userId: string;
  videoId: string;
  videoTitle: string;
  goal: string;
  checkpoints: Checkpoint[];
  startedAt: Date;
  endedAt: Date | null;
  status: SessionStatus;
  totalWatchSeconds: number;
  recallQuestions?: SessionRecallQuestion[];
}

export type NoteType = "concept" | "code" | "tip" | "warning";

export interface Note {
  id: string;
  sessionId: string;
  /** Position in the video timeline (seconds). */
  timestamp: number;
  type: NoteType;
  content: string;
  createdAt: Date;
}

export interface Bookmark {
  id: string;
  sessionId: string;
  timestampSeconds: number;
  label: string;
  createdAt: Date;
}

export type OnboardingLevel =
  | "beginner"
  | "junior"
  | "self-taught"
  | "switcher";

export type SessionLength = "30" | "60" | "120" | "120+";

export interface UserLearningProfile {
  level: OnboardingLevel;
  mediumTermGoal: string;
  painPoints: string[];
  sessionLength: SessionLength;
  techFocus: string;
  noteStyle: string;
}

export interface UserProfileDoc {
  onboardingCompleted?: boolean;
  onboardingCompletedAt?: Date | null;
  profile?: UserLearningProfile;
  sessions_used?: number;
  plan?: "free" | "pro";
}

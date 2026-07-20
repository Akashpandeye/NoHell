"use client";

import { useState } from "react";

import type { TutorialRevisionCard } from "@/types";

type RevisionOverlayProps = {
  card: TutorialRevisionCard;
  onResume: () => void;
};

function BulletSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-nh-muted">
        {title}
      </h3>
      <ul className="space-y-2 text-sm leading-relaxed text-nh-text">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-2">
            <span className="shrink-0 text-nh-teal" aria-hidden>
              •
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RevisionOverlay({ card, onResume }: RevisionOverlayProps) {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const quizAnswered = selectedOptionId !== null;
  const selectedCorrect =
    quizAnswered && selectedOptionId === card.quiz?.correctOptionId;

  return (
    <div
      className="absolute inset-0 z-[100] flex flex-col bg-neutral-950/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="revision-time-range"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto w-full max-w-4xl space-y-7">
          <header className="border-b border-nh-border pb-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-nh-dim">
              Revision card
            </p>
            <h2
              id="revision-time-range"
              className="mt-1 font-mono text-lg text-nh-text"
            >
              {card.timeRange}
            </h2>
            {card.overview ? (
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-nh-muted">
                {card.overview}
              </p>
            ) : null}
          </header>

          <BulletSection title="Key takeaways" items={card.keyTakeaways} />

          {card.concepts.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-nh-muted">
                Concepts
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                {card.concepts.map((concept, index) => (
                  <article
                    key={`${concept.name}-${index}`}
                    className="rounded-xl border border-nh-border bg-nh-surface/70 p-4"
                  >
                    <h4 className="font-semibold text-nh-text">{concept.name}</h4>
                    <p className="mt-2 text-sm leading-relaxed text-nh-muted">
                      {concept.explanation}
                    </p>
                    {concept.whyItMatters ? (
                      <p className="mt-3 text-sm leading-relaxed text-nh-muted">
                        <span className="font-semibold text-nh-dim">
                          Why it matters:{" "}
                        </span>
                        {concept.whyItMatters}
                      </p>
                    ) : null}
                    {concept.example ? (
                      <p className="mt-2 text-sm leading-relaxed text-nh-muted">
                        <span className="font-semibold text-nh-dim">Example: </span>
                        {concept.example}
                      </p>
                    ) : null}
                    {concept.pitfall ? (
                      <p className="mt-2 text-sm leading-relaxed text-orange-200/85">
                        <span className="font-semibold">Watch out: </span>
                        {concept.pitfall}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <BulletSection title="Process" items={card.processSteps} />

          {card.codeSkeleton ? (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-nh-muted">
                Code skeleton
              </h3>
              <pre className="overflow-x-auto rounded-xl border border-nh-border bg-nh-surface p-4 font-mono text-xs leading-relaxed text-nh-text">
                <code>{card.codeSkeleton}</code>
              </pre>
            </section>
          ) : null}

          <BulletSection title="Code walkthrough" items={card.codeWalkthrough} />
          <BulletSection title="Connections" items={card.connections} />

          {card.recall.question ? (
            <section className="rounded-xl border border-nh-border bg-nh-surface/50 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-nh-muted">
                Recall
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-nh-text">
                {card.recall.question}
              </p>
              {card.recall.hint ? (
                <details className="mt-3 text-sm text-nh-muted">
                  <summary className="cursor-pointer text-xs text-nh-teal">
                    Show hint
                  </summary>
                  <p className="mt-2 leading-relaxed">{card.recall.hint}</p>
                </details>
              ) : null}
              {card.recall.answer ? (
                <details className="mt-3 text-sm text-nh-muted">
                  <summary className="cursor-pointer text-xs text-nh-teal">
                    Reveal answer
                  </summary>
                  <p className="mt-2 leading-relaxed">{card.recall.answer}</p>
                </details>
              ) : null}
            </section>
          ) : null}

          {card.quiz ? (
            <section className="rounded-xl border border-nh-teal/35 bg-nh-teal/5 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-nh-teal">
                    Optional quiz
                  </h3>
                  <p className="mt-1 text-[11px] text-nh-dim">
                    Answer if useful, or resume whenever you&apos;re ready.
                  </p>
                </div>
              </div>
              <p className="mt-4 text-sm font-semibold leading-relaxed text-nh-text">
                {card.quiz.question}
              </p>
              <div className="mt-4 grid gap-2">
                {card.quiz.options.map((option) => {
                  const isSelected = selectedOptionId === option.id;
                  const isCorrect = option.id === card.quiz?.correctOptionId;
                  const resultClass = quizAnswered
                    ? isCorrect
                      ? "border-emerald-400/70 bg-emerald-400/10 text-emerald-100"
                      : isSelected
                        ? "border-red-400/70 bg-red-400/10 text-red-100"
                        : "border-nh-border text-nh-muted"
                    : "border-nh-border text-nh-text hover:border-nh-teal/60 hover:bg-nh-surface";
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={quizAnswered}
                      onClick={() => setSelectedOptionId(option.id)}
                      className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default ${resultClass}`}
                    >
                      <span className="font-mono font-semibold" aria-hidden>
                        {option.id}.
                      </span>
                      <span>{option.text}</span>
                    </button>
                  );
                })}
              </div>
              {quizAnswered ? (
                <div className="mt-4" aria-live="polite">
                  <p
                    className={`text-sm font-semibold ${
                      selectedCorrect ? "text-emerald-300" : "text-red-300"
                    }`}
                  >
                    {selectedCorrect
                      ? "Correct."
                      : `Not quite. The correct answer is ${card.quiz.correctOptionId}.`}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-nh-muted">
                    {card.quiz.explanation}
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-nh-border bg-nh-bg/95 px-4 py-4 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <button
            type="button"
            className="w-full cursor-pointer rounded-xl bg-nh-cta px-4 py-3 text-sm font-bold text-neutral-950 shadow-sm transition-colors duration-200 hover:bg-nh-cta-hover"
            onClick={onResume}
          >
            Resume Video
          </button>
        </div>
      </div>
    </div>
  );
}

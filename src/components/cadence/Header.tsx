import { Link } from "@tanstack/react-router";
import { stageStep, stepLabels, type Stage } from "./data";

export function Header({ stage }: { stage?: Stage }) {
  const step = stage ? stageStep[stage] : null;
  return (
    <header className="sticky top-0 z-20 border-b border-ink/10 bg-background/95 backdrop-blur-md">
      <div className="device-column grid h-14 grid-cols-[minmax(0,1fr)_auto] items-center px-5">
        <Link to="/" className="flex cursor-pointer items-baseline gap-2" aria-label="Cadence home">
          <span className="font-display text-xl">CADENCE</span>
        </Link>
        {step !== null && (
          <div className="flex items-center gap-1.5" aria-label={`${stepLabels[step]} step`}>
            {stepLabels.map((label, index) => (
              <span key={label} title={label} className={`h-1.5 rounded-full transition-all ${index === step ? "w-7 bg-primary" : index < step ? "w-2 bg-accent" : "w-2 bg-ink/15"}`} />
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

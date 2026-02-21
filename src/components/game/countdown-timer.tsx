"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/utils/cn";
import { formatSeconds } from "@/lib/utils/time";

interface CountdownTimerProps {
  secondsLeft: number;
}

export function CountdownTimer({ secondsLeft }: CountdownTimerProps) {
  const danger = secondsLeft <= 10;

  return (
    <motion.div
      animate={danger ? { scale: [1, 1.05, 1] } : { scale: 1 }}
      transition={{ repeat: danger ? Infinity : 0, duration: 0.7 }}
      className={cn(
        "inline-flex items-center rounded-[12px] border-4 border-[var(--pmb-ink)] px-4 py-2 font-mono text-2xl font-bold shadow-[8px_8px_0_var(--pmb-ink)]",
        danger ? "bg-[var(--pmb-red)] text-white" : "bg-[var(--pmb-yellow)] text-[var(--pmb-ink)]",
      )}
    >
      {formatSeconds(secondsLeft)}
    </motion.div>
  );
}

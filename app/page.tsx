"use client";

import { useState } from "react";
import { Landing } from "@/components/Landing";
import { World } from "@/components/World";

/** Root page — no login: pick the crew, describe the world, step in. */
export default function Page() {
  const [start, setStart] = useState<{ idea: string; crew: string[] } | null>(null);

  if (start) {
    return <World mode="create" initialIdea={start.idea} initialCrew={start.crew} />;
  }

  return <Landing onStart={(idea, crew) => setStart({ idea, crew })} />;
}

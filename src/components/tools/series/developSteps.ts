/** Develop flow: Story -> Look -> Episode plan -> Reference photos -> Produce. */

/** Why the final "go to Produce" button is off; empty when the user can move on. */
export const goProduceBlockedWhy = (episodeCount: number): string =>
  episodeCount > 0 ? "" : "Nothing is planned yet: write the episodes first (step 3), then come back here.";

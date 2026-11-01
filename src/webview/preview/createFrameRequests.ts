/** Asks for one frame at a time; a newer ask replaces one still waiting */
export interface FrameRequests {
  /** Asks for a frame now, or once the one in flight has come back */
  want(index: number): void;
  /** Reports that the frame in flight arrived or failed, which frees the next ask */
  settle(): void;
}

/** Creates requests that send at most one frame ask at a time and keep only the latest waiting */
export const createFrameRequests = (
  send: (index: number) => void,
): FrameRequests => {
  let inFlight = false;
  let waiting: number | undefined;
  const flush = () => {
    if (inFlight || waiting === undefined) {
      return;
    }

    const index = waiting;

    waiting = undefined;
    inFlight = true;
    send(index);
  };

  return {
    want: (index) => {
      waiting = index;
      flush();
    },
    settle: () => {
      inFlight = false;
      flush();
    },
  };
};

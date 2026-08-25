export type Clock = {
  now(): Date;
};

export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
};

export function createFixedClock(iso: string): Clock {
  const frozen = new Date(iso);
  return {
    now(): Date {
      return new Date(frozen.getTime());
    },
  };
}

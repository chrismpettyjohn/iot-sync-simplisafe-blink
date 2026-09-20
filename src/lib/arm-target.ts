export type ArmState = 'armed' | 'disarmed';

export interface ArmResult {
  /** The sync module / network the result belongs to. */
  name: string;
  ok: boolean;
  error?: string;
}

/**
 * A system that can be armed or disarmed in response to a SimpliSafe event.
 *
 * The monitor holds a list of these, so adding a second Blink account or a
 * different vendor later does not require touching the monitor.
 */
export interface ArmTarget {
  readonly name: string;
  apply(state: ArmState): Promise<ArmResult[]>;
}

/** Shape every form action returns, consumed by `useActionState` on the client. */
export interface ActionState {
  error?: string;
  success?: string;
  /**
   * Field values echoed back to the client. A form action resets every
   * uncontrolled input in its form, so anything worth keeping after a failed
   * submit has to travel back with the result.
   */
  values?: Record<string, string>;
}

export const EMPTY_STATE: ActionState = {};

export function failure(
  message: string,
  values?: Record<string, string>,
): ActionState {
  return { error: message, values };
}

export function ok(message: string): ActionState {
  return { success: message };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

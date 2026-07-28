import type {
  ActionOutcomeStatus,
  PortableError,
  PortableErrorCode
} from "./types.js";

export class InteropError extends Error {
  constructor(
    readonly code: PortableErrorCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "InteropError";
  }

  toPortableError(retryable?: boolean): PortableError {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(retryable === undefined ? {} : { retryable })
    };
  }
}

export class ActionHandlerError extends Error {
  constructor(
    readonly status: Exclude<ActionOutcomeStatus, "succeeded" | "cancelled">,
    readonly error: PortableError
  ) {
    super(error.message);
    this.name = "ActionHandlerError";
  }
}

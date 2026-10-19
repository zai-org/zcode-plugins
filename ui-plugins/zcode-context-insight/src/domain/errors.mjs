export class ContextError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ContextError'
    this.code = code
  }
}

export function isContextError(error) {
  return error instanceof ContextError
}

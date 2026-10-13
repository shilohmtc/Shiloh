class WorkspaceClientMutationError extends Error {
  constructor(code, message, httpStatus) { super(message); this.name = 'WorkspaceClientMutationError'; this.code = code; this.httpStatus = httpStatus; }
}
module.exports = { WorkspaceClientMutationError };

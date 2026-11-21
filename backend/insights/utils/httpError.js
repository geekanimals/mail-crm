// Error with an HTTP status, thrown from services and turned into a JSON reply
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (msg) => new HttpError(400, msg);
export const notFound = (msg) => new HttpError(404, msg);

// next/server shim supporting both NextResponse.json(...) and new NextResponse(body, init)
export class NextResponse {
  constructor(body, init) {
    this._raw = body;            // Buffer for file responses
    this.status = init?.status ?? 200;
    this.headers = new Map(Object.entries(init?.headers ?? {}));
  }
  static json(body, init) {
    const r = new NextResponse(undefined, init);
    r._body = body;
    r.json = async () => body;
    return r;
  }
}

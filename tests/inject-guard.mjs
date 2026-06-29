export async function requireAdmin() {
  if (global.__SESSION__) return { ok: true };
  return { ok: false, res: { status: 401, _body: { error: "לא מורשה" }, async json(){return this._body;} } };
}

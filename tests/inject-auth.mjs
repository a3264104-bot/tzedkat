// auth() returns whatever the harness configured (default: no session -> unauthorized GET).
export async function auth() { return global.__SESSION__ ?? null; }

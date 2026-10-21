/** Server-Sent Events hub: pushes chat and appointment updates to connected browsers. */
export class Hub {
  constructor() {
    this.clients = new Set(); // { res, userId, role }
    this.timer = setInterval(() => {
      for (const c of this.clients) c.res.write(": ping\n\n");
    }, 25_000);
    this.timer.unref();
  }
  add(res, user) {
    const client = { res, userId: user.id, role: user.role };
    this.clients.add(client);
    res.on("close", () => this.clients.delete(client));
    return client;
  }
  addPublic(res) {
    const client = { res, userId: null, role: "public" };
    this.clients.add(client);
    res.on("close", () => this.clients.delete(client));
    return client;
  }
  #write(c, event, data) { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
  toUser(userId, event, data) {
    for (const c of this.clients) if (c.userId === userId) this.#write(c, event, data);
  }
  toRoles(roles, event, data) {
    for (const c of this.clients) if (roles.includes(c.role)) this.#write(c, event, data);
  }
  toAll(event, data) {
    for (const c of this.clients) {
      if (c.role !== "public") this.#write(c, event, data);
    }
  }
  toCatalog(event, data) {
    for (const c of this.clients) {
      if (c.role === "public" || ["patient", "admin", "clerk"].includes(c.role)) {
        this.#write(c, event, data);
      }
    }
  }
  close() {
    clearInterval(this.timer);
    for (const c of this.clients) c.res.end();
    this.clients.clear();
  }
}

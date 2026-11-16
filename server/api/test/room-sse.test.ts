import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { roomRoutes, rooms } from "../src/room-routes.ts";

/**
 * The event stream of a room (GET …/events, Server-Sent Events) used to end on the *request* stream's "close" —
 * and a request has no body, so its stream ends as soon as its headers are read, i.e. immediately: the member lost
 * the room and the server crossed them off as disconnected while the answer was still open. These checks pin the
 * subscription to the response stream, which is the connection the SSE answer actually lives on.
 */

class FakeRes extends EventEmitter {
  status = 0;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  ended = 0;
  writeHead(status: number, headers: Record<string, string>) {
    this.status = status;
    this.headers = headers;
    return this;
  }
  write(chunk: unknown) {
    this.chunks.push(String(chunk));
    return true;
  }
  end() {
    this.ended++;
  }
}

function setup() {
  const person = { id: 1, code: "SKY-AAAAA", name: "ann" };
  const room = rooms.create(person, { startTogether: false, track: null, position: 0, playing: false });
  const routes = roomRoutes({
    me: () => ({ id: person.id, code: person.code, name: person.name }),
    friend: () => {
      throw new Error("not used here");
    },
    code: () => person.code,
    track: () => {
      throw new Error("not used here");
    },
  });
  const route = routes.find(([method, pattern]) => method === "GET" && pattern.source.includes("events"));
  assert.ok(route, "the events route exists");
  const req = new EventEmitter();
  const res = new FakeRes();
  const c = { req, res, params: [room.id] } as unknown as Parameters<typeof route[2]>[0];
  return { room: rooms.get(room.id)!, req, res, open: () => route[2](c) };
}

test("the stream stays open: the request closing does not end the subscription", (t) => {
  const { room, req, res, open } = setup();
  t.after(() => res.emit("close"));
  open();
  assert.equal(res.status, 200);
  assert.match(String(res.headers["content-type"]), /text\/event-stream/);
  assert.equal(room.members[0]!.streams, 1, "the member is connected");
  // a GET request has no body: its stream ends as soon as the headers are read — that must not close the answer
  req.emit("close");
  assert.equal(res.ended, 0, "the stream is still open");
  assert.equal(room.members[0]!.streams, 1, "the member is still connected");
});

test("the response closing ends the subscription, exactly once", (t) => {
  const { room, res, open } = setup();
  t.after(() => res.emit("close"));
  open();
  res.emit("close");
  assert.equal(res.ended, 1);
  assert.equal(room.members[0]!.streams, 0, "the member is marked disconnected");
  // a second close (the error handler and the close one racing, say) must not run the cleanup twice
  res.emit("close");
  assert.equal(res.ended, 1);
  assert.equal(room.members[0]!.streams, 0);
});

test("the response failing ends the subscription", (t) => {
  const { room, res, open } = setup();
  t.after(() => res.emit("close"));
  open();
  res.emit("error", new Error("socket died"));
  assert.equal(res.ended, 1);
  assert.equal(room.members[0]!.streams, 0);
});

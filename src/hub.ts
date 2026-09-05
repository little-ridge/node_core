import type { Hub, HubMessage, RoomRegistry } from './types.ts';

export function createRooms(): RoomRegistry {
  const patterns: RegExp[] = [];

  return {
    allow(pattern: RegExp): void {
      patterns.push(pattern);
    },
    isAllowed(room: string): boolean {
      return patterns.some((pattern) => pattern.test(room));
    },
  };
}

export function createHub(): Hub {
  const senders = new Map<string, (data: string) => void>();
  const membership = new Map<string, Set<string>>();
  const rooms = new Map<string, Set<string>>();

  function join(socketId: string, room: string): void {
    let members = rooms.get(room);
    if (!members) {
      members = new Set();
      rooms.set(room, members);
    }
    members.add(socketId);

    let joined = membership.get(socketId);
    if (!joined) {
      joined = new Set();
      membership.set(socketId, joined);
    }
    joined.add(room);
  }

  function leave(socketId: string, room: string): void {
    rooms.get(room)?.delete(socketId);
    if (rooms.get(room)?.size === 0) {
      rooms.delete(room);
    }
    membership.get(socketId)?.delete(room);
  }

  return {
    attach(socketId, send): void {
      senders.set(socketId, send);
      if (!membership.has(socketId)) {
        membership.set(socketId, new Set());
      }
    },
    drop(socketId): void {
      const joined = membership.get(socketId);
      if (joined) {
        for (const room of joined) {
          leave(socketId, room);
        }
      }
      membership.delete(socketId);
      senders.delete(socketId);
    },
    subscribe(socketId, requested): string[] {
      const accepted: string[] = [];
      for (const room of requested) {
        if (typeof room !== 'string' || room === '') {
          continue;
        }
        join(socketId, room);
        accepted.push(room);
      }

      return accepted;
    },
    unsubscribe(socketId, requested): string[] {
      const removed: string[] = [];
      for (const room of requested) {
        leave(socketId, room);
        removed.push(room);
      }

      return removed;
    },
    broadcast(roomNames, message): number {
      const payload = JSON.stringify(message);
      const seen = new Set<string>();
      let sent = 0;

      for (const room of roomNames) {
        for (const socketId of rooms.get(room) ?? []) {
          if (seen.has(socketId)) {
            continue;
          }
          seen.add(socketId);
          const send = senders.get(socketId);
          if (!send) {
            continue;
          }
          try {
            send(payload);
            sent += 1;
          } catch {
            // Dropped sockets are removed from the 'close' handler.
          }
        }
      }

      return sent;
    },
    size(): number {
      return senders.size;
    },
  };
}

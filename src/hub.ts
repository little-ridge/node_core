import { currentSite } from './context.ts';
import { scopedRoom } from './sites.ts';
import type { Hub, HubMessage, RoomRegistry, SiteRecord } from './types.ts';

type AllowedPattern = {
  pattern: RegExp;
  module?: string;
};

export function createRooms(): RoomRegistry {
  const patterns: AllowedPattern[] = [];

  return {
    allow(pattern: RegExp, module?: string): void {
      patterns.push({ pattern, module });
    },
    isAllowed(room: string, site?: SiteRecord): boolean {
      const match = patterns.find((entry) => entry.pattern.test(room));
      if (!match) {
        return false;
      }

      const allowed = site?.modules?.filter(Boolean) ?? [];
      if (allowed.length === 0 || !match.module) {
        return true;
      }

      return allowed.includes(match.module);
    },
  };
}

export function createHub(): Hub {
  const senders = new Map<string, (data: string) => void>();
  const membership = new Map<string, Set<string>>();
  const rooms = new Map<string, Set<string>>();
  const sites = new Map<string, SiteRecord>();

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

  function internalRoom(room: string, site?: SiteRecord): string {
    const bound = site ?? currentSite();
    return bound ? scopedRoom(bound.origin, room) : room;
  }

  return {
    attach(socketId, send): void {
      senders.set(socketId, send);
      if (!membership.has(socketId)) {
        membership.set(socketId, new Set());
      }
    },
    bindSite(socketId, site): void {
      if (site) {
        sites.set(socketId, site);
      } else {
        sites.delete(socketId);
      }
    },
    siteOf(socketId): SiteRecord | undefined {
      return sites.get(socketId);
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
      sites.delete(socketId);
    },
    subscribe(socketId, requested, site): string[] {
      const bound = site ?? sites.get(socketId);
      const accepted: string[] = [];
      for (const room of requested) {
        if (typeof room !== 'string' || room === '') {
          continue;
        }
        join(socketId, internalRoom(room, bound));
        accepted.push(room);
      }

      return accepted;
    },
    unsubscribe(socketId, requested, site): string[] {
      const bound = site ?? sites.get(socketId);
      const removed: string[] = [];
      for (const room of requested) {
        leave(socketId, internalRoom(room, bound));
        removed.push(room);
      }

      return removed;
    },
    broadcast(roomNames, message, site): number {
      const payload = JSON.stringify(message);
      const seen = new Set<string>();
      let sent = 0;

      for (const room of roomNames) {
        const key = internalRoom(room, site);
        for (const socketId of rooms.get(key) ?? []) {
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

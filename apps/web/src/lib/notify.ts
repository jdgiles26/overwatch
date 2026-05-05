"use client";

let _ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!_ctx) {
    try {
      _ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return _ctx;
}

export type SoundKind = "chime" | "siren" | "tone" | "none";

export function playSound(kind: SoundKind = "chime") {
  if (kind === "none") return;
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.18;
  master.connect(ctx.destination);
  if (kind === "chime") {
    const notes = [880, 1320, 1760];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.value = 0;
      g.gain.setValueAtTime(0, now + i * 0.12);
      g.gain.linearRampToValueAtTime(0.6, now + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.45);
      o.connect(g).connect(master);
      o.start(now + i * 0.12);
      o.stop(now + i * 0.12 + 0.5);
    });
  } else if (kind === "siren") {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sawtooth";
    g.gain.value = 0.3;
    o.connect(g).connect(master);
    o.frequency.setValueAtTime(420, now);
    for (let t = 0; t < 1.6; t += 0.2) {
      o.frequency.exponentialRampToValueAtTime(
        t % 0.4 < 0.2 ? 880 : 420,
        now + t,
      );
    }
    o.start(now);
    o.stop(now + 1.6);
  } else if (kind === "tone") {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    o.connect(g).connect(master);
    o.start(now);
    o.stop(now + 0.6);
  }
}

export async function ensureNotifyPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission === "default") {
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }
  return Notification.permission;
}

export async function showDesktopNotification(title: string, body: string, opts?: { tag?: string; icon?: string }) {
  const perm = await ensureNotifyPermission();
  if (perm !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      tag: opts?.tag,
      icon: opts?.icon,
      silent: false,
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      n.close();
    };
  } catch {
    /* ignore */
  }
}

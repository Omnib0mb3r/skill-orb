"use client";

import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

/**
 * Read-only mirror of a Claude Code terminal.
 *
 * Bridges into the daemon's terminal-stream pipeline. On mount we:
 *   1. Fetch /sessions/:id/terminal-replay to seed xterm with the
 *      current screen state (so mid-stream joins don't render blank).
 *   2. Open /sessions/:id/terminal-ws and write every chunk into
 *      xterm verbatim — ANSI escape sequences, color, cursor moves
 *      all just work because we're streaming the original bytes.
 *
 * The component dynamic-imports xterm so the dashboard's static
 * export doesn't pull a 200 KB module into pages that don't need it.
 * Mobile-friendly: no input listeners, just a render surface plus
 * a small "soft keys" bar for ESC/Tab/arrows that the user can use
 * via the existing Steer + Nav grid (which is already wired).
 */
interface Props {
  sessionId: string;
}

export function TerminalMirror({ sessionId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<unknown>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "offline">("loading");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let disposed = false;
    let unbindResize: (() => void) | undefined;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed) return;
      const term = new Terminal({
        convertEol: true,
        cursorBlink: false,
        disableStdin: true,
        fontFamily:
          'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
        fontSize: 13,
        theme: {
          background: "#0a0a0a",
          foreground: "#e5e5e5",
          cursor: "#666",
          selectionBackground: "#333",
        },
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);
      try {
        fit.fit();
      } catch {
        /* element may not be sized yet on first render */
      }
      termRef.current = term;

      const onResize = () => {
        try {
          fit.fit();
        } catch {
          /* ignore */
        }
      };
      window.addEventListener("resize", onResize);
      unbindResize = () => window.removeEventListener("resize", onResize);

      // Seed with replay snapshot.
      try {
        const res = await fetch(
          `/sessions/${encodeURIComponent(sessionId)}/terminal-replay`,
          { credentials: "include" },
        );
        if (res.ok) {
          const replay = await res.text();
          if (replay && !disposed) term.write(replay);
        }
      } catch {
        /* non-fatal */
      }

      // Open the live WS. Reconnect with backoff if it drops.
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      const connect = () => {
        if (disposed) return;
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${proto}//${window.location.host}/sessions/${encodeURIComponent(
          sessionId,
        )}/terminal-ws`;
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.binaryType = "arraybuffer";
        ws.onopen = () => setStatus("live");
        ws.onmessage = (ev) => {
          if (typeof ev.data === "string") term.write(ev.data);
          else if (ev.data instanceof ArrayBuffer) {
            term.write(new Uint8Array(ev.data));
          }
        };
        ws.onclose = () => {
          setStatus("offline");
          if (disposed) return;
          reconnectTimer = setTimeout(connect, 2000);
        };
        ws.onerror = () => {
          ws.close();
        };
      };
      connect();

      return () => {
        if (reconnectTimer) clearTimeout(reconnectTimer);
      };
    })();

    return () => {
      disposed = true;
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      unbindResize?.();
      const term = termRef.current as { dispose?: () => void } | null;
      try {
        term?.dispose?.();
      } catch {
        /* ignore */
      }
      termRef.current = null;
    };
  }, [sessionId]);

  return (
    <section className="rounded-panel bg-surface1 hairline overflow-hidden">
      <div className="px-5 py-3 border-b border-border1 flex items-center gap-2">
        <span className="font-display text-sm font-emphasized">Terminal mirror</span>
        <span
          className={`text-nano font-mono ml-2 ${
            status === "live"
              ? "text-promoted"
              : status === "loading"
                ? "text-txt3"
                : "text-err"
          }`}
        >
          {status === "live"
            ? "live"
            : status === "loading"
              ? "connecting…"
              : "offline (reconnecting)"}
        </span>
        <span className="text-nano text-txt3 ml-auto">
          read-only · use Steer / Nav for input
        </span>
      </div>
      <div
        ref={containerRef}
        className="h-[60vh] bg-[oklch(8%_0_0)]"
        aria-label="Live Claude Code terminal output"
      />
    </section>
  );
}

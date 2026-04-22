// src/components/StatusIndicator.jsx
import React, { useEffect, useRef, useState } from "react";
import { buildEventsStreamUrl } from "@/config/api";

/**
 * Tiny middleware connection indicator:
 * - green = connected
 * - yellow = connecting (attempting / backoff)
 * - red = disconnected (after retries)
 *
 * Uses SSE (EventSource) to detect connectivity and broadcasts.
 * Implements exponential backoff reconnect attempts.
 */
export default function StatusIndicator() {
  const [state, setState] = useState("connecting"); // 'connecting' | 'connected' | 'disconnected'
  const esRef = useRef(null);
  const attemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const eventsUrl = buildEventsStreamUrl();

  // compute color + styles by state
  const meta = {
    connected: {
      color: "#16a34a",
      shadow: "0 0 8px rgba(16,163,74,0.85)",
      title: "Middleware: connected",
      pulse: false,
    },
    connecting: {
      color: "#f59e0b",
      shadow: "0 0 8px rgba(245,158,11,0.7)",
      title: "Middleware: connecting…",
      pulse: true,
    },
    disconnected: {
      color: "#dc2626",
      shadow: "0 0 8px rgba(220,38,38,0.7)",
      title: "Middleware: disconnected",
      pulse: false,
    },
  }[state];

  // Open SSE with simple lifecycle handling
  function openEventSource() {
    // Clear old
    closeEventSource();

    try {
      const es = new EventSource(eventsUrl);
      esRef.current = es;
      setState("connecting");

      es.onopen = () => {
        attemptsRef.current = 0;
        setState("connected");
      };

      es.onmessage = () => {
        // keep alive; if needed you could parse message for richer logic
        if (state !== "connected") setState("connected");
      };

      es.onerror = () => {
        // EventSource spec: onerror fires for network and server errors.
        // Close & schedule reconnect with backoff.
        closeEventSource();
        scheduleReconnect();
        // Only mark disconnected after several attempts; show connecting first
        attemptsRef.current = Math.min(attemptsRef.current + 1, 10);
        if (attemptsRef.current >= 3) {
          setState("disconnected");
        } else {
          setState("connecting");
        }
      };
    // eslint-disable-next-line no-unused-vars
    } catch (err) {
      // If creation fails for some reason, schedule reconnect
      scheduleReconnect();
      setState("disconnected");
    }
  }

  function closeEventSource() {
    if (esRef.current) {
      // eslint-disable-next-line no-unused-vars
      try { esRef.current.close(); } catch (e) { /* empty */ }
      esRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function scheduleReconnect() {
    // exponential backoff with jitter
    const attempts = attemptsRef.current || 0;
    const base = Math.min(30000, 500 * Math.pow(2, attempts)); // cap at 30s
    const jitter = Math.floor(Math.random() * 4000); // up to 4s jitter
    const delay = Math.max(500, base + jitter);
    attemptsRef.current = attempts + 1;

    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(() => {
      openEventSource();
    }, delay);
  }

  useEffect(() => {
    openEventSource();

    return () => {
      // cleanup on unmount
      closeEventSource();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsUrl]); // run once per endpoint

  // Tooltip text
  const title = meta.title + (state === "connected" ? "" : ` (attempt ${attemptsRef.current || 0})`);

  // Accessible label
  const aria = state === "connected" ? "Middleware connected" : state === "connecting" ? "Middleware connecting" : "Middleware disconnected";

  return (
    <div
      role="status"
      aria-label={aria}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        marginRight: 8,
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: meta.color,
          boxShadow: meta.shadow,
          transition: "all 220ms ease",
          // subtle pulse for connecting state
          animation: meta.pulse ? "si-pulse 1.6s ease-in-out infinite" : "none",
        }}
      />
      <style>{`
        @keyframes si-pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.35); opacity: 0.75; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

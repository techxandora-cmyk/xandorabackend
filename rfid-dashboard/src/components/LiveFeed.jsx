// src/components/LiveFeed.jsx
import React, { useEffect } from 'react';
import API_BASE from "@/config/api";


export default function LiveFeed({ onEvent }) {
  useEffect(() => {
    // API_BASE already includes 
    const url = `${API_BASE}/events/stream`; // or '/events/subscribe' depending on server routes
    const es = new EventSource(url, { withCredentials: false });

    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (typeof onEvent === 'function') onEvent(data);
      } catch (e) {
        console.warn('Malformed SSE', e);
      }
    };

    es.onerror = (err) => {
      console.error('SSE error', err);
      es.close();
    };

    return () => es.close();
  }, [onEvent]);

  return null;
}

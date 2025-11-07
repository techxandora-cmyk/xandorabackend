// rfid-dashboard/src/components/Radar.jsx
import React from "react";

export default function Radar({ active = true, size = 280 }) {
  return (
    <div
      className="relative mx-auto grid place-items-center"
      style={{ width: size, height: size }}
    >
      {/* base circle */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-b from-purple-500/10 to-transparent blur-2xl" />
      <div className="absolute inset-2 rounded-full border border-purple-400/30" />
      <div className="absolute inset-10 rounded-full border border-purple-400/20" />
      <div className="absolute inset-20 rounded-full border border-purple-400/10" />

      {/* sweep */}
      <div
        className={`absolute inset-3 rounded-full ${
          active ? "radar-sweep" : ""
        }`}
        style={{
          WebkitMaskImage:
            "conic-gradient(from 0deg, rgba(0,0,0,1), rgba(0,0,0,0.0) 45deg, rgba(0,0,0,0) 360deg)",
          maskImage:
            "conic-gradient(from 0deg, rgba(0,0,0,1), rgba(0,0,0,0.0) 45deg, rgba(0,0,0,0) 360deg)",
          background:
            "radial-gradient(transparent 45%, rgba(168,85,247,0.15))",
        }}
      />

      {/* blips */}
      <span className="blip" style={{ top: "22%", left: "62%" }} />
      <span className="blip" style={{ top: "60%", left: "30%" }} />
      <span className="blip" style={{ top: "38%", left: "42%" }} />
    </div>
  );
}
